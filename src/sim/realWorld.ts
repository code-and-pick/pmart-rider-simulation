// 실서버 읽기(P2) — 백엔드에서 읽은 것만 그린다. 쓰기(가상 라이더 운행)는 P3.
//
// 읽는 것(모두 GET):
//  - 관찰 계정: execution 직원 배송 찾기 GET /deliveries?mfcId= → 진행 중 배송의 dispatch GET /deliveries/{id}/dispatch
//    (배차 상태·배정 라이더·반경·shipmentId — §5 실측)
//  - 시뮬레이터 라이더 본인: GET /riders/me/locations/latest (404 = 아직 위치 없음)
// 사건은 구독하지 못하므로 두 조회 사이 상태 변화로 "추정"한 사건만 inferred 로 남긴다.
// 다른 기기에서도 같은 코드가 돈다 — 개발 서버가 GET 허용 목록만 넘긴다(§6-4). 전달지는 읽지 않는다.

import { HttpBackend } from '../backend/http/HttpBackend';
import type { ApiCallRecord, DomainEventRecord } from '../backend/port';
import { DEFAULT_PARAMS, simRiderId, type SimParams } from '../config';
import { ApiProblem, type Delivery, type DomainEventType, type StaffDeliverySummary } from '../domain/contract';
import { SimClock } from './clock';
import type { DeliveryCard, MetricsSummary, RiderView, World } from './world';

const RING = 300;
const TERMINAL_X = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'RETURNED_TO_STORE']);
/** 한 번 조회에서 dispatch 를 다시 읽는 배송 수 상한 [시뮬] — 게이트웨이 처리율 제한(주체 단위)을 아끼려고 */
const DISPATCH_READS_PER_POLL = 15;

interface Row {
  summary: StaffDeliverySummary;
  dispatch: Delivery | null;
  dispatchError: string | null;
}

class RemoteRider implements RiderView {
  pos: RiderView['pos'] = null;
  heading = 0;
  readonly phase = 'REMOTE' as const;
  note = '위치 조회 전';
  deliveryId: string | null = null;
  readonly target = null;
  constructor(readonly id: string) {}
}

export class RealWorld implements World {
  readonly mode = 'http' as const;
  readonly clock: SimClock;
  readonly backend: HttpBackend;
  readonly riders: RemoteRider[] = [];
  readonly apiLog: ApiCallRecord[] = [];
  readonly eventLog: DomainEventRecord[] = [];
  speed = 1;
  paused = false;
  readonly canChangeSpeed = false;
  private readonly rows = new Map<string, Row>();
  private polling = false;
  private lastPollAt = -Infinity;
  private apiErrors = 0;
  private status = '실서버 조회 준비';
  private authStatus = '개발 서버 토큰 상태 확인 전';
  private readonly startWall = Date.now();

  constructor(readonly params: SimParams = DEFAULT_PARAMS) {
    this.clock = new SimClock(this.startWall);
    this.backend = new HttpBackend({ apiBase: params.apiBase, sourceSystem: params.sourceSystem, now: () => this.clock.now });
    this.backend.onApiCall((r) => {
      push(this.apiLog, r);
      if (r.status === 'ERR' || (typeof r.status === 'number' && r.status >= 500)) this.apiErrors++;
    });
    for (let i = 0; i < params.riderCount; i++) this.riders.push(new RemoteRider(simRiderId(i)));
    void this.checkAuth();
  }

  /** 실서버는 실제 시각 1× — 박자가 늦어도 벽시계로 맞춘다 */
  async advance(_dtReal: number): Promise<void> {
    this.clock.now = (Date.now() - this.startWall) / 1000;
    if (this.paused || this.polling) return;
    if (this.clock.now - this.lastPollAt < this.params.lanObserverPollSec) return;
    this.lastPollAt = this.clock.now;
    this.polling = true;
    try {
      await this.poll();
    } finally {
      this.polling = false;
    }
  }

  addRider(): void {
    // P2 는 읽기만 — 실서버 가상 라이더 운행은 P3
  }

  private async checkAuth() {
    try {
      const res = await fetch('/sim-auth/status', { cache: 'no-store' });
      if (res.status === 403) {
        this.authStatus = '다른 기기 — 이 PC 의 개발 서버가 붙이는 토큰으로 조회만';
        return;
      }
      const s = (await res.json()) as { riderSigning?: boolean; observer?: boolean };
      this.authStatus = `개발 서버: 라이더 서명키 ${s.riderSigning ? '있음' : '없음'}, 관찰 계정 ${s.observer ? '있음' : '없음'}`;
    } catch {
      this.authStatus = '개발 서버 토큰 상태를 읽지 못함';
    }
  }

