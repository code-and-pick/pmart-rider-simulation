// 시뮬레이션 본체: 시계, MOCK 세계, 가상 라이더, 로그·지표. React 에 의존하지 않는다(시험이 화면 없이 돈다).
//
// 역할 구분 (실서버에서 누가 하는 일인가 — docs/design.md §2-1)
//  - 주문·점원 배차 요청·포장  → order / mfc-fulfillment (실제 PDA 또는 MFC 시뮬레이터)   — MOCK 에서만 MockBackend 가 대신
//  - 라이더 찾기·제안·만료·재배차 → delivery-dispatch                                      — MOCK 에서만 MockBackend 가 대신
//  - 제안 응답·이동·인계·전달    → 라이더 앱 = 이 시뮬레이터의 가상 라이더(계약 API 를 부른다)

import { MockBackend, type MDelivery } from '../backend/mock/MockBackend';
import type { ApiCallRecord, DomainEventRecord } from '../backend/port';
import { DEFAULT_PARAMS, simRiderId, type SimParams } from '../config';
import { ApiProblem } from '../domain/contract';
import { destination, type LatLng } from '../util/geo';
import { Rng } from '../util/rng';
import { mockStartEpochMs, SimClock } from './clock';
import { VirtualRider, type RiderTrip } from './rider';
import { OrderLookup } from './orderLookup';
import { straightRoutes, type RouteProvider } from './route';
import type { DeliveryCard, DropLocationView, IncidentCounts, MetricsSummary, NoteRecord, PhaseSegment, ScenarioKnobs, World } from './world';
import { mockLocator } from './geocode';
import { assemble, dispatchSteps, executionSteps, type DeliveryTimeline } from './timeline';

