// 시뮬레이션 본체: 시계, MOCK 세계, 가상 라이더, 로그·지표. React 에 의존하지 않는다(시험이 화면 없이 돈다).
//
// 역할 구분 (실서버에서 누가 하는 일인가 — docs/design.md §2-1)
//  - 주문·점원 배차 요청·포장  → order / mfc-fulfillment (실제 PDA 또는 MFC 시뮬레이터)   — MOCK 에서만 MockBackend 가 대신
//  - 라이더 찾기·제안·만료·재배차 → delivery-dispatch                                      — MOCK 에서만 MockBackend 가 대신
//  - 제안 응답·이동·인계·전달    → 라이더 앱 = 이 시뮬레이터의 가상 라이더(계약 API 를 부른다)

import { MockBackend, type MDelivery } from '../backend/mock/MockBackend';
import type { ApiCallRecord, DomainEventRecord } from '../backend/port';
import { DEFAULT_PARAMS, simRiderId, type SimParams } from '../config';
import { destination, type LatLng } from '../util/geo';
import { Rng } from '../util/rng';
import { mockStartEpochMs, SimClock } from './clock';
import { VirtualRider, type RiderTrip } from './rider';
import type { DeliveryCard, MetricsSummary, World } from './world';

const SUBSTEP = 0.25;
const RING = 300;

export interface NoteRecord {
  at: number;
  riderId: string;
  text: string;
}

export class Simulation implements World {
  readonly mode = 'mock' as const;
  readonly canChangeSpeed = true;
  readonly clock: SimClock;
  readonly backend: MockBackend;
  readonly riders: VirtualRider[] = [];
  readonly apiLog: ApiCallRecord[] = [];
  readonly eventLog: DomainEventRecord[] = [];
  readonly notes: NoteRecord[] = [];
  readonly trips: RiderTrip[] = [];
  speed: number;
  paused = false;
  apiErrors = 0;
  private readonly rng: Rng;

  constructor(
    readonly params: SimParams = DEFAULT_PARAMS,
    opts: { startEpochMs?: number } = {},
  ) {
    this.clock = new SimClock(opts.startEpochMs ?? mockStartEpochMs());
    this.rng = new Rng(params.seed);
    this.speed = params.mockTimeScale;
    this.backend = new MockBackend(this.clock, params.mfcId, params.mfcLocation, params.mock, params.seed);
    this.backend.onApiCall((r) => {
      push(this.apiLog, r);
      if (r.status === 'ERR' || (typeof r.status === 'number' && r.status >= 500)) this.apiErrors++;
    });
    this.backend.onEvent((e) => push(this.eventLog, e));
  }

  /** 가상 라이더 n 명을 MFC 둘레 아무 곳에 두고 운행을 시작한다. */
  startRiders(n: number = this.params.riderCount, place?: (i: number) => LatLng): VirtualRider[] {
    const made: VirtualRider[] = [];
    for (let k = 0; k < n; k++) {
      const i = this.riders.length;
      const [lo, hi] = this.params.riderStartRadiusM;
      const start = place?.(i) ?? destination(this.params.mfcLocation, this.rng.range(0, 360), this.rng.range(lo, hi));
      const r = new VirtualRider(
        i,
        this.backend.asRider(simRiderId(i)),
        this.backend.observer,
        this.clock,
        this.params,
        this.params.mfcLocation,
        start,
        {
          onTripDone: (t) => push(this.trips, t),
          onNote: (riderId, text) => push(this.notes, { at: this.clock.now, riderId, text }),
        },
      );
      this.riders.push(r);
      made.push(r);
      void r.run();
    }
    return made;
  }

  /**
   * 실제 경과 dtReal(초)에 배속을 곱해 진행한다(화면용).
   * 한 번에 최대 1초 실제 시간 — 브라우저가 박자를 늦춰도(가려진 창 등) 시각이 크게 밀리지 않게. 그보다 길게 멈췄던 시간은 버린다.
   */
  async advance(dtReal: number): Promise<void> {
    if (this.paused) return;
    await this.step(Math.min(dtReal, 1) * this.speed);
  }

  /** 시뮬 시각으로 simSec 만큼 진행한다(시험용). */
  async runFor(simSec: number): Promise<void> {
    await this.step(simSec);
  }

  private async step(simSec: number): Promise<void> {
    let remain = simSec;
    while (remain > 1e-6) {
      const dt = Math.min(SUBSTEP, remain);
      remain -= dt;
      this.clock.now += dt;
      this.backend.tick();
      for (const r of this.riders) r.tick(dt);
      // 풀린 Promise 의 후속 코드(다음 API 호출·wait 등록)가 같은 시각에 이어지도록 마이크로태스크를 비운다
      for (let i = 0; i < 60; i++) await Promise.resolve();
    }
  }

  // ───────────── 화면·시험용 보기 ─────────────

  /** MOCK 세계의 배송 카드. 실서버(P2)는 관찰 계정 조회로 같은 모양을 만든다. */
  deliveryCards(): DeliveryCard[] {
    return [...this.backend.deliveries.values()].map((d) => card(d)).sort((a, b) => b.createdAt - a.createdAt);
  }

  diagnostics(): string[] {
    return [];
  }

  addRider(): void {
    this.startRiders(1);
  }

  readonly operationLock = null;

  startOperation(): void {
    /* MOCK 은 시작할 때 이미 운행 */
  }

  metrics(): MetricsSummary {
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const done = this.trips.filter((t) => t.completedAt !== undefined);
    let inProgress = 0;
    let failed = 0;
    for (const d of this.backend.deliveries.values()) {
      if (d.d.state === 'DISPATCH_FAILED') failed++;
      else if (d.d.state !== 'CLOSED' && d.d.state !== 'CANCELLED_BEFORE_PICKUP') inProgress++;
    }
    return {
      completed: done.length,
      inProgress,
      dispatchFailed: failed,
      offerToAccept: avg(this.trips.filter((t) => t.acceptedAt !== undefined).map((t) => (t.acceptedAt as number) - t.offeredAt)),
      acceptToStore: avg(
        this.trips.filter((t) => t.acceptedAt !== undefined && t.storeArrivedAt !== undefined).map((t) => (t.storeArrivedAt as number) - (t.acceptedAt as number)),
      ),
      storeWait: avg(
        this.trips.filter((t) => t.storeArrivedAt !== undefined && t.pickedUpAt !== undefined).map((t) => (t.pickedUpAt as number) - (t.storeArrivedAt as number)),
      ),
      pickupToComplete: avg(done.filter((t) => t.pickedUpAt !== undefined).map((t) => (t.completedAt as number) - (t.pickedUpAt as number))),
      apiErrors: this.apiErrors,
    };
  }
}

function card(d: MDelivery): DeliveryCard {
  const at = d.d.attempts[d.d.attempts.length - 1];
  return {
    deliveryId: d.deliveryId,
    orderId: d.orderId,
    shipmentId: d.shipmentId,
    dispatchState: d.d.state,
    executionState: d.x.exists ? d.x.state : null,
    riderId: d.d.assignment?.riderId ?? null,
    radiusKm: d.d.state === 'DISPATCHING' && at ? at.radiusKm : null,
    customer: d.customer,
    createdAt: d.createdAt,
  };
}

function push<T>(ring: T[], v: T) {
  ring.push(v);
  if (ring.length > RING) ring.splice(0, ring.length - RING);
}