  private async poll() {
    // 1. 배송 목록(관찰 계정)
    let items: StaffDeliverySummary[] = [];
    try {
      const list = await this.backend.observer.searchDeliveries({ mfcId: this.params.mfcId, sort: 'NEWEST', size: 30 });
      items = list.items ?? [];
      this.status = `배송 ${items.length}건 (${this.params.mfcId}, 최근 30건)`;
    } catch (e) {
      this.status = `배송 목록 실패: ${describe(e)}`;
    }
    const seen = new Set<string>();
    for (const s of items) {
      if (!s.deliveryId) continue;
      seen.add(s.deliveryId);
      const prev = this.rows.get(s.deliveryId);
      if (!prev) this.infer('DeliveryCreated', `${s.deliveryId} 목록에 나타남`);
      else if (prev.summary.state !== s.state) this.inferExec(s.deliveryId, s.state);
      this.rows.set(s.deliveryId, { summary: s, dispatch: prev?.dispatch ?? null, dispatchError: prev?.dispatchError ?? null });
    }
    for (const id of [...this.rows.keys()]) if (!seen.has(id)) this.rows.delete(id);

    // 2. 진행 중 배송의 배차 관점(처음 보는 끝난 배송도 한 번은)
    const need = [...this.rows.values()]
      .filter((r) => !TERMINAL_X.has(r.summary.state ?? '') || r.dispatch === null)
      .slice(0, DISPATCH_READS_PER_POLL);
    for (const row of need) {
      const id = row.summary.deliveryId as string;
      try {
        const d = await this.backend.observer.getDispatch(id);
        if (row.dispatch && row.dispatch.state !== d.state) this.inferDispatch(id, d.state, d.assignment?.riderId);
        row.dispatch = d;
        row.dispatchError = null;
      } catch (e) {
        row.dispatchError = describe(e);
      }
    }

    // 3. 시뮬레이터 라이더 마지막 위치(라이더 본인 토큰 — 개발 서버가 서명)
    for (const r of this.riders) {
      try {
        const loc = await this.backend.asRider(r.id).getLatestLocation();
        if (loc.lat !== undefined && loc.lng !== undefined) r.pos = { lat: loc.lat, lng: loc.lng };
        r.note = `마지막 위치 ${loc.staleSinceSeconds ?? '?'}초 전 (${loc.quality ?? '?'})`;
      } catch (e) {
        r.pos = null;
        r.note = e instanceof ApiProblem && e.status === 404 ? '실서버에 올린 위치 없음' : `위치 조회 실패: ${describe(e)}`;
      }
      r.deliveryId = [...this.rows.values()].find((x) => x.summary.riderId === r.id && !TERMINAL_X.has(x.summary.state ?? ''))?.summary.deliveryId ?? null;
    }
  }

  private infer(type: DomainEventType, summary: string) {
    push(this.eventLog, { at: this.clock.now, type, summary: `${summary} (조회로 추정)`, inferred: true });
  }

  private inferExec(id: string, state: string | undefined) {
    if (state === 'PICKED_UP') this.infer('PickupCompleted', `${id} 수행 PICKED_UP`);
    else if (state === 'COMPLETED') this.infer('DeliveryCompleted', `${id} 수행 COMPLETED`);
    else if (state === 'FAILED') this.infer('DeliveryFailed', `${id} 수행 FAILED`);
  }

  private inferDispatch(id: string, state: string | undefined, riderId: string | undefined) {
    if (state === 'ASSIGNED') this.infer('DeliveryAssigned', `${id} → ${riderId ?? '?'}`);
    else if (state === 'DISPATCH_FAILED') this.infer('DispatchFailed', `${id} 배차 실패`);
    else if (state === 'CANCELLED_BEFORE_PICKUP') this.infer('DeliveryCancelledBeforePickup', `${id} 픽업 전 취소`);
  }

  deliveryCards(): DeliveryCard[] {
    return [...this.rows.values()].map((r) => {
      const s = r.summary;
      const d = r.dispatch;
      const at = d?.attempts?.[d.attempts.length - 1];
      return {
        deliveryId: s.deliveryId as string,
        orderId: s.orderId ?? d?.orderId ?? null,
        shipmentId: d ? (d.shipmentId ?? null) : null,
        dispatchState: d?.state ?? null,
        executionState: s.state ?? null,
        riderId: d?.assignment?.riderId ?? s.riderId ?? null,
        radiusKm: d?.state === 'DISPATCHING' ? (at?.currentRadiusKm ?? null) : null,
        customer: null,
        createdAt: s.createdAt ? (Date.parse(s.createdAt) - this.startWall) / 1000 : 0,
      };
    });
  }

  metrics(): MetricsSummary {
    let completed = 0;
    let inProgress = 0;
    let failed = 0;
    for (const r of this.rows.values()) {
      if (r.summary.state === 'COMPLETED') completed++;
      else if (r.dispatch?.state === 'DISPATCH_FAILED') failed++;
      else if (!TERMINAL_X.has(r.summary.state ?? '')) inProgress++;
    }
    return {
      completed,
      inProgress,
      dispatchFailed: failed,
      offerToAccept: null,
      acceptToStore: null,
      storeWait: null,
      pickupToComplete: null,
      apiErrors: this.apiErrors,
    };
  }

  diagnostics(): string[] {
    const withD = [...this.rows.values()].filter((r) => r.dispatch);
    const filled = withD.filter((r) => r.dispatch?.shipmentId).length;
    const errs = [...this.rows.values()].filter((r) => r.dispatchError).map((r) => r.dispatchError);
    const lines = [this.authStatus, this.status];
    if (withD.length) lines.push(`dispatch shipmentId 실측(§5): 채워짐 ${filled} / 읽은 배송 ${withD.length}`);
    if (errs.length) lines.push(`배차 조회 실패 ${errs.length}건 — 예: ${errs[0]}`);
    lines.push('실서버 읽기만(P2) — 가상 라이더 운행은 P3');
    return lines;
  }
}

function describe(e: unknown): string {
  if (e instanceof ApiProblem) return `${e.status} ${e.code ?? ''}`.trim();
  return e instanceof Error ? e.message : String(e);
}

function push<T>(ring: T[], v: T) {
  ring.push(v);
  if (ring.length > RING) ring.splice(0, ring.length - RING);
}