const SUBSTEP = 0.25;
const RING = 300;
/** 라이더 기록은 라이더별로 보므로 더 길게 [시뮬] */
const NOTE_RING = 1500;

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
  readonly incidents: IncidentCounts = { assignmentCancelled: 0, locationStale: 0, helpRequests: 0 };
  private readonly rng: Rng;
  /** MFC·고객 이동 경로(기본 직선 — 시험, 화면은 DevServerRoutes) */
  private readonly routes: RouteProvider;

  /** 이 시뮬레이션만의 설정 사본 — 조절 바가 바꿔도 기본값(DEFAULT_PARAMS)은 그대로 */
  readonly params: SimParams;

  constructor(params: SimParams = DEFAULT_PARAMS, opts: { startEpochMs?: number; routes?: RouteProvider } = {}) {
    this.params = { ...params, mock: { ...params.mock } };
    params = this.params;
    this.routes = opts.routes ?? straightRoutes;
    this.clock = new SimClock(opts.startEpochMs ?? mockStartEpochMs());
    this.rng = new Rng(params.seed);
    this.speed = params.mockTimeScale;
    this.backend = new MockBackend(this.clock, params.mfcId, params.mfcLocation, params.mock, params.seed);
    this.backend.onApiCall((r) => {
      push(this.apiLog, r);
      if (r.status === 'ERR' || (typeof r.status === 'number' && r.status >= 500)) this.apiErrors++;
    });
    this.backend.onEvent((e) => {
      push(this.eventLog, e);
      // 사건 기록은 고리(최근 n 개)라 지표는 따로 센다
      if (e.type === 'DeliveryAssignmentChanged') this.incidents.assignmentCancelled++;
      else if (e.type === 'RiderLocationStale') this.incidents.locationStale++;
      else if (e.type === 'DeliveryIncidentRaised') this.incidents.helpRequests++;
    });
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
          onNote: (riderId, text) => push(this.notes, { at: this.clock.now, riderId, text }, NOTE_RING),
        },
        // 다시 배송 전달지(핀 없음)는 MOCK 주소록으로 찾는다 — 실서버에는 이 길이 없다
        { allowSignup: true, routes: this.routes, locator: mockLocator((a) => this.backend.locateAddress(a)) },
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
    return [...this.backend.deliveries.values()].map((d) => card(d, this.backend.ridersOf(d.deliveryId), this.backend.displayNumbers(d))).sort((a, b) => b.createdAt - a.createdAt);
  }

  /** MOCK 주문 상세·열람 — 가상 값(MockBackend.staffOrder·staffOrderReveal), 열람 기록 없음 */
  readonly orders = new OrderLookup({
    getOrder: async (id) => {
      const o = this.backend.staffOrder(id);
      if (!o) throw new ApiProblem(404, { code: 'ORDER_NOT_FOUND' });
      return o;
    },
    reveal: async (id, body) => this.backend.staffOrderReveal(id, body.fields ?? ['NAME', 'PHONE', 'ADDRESS', 'ENTRANCE']),
  });

  /** MOCK 전달지 — 가상 좌표·가상 주소(실서버 직원용 drop-location 흉내, 열람 기록 없음) */
  dropLocation(deliveryId: string): DropLocationView {
    const del = this.backend.deliveries.get(deliveryId);
    if (!del) return { state: 'none', reason: '없는 배송' };
    if (del.purpose === 'MISDELIVERY_RECOVERY') return { state: 'none', reason: '고객 전달지가 없는 배송(오배송 회수 — MFC 로)' };
    const redeliver = del.purpose === 'MISDELIVERY_REDELIVERY';
    return {
      state: 'ok',
      address: redeliver ? (del.homeAddress ?? '(MOCK 실제 집)') : '(MOCK 가상 주소 — 실제 주소 아님)',
      postalCode: null,
      pos: { ...del.customer },
      source: 'MOCK 가상 좌표',
      logId: null,
      kind: redeliver ? '다시 배송 실제 집' : '전달지',
    };
  }

  /** MOCK 배송 한 건의 흐름 — MockBackend 의 배차·제안·수행 기록 시각(시뮬레이션 시각) */
  deliveryTimeline(deliveryId: string): DeliveryTimeline | null {
    const del = this.backend.deliveries.get(deliveryId);
    const src = this.backend.timelineSource(deliveryId);
    if (!del || !src) return null;
    const steps = [...dispatchSteps(src.dispatch, Date.parse(this.clock.iso(del.createdAt))), ...executionSteps(src.history)];
    const terminal =
      ['COMPLETED', 'FAILED', 'CANCELLED', 'RETURNED_TO_STORE'].includes(del.x.state) ||
      del.d.state === 'DISPATCH_FAILED' ||
      del.d.state === 'CANCELLED_BEFORE_PICKUP';
    return assemble({ deliveryId, orderId: del.orderId, ...this.backend.displayNumbers(del), purpose: del.purpose, basis: 'sim', gaps: [] }, steps, terminal);
  }

  diagnostics(): string[] {
    return [];
  }

  addRider(): void {
    this.startRiders(1);
  }

  readonly operationLock = null;

  get mfcLocation(): LatLng {
    return this.params.mfcLocation;
  }

  startOperation(): void {
    /* MOCK 은 시작할 때 이미 운행 */
  }

  readonly operating = false;

  stopOperation(): void {
    /* MOCK 은 해당 없음 */
  }

  readonly tunable = true;

  getKnobs(): ScenarioKnobs {
    const p = this.params;
    return {
      ordersPerHour: p.mock.ordersPerHour,
      acceptProbability: p.acceptProbability,
      packTimeScale: p.mock.packTimeScale,
      customerAbsentRate: p.customerAbsentRate,
      networkDropRate: p.mock.networkDropRate,
      riderCancelRate: p.riderCancelRate,
      locationOutageRate: p.locationOutageRate,
      misdeliveryRate: p.mock.misdeliveryRate,
    };
  }

  /** 조절 바 — 바로 반영(라이더·MOCK 백엔드가 같은 설정 사본을 읽는다). 주문량이 바뀌면 다음 주문 시각을 다시 뽑는다. */
  setKnobs(k: Partial<ScenarioKnobs>): void {
    const p = this.params;
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    if (k.ordersPerHour !== undefined && k.ordersPerHour !== p.mock.ordersPerHour) {
      p.mock.ordersPerHour = clamp(k.ordersPerHour, 0, 200);
      this.backend.resetOrderClock();
    }
    if (k.acceptProbability !== undefined) p.acceptProbability = clamp(k.acceptProbability, 0, 1);
    if (k.packTimeScale !== undefined) p.mock.packTimeScale = clamp(k.packTimeScale, 0.1, 10);
    if (k.customerAbsentRate !== undefined) p.customerAbsentRate = clamp(k.customerAbsentRate, 0, 1);
    if (k.networkDropRate !== undefined) p.mock.networkDropRate = clamp(k.networkDropRate, 0, 0.9);
    if (k.riderCancelRate !== undefined) p.riderCancelRate = clamp(k.riderCancelRate, 0, 1);
    if (k.locationOutageRate !== undefined) p.locationOutageRate = clamp(k.locationOutageRate, 0, 1);
    if (k.misdeliveryRate !== undefined) p.mock.misdeliveryRate = clamp(k.misdeliveryRate, 0, 1);
  }

  /**
   * 화면 지표. 시간은 시뮬레이션 시각(배속 반영)이고, 구간 평균은 모두 같은 "완료된 배송 n 건"에서 잰다.
   *  - 라이더 찾기: 점원 배차 요청(배송 생성) → 라이더 수락·배정
   *  - MFC 로 이동: 배정 → 가게 도착 처리(execution 배정 반영 대기 포함)
   *  - 가게에서 대기·인계: 가게 도착 → 픽업 완료(포장 끝 기다림 + QR 인계 + 반영 대기)
   *  - 고객에게 이동·전달: 픽업 완료 → 전달 완료(이동 + 문 앞 + 사진 + 완료)
   */
  metrics(): MetricsSummary {
    let searching = 0;
    let delivering = 0;
    let failed = 0;
    let deliveryFailed = 0;
    for (const d of this.backend.deliveries.values()) {
      if (d.x.state === 'FAILURE_REPORTED' || d.x.state === 'FAILED') deliveryFailed++;
      else if (d.d.state === 'DISPATCH_FAILED') failed++;
      else if (d.d.state === 'CREATED' || d.d.state === 'DISPATCHING') searching++;
      else if (d.d.state === 'ASSIGNED' || d.d.state === 'PICKED_UP') delivering++;
    }
    const full = this.trips.flatMap((t) => {
      const created = this.backend.deliveries.get(t.deliveryId)?.createdAt;
      if (created === undefined || t.acceptedAt === undefined || t.storeArrivedAt === undefined || t.pickedUpAt === undefined || t.completedAt === undefined) {
        return [];
      }
      return [[t.acceptedAt - created, t.storeArrivedAt - t.acceptedAt, t.pickedUpAt - t.storeArrivedAt, t.completedAt - t.pickedUpAt]];
    });
    const completed = this.trips.filter((t) => t.completedAt !== undefined).length;
    const base = { completed, deliveryFailed, responseLost: this.apiErrors, delivering, searching, dispatchFailed: failed, timeBasis: 'sim' as const, apiErrors: this.apiErrors, incidents: { ...this.incidents } };
    if (!full.length) return { ...base, phases: null };
    const avg = (i: number) => full.reduce((a, r) => a + (r[i] as number), 0) / full.length;
    const segments: PhaseSegment[] = [
      { key: 'findRider', label: '라이더 찾기', sec: avg(0), hint: '점원 배차 요청(배송 생성) → 라이더 수락·배정' },
      { key: 'toStore', label: 'MFC 로 이동', sec: avg(1), hint: '배정 → 가게 도착 처리(수행 쪽 배정 반영 대기 포함)' },
      { key: 'atStore', label: '가게에서 대기·인계', sec: avg(2), hint: '가게 도착 → 픽업 완료(포장 끝 기다림 + QR 인계 + 반영 대기)' },
      { key: 'toCustomer', label: '고객에게 이동·전달', sec: avg(3), hint: '픽업 완료 → 전달 완료(이동 + 문 앞 + 사진 + 완료 처리)' },
    ];
    return { ...base, phases: { n: full.length, totalSec: segments.reduce((a, s) => a + s.sec, 0), segments } };
  }
}

function card(d: MDelivery, riderIds: string[], nums: { orderNumber: string | null; deliveryNumber: string | null }): DeliveryCard {
  const at = d.d.attempts[d.d.attempts.length - 1];
  return {
    deliveryId: d.deliveryId,
    orderId: d.orderId,
    orderNumber: nums.orderNumber,
    deliveryNumber: nums.deliveryNumber,
    shipmentId: d.shipmentId,
    dispatchState: d.d.state,
    executionState: d.x.exists ? d.x.state : null,
    riderId: d.d.assignment?.riderId ?? null,
    riderIds,
    radiusKm: d.d.state === 'DISPATCHING' && at ? at.radiusKm : null,
    customer: d.customer,
    purpose: d.purpose,
    pickup: d.pickup ? { ...d.pickup.at } : null,
    createdAt: d.createdAt,
  };
}

function push<T>(ring: T[], v: T, max = RING) {
  ring.push(v);
  if (ring.length > max) ring.splice(0, ring.length - max);
}
