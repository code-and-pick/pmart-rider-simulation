// 실서버 읽기(P2) + 가상 라이더 운행(P3 — REAL_RIDER_GATE: 사용자 2026-11-16 "시험 번호로 시작" — 2명).
// 읽기는 백엔드에서 읽은 것만 그린다. 운행(쓰기)은 잠금이 풀린 뒤에만 VirtualRider 가 HttpBackend 로 한다.
//
// 읽는 것(모두 GET):
//  - 관찰 계정: execution 직원 배송 찾기 GET /deliveries?mfcId= → 진행 중 배송의 dispatch GET /deliveries/{id}/dispatch
//    (배차 상태·배정 라이더·반경·shipmentId — §5 실측)
//  - 시뮬레이터 라이더 본인: GET /riders/me/locations/latest (404 = 아직 위치 없음)
// 사건은 구독하지 못하므로 두 조회 사이 상태 변화로 "추정"한 사건만 inferred 로 남긴다.
// 다른 기기에서도 같은 코드가 돈다 — 개발 서버가 GET 허용 목록만 넘긴다(§6-4). 전달지는 읽지 않는다.

import { HttpBackend } from '../backend/http/HttpBackend';
import type { ApiCallRecord, DomainEventRecord } from '../backend/port';
import { DEFAULT_PARAMS, isSimRiderId, REAL_RIDER_GATE, simRiderId, type SimParams } from '../config';
import { ApiProblem, type ControlRider, type Delivery, type DomainEventType, type StaffDeliverySummary } from '../domain/contract';
import { SimClock } from './clock';
import { VirtualRider } from './rider';
import { straightRoutes, type RouteProvider } from './route';
import { bearingDeg, distanceM, type LatLng } from '../util/geo';
import type { RiderPhase } from './rider';
import { shortRiderId } from '../domain/riderId';
import type { DeliveryCard, MetricsSummary, NoteRecord, PhaseSegment, RiderView, ScenarioKnobs, World } from './world';
import type { AddressLocator } from './geocode';
import { assemble, dispatchSteps, summarySteps, type DeliveryTimeline, type TimelineStep } from './timeline';
import type { RiderTrip } from './rider';

const RING = 300;
const SUBSTEP = 0.25;
/** 한 번에 따라잡는 최대 시간(초) [시뮬] — 그보다 오래 멈췄으면 시계만 맞춘다 */
const MAX_CATCHUP_SEC = 600;
const TERMINAL_X = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'RETURNED_TO_STORE']);
/** 한 번 조회에서 dispatch 를 다시 읽는 배송 수 상한 [시뮬] — 게이트웨이 처리율 제한(주체 단위)을 아끼려고 */
const DISPATCH_READS_PER_POLL = 15;
/** 관제 진행 중 배송 단계(tracking ControlRider.activeDeliveries.stage) → 화면 글자 */
const STAGE_LABEL: Record<string, string> = {
  UNASSIGNED: '배정 전',
  TO_STORE: 'MFC 로 가는 중',
  AT_STORE: 'MFC 도착',
  TO_CUSTOMER: '고객에게 가는 중',
  AT_CUSTOMER: '고객 도착',
  DONE: '끝남',
};

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
  locationAgeSec: number | null = null;
  deliveryId: string | null = null;
  readonly target = null;
  readonly path = null;
  readonly pathKind = null;
  constructor(readonly id: string) {}
}

/** 관제 단계 → 화면 단계(지도·목록 색). 배송이 없으면 대기 */
const STAGE_PHASE: Record<string, RiderPhase> = {
  UNASSIGNED: 'IDLE',
  TO_STORE: 'TO_STORE',
  AT_STORE: 'AT_STORE_WAIT_READY',
  TO_CUSTOMER: 'TO_CUSTOMER',
  AT_CUSTOMER: 'AT_CUSTOMER',
  DONE: 'IDLE',
};

/**
 * 라이더 앱 라이더(관제로 읽음, RR-08). 위치는 10초마다 오므로 그 사이를 새 위치 쪽으로 미끄러지듯 옮겨 그린다
 * (도착 위치는 서버 값 그대로 — 중간 점은 화면용 보간일 뿐).
 */
class AppRider implements RiderView {
  phase: RiderPhase = 'IDLE';
  note = '';
  label: string;
  deliveryId: string | null = null;
  heading = 0;
  readonly external = true;
  /** 관제 stale(위치 없음 또는 3분 넘게 안 들어옴) */
  locationOffline = false;
  locationAgeSec: number | null = null;
  readonly target = null;
  readonly path = null;
  readonly pathKind = null;
  pos: LatLng | null = null;
  private from: LatLng | null = null;
  private to: LatLng | null = null;
  private t0 = 0;
  constructor(readonly id: string) {
    this.label = shortRiderId(id);
  }

  /** 서버가 준 새 위치 — 지금 그리는 곳에서 glideSec 동안 그쪽으로 */
  setServerPos(p: LatLng | null, now: number) {
    if (!p) {
      this.pos = this.from = this.to = null;
      return;
    }
    if (!this.pos || distanceM(this.pos, p) > 2000) {
      this.pos = this.from = this.to = p; // 처음이거나 너무 멀리 튀면 바로
      return;
    }
    if (distanceM(this.pos, p) > 3) this.heading = bearingDeg(this.pos, p);
    this.from = this.pos;
    this.to = p;
    this.t0 = now;
  }

  glide(now: number, glideSec: number) {
    if (!this.from || !this.to) return;
    const k = Math.min(1, (now - this.t0) / glideSec);
    this.pos = { lat: this.from.lat + (this.to.lat - this.from.lat) * k, lng: this.from.lng + (this.to.lng - this.from.lng) * k };
  }
}

export class RealWorld implements World {
  readonly mode = 'http' as const;
  readonly clock: SimClock;
  readonly backend: HttpBackend;
  private readonly remote: RemoteRider[] = [];
  /** 라이더 관제(RR-08)로 읽은 시뮬레이터 밖 라이더(라이더 앱) — 운행 중인 라이더만, 이 PC 만 */
  private readonly appRiders = new Map<string, AppRider>();
  /** 관제 조회 상태 — null 이면 아직 안 부름 */
  private controlStatus: string | null = null;
  /** 이 PC 개발 서버에 관제 계정 비밀번호 파일이 있나(/sim-auth/status) */
  private controlAvailable = false;
  private lastControlAt = -Infinity;
  private lastControl: { items: ControlRider[]; asOf: string } | null = null;

  controlBoard(): { items: ControlRider[]; asOf: string } | null {
    return this.lastControl;
  }
  /** 이 브라우저가 움직이는 가상 라이더(P3 — 잠금이 풀린 뒤에만) */
  private readonly driven = new Map<string, VirtualRider>();
  readonly apiLog: ApiCallRecord[] = [];
  readonly eventLog: DomainEventRecord[] = [];
  /** 이 브라우저가 움직이는 가상 라이더의 진행 기록 */
  readonly notes: NoteRecord[] = [];
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
  /** 이 브라우저가 움직인 가상 라이더의 끝난 배송 기록(엔진이 잰 가게 도착 시각) — 흐름 화면용 */
  private readonly doneTrips = new Map<string, RiderTrip>();
  /** center-master 에서 읽은 MFC 위치(정본 — 배차 반경 기준). 읽기 전·실패면 null */
  private center: { location: LatLng; label: string } | null = null;
  private centerError: string | null = null;
  private readonly doFetch: typeof fetch;

  private readonly locator: AddressLocator | null;

  constructor(
    readonly params: SimParams = DEFAULT_PARAMS,
    /** 시험에서 바꿔 넣을 수 있게 — 화면은 늘 config 값 */
    private readonly gate: typeof REAL_RIDER_GATE = REAL_RIDER_GATE,
    /** MFC·고객 이동 경로(기본 직선 — 시험, 화면은 DevServerRoutes) */
    private readonly routes: RouteProvider = straightRoutes,
    /** 시험용 fetch · 다시 배송 전달지(핀 없음) 주소 → 좌표(없거나 준비 안 되면 다시 배송 제안을 거절한다) */
    opts: { fetch?: typeof fetch; locator?: AddressLocator } = {},
  ) {
    this.doFetch = opts.fetch ?? ((...a) => fetch(...a));
    this.locator = opts.locator ?? null;
    this.clock = new SimClock(this.startWall);
    this.backend = new HttpBackend({
      apiBase: params.apiBase,
      sourceSystem: params.sourceSystem,
      now: () => this.clock.now,
      fetch: this.doFetch,
    });
    this.backend.onApiCall((r) => {
      push(this.apiLog, r);
      if (r.status === 'ERR' || (typeof r.status === 'number' && r.status >= 500)) this.apiErrors++;
    });
    // 실서버 시뮬레이터 라이더 수는 사용자가 정한 값(REAL_RIDER_GATE.riderCount) — MOCK 의 riderCount 와 따로
    for (let i = 0; i < this.gate.riderCount; i++) this.remote.push(new RemoteRider(simRiderId(i)));
    void this.checkAuth();
    void this.loadCenter();
  }

  /** MFC 위치 — center-master 에서 읽은 값(인계 위치가 있으면 그것). 읽기 전엔 설정값([가정])으로 지도만 그린다. */
  get mfcLocation(): LatLng {
    return this.center?.location ?? this.params.mfcLocation;
  }

  /**
   * center-master → MFC 위치. 배차 반경이 이 좌표 기준이라 시뮬레이터도 같아야 한다(docs/design.md §6-2).
   * 1) 라이더용 픽업지 목록 `GET /mfc-pickup-points`(0.2.0 — 라이더 앱과 같은 길, 첫 시뮬레이터 라이더 토큰) — 인계 위치가 있으면 그것.
   * 2) 못 읽으면(아직 배포 안 됨 404·목록에 없음 등) 관찰 계정 `GET /centers/{id}`(accessPoints 의 HANDOVER_POINT 우선).
   */
  async loadCenter(): Promise<void> {
    const okPoint = (p: { lat?: number; lng?: number } | null | undefined): p is { lat: number; lng: number } =>
      p?.lat !== undefined && p?.lng !== undefined;
    let listError: string;
    try {
      const list = await this.backend.asRider(simRiderId(0)).listMfcPickupPoints();
      const pp = (list.items ?? []).find((x) => x.centerId === this.params.mfcId);
      if (!pp) throw new Error(`목록에 ${this.params.mfcId} 없음`);
      const hp = pp.handoverPoint?.coordinates;
      const p = okPoint(hp) ? hp : pp.coordinates;
      if (!okPoint(p)) throw new Error('좌표 없음');
      this.center = { location: { lat: p.lat, lng: p.lng }, label: `${pp.name}${okPoint(hp) ? ' — 인계 위치' : ''} (라이더용 픽업지 목록)` };
      this.centerError = null;
      return;
    } catch (e) {
      listError = describe(e);
    }
    try {
      const c = await this.backend.observer.getCenter(this.params.mfcId);
      const hp = (c.accessPoints ?? []).find((a) => a.kind === 'HANDOVER_POINT' && okPoint(a.coordinates));
      const p = hp?.coordinates ?? c.coordinates;
      if (!okPoint(p)) throw new Error('센터 좌표 없음');
      this.center = {
        location: { lat: p.lat, lng: p.lng },
        label: `${c.name ?? c.centerId ?? this.params.mfcId} v${c.version ?? '?'}${hp ? ' — 인계 위치' : ''} (센터 조회 — 픽업지 목록 못 읽음: ${listError})`,
      };
      this.centerError = null;
    } catch (e) {
      this.centerError = `픽업지 목록 ${listError} / 센터 조회 ${describe(e)}`;
    }
  }

  get riders(): RiderView[] {
    return [...this.remote.map((r) => this.driven.get(r.id) ?? r), ...this.appRiders.values()];
  }

  get operationLock(): string | null {
    if (!this.gate.operationAllowed) return '실서버 가상 라이더 운행 잠김 — 가입·운행 여부 사용자 결정 대기(RR-02·RR-07)';
    // 쓰기(운행)는 개발 서버가 라이더 토큰을 서명할 수 있는 그 PC 에서만 — 다른 기기는 GET 만 넘어간다(§6-4)
    if (this.writeAccess === 'remote') return '다른 기기에서는 운행할 수 없음 — 개발 서버가 있는 PC(localhost)에서만';
    if (this.writeAccess === 'no-key') return '이 PC 에 라이더 서명키가 없어 운행할 수 없음';
    if (this.writeAccess === 'unknown') return '개발 서버 상태 확인 중';
    if (!this.center) return 'MFC 위치를 center-master 에서 아직 못 읽음 — 배차 반경이 어긋나므로 운행 막음';
    return null;
  }

  /** 운행(쓰기) 가능 여부 — /sim-auth/status 로 판정 */
  private writeAccess: 'unknown' | 'ok' | 'remote' | 'no-key' = 'unknown';

  /** 이 브라우저가 실서버에서 라이더를 움직이는 중인가(멈춘 라이더만 남았으면 false) */
  get operating(): boolean {
    return [...this.driven.values()].some((v) => v.phase !== 'STOPPED');
  }

  /** 가상 라이더를 실서버에서 움직인다(쓰기). 잠겨 있거나 이미 운행 중이면 아무것도 안 한다. */
  startOperation(): void {
    if (this.operationLock !== null || this.operating) return;
    const home = this.mfcLocation;
    this.driven.clear();
    this.remote.forEach((r, i) => {
      const v = new VirtualRider(
        i,
        this.backend.asRider(r.id),
        this.backend.observer,
        this.clock,
        // 실서버에는 장면을 일부러 만들지 않는다(조절 바는 MOCK 만): 가짜 전달 실패·배정 취소·위치 끊김 없음.
        // 포장 10분 넘으면 도움요청 STORE_WAITING 은 보낸다(실제 지원센터 사건이 열림 — 사용자 결정 2026-11-16 "진행해")
        { ...this.params, customerAbsentRate: 0, riderCancelRate: 0, locationOutageRate: 0 },
        home,
        r.pos ?? home,
        {
          onTripDone: (t) => this.doneTrips.set(t.deliveryId, { ...t }),
          onNote: (riderId, text) => push(this.notes, { at: this.clock.now, riderId, text }, 1500),
        },
        { allowSignup: this.gate.signupAllowed, routes: this.routes, locator: this.locator ?? undefined },
      );
      this.driven.set(r.id, v);
      void v.run();
    });
  }

  /** 실서버는 실제 결과만 — 시나리오 조절 바 없음(실패를 일부러 만들지 않는다) */
  readonly tunable = false;

  getKnobs(): ScenarioKnobs {
    return {
      ordersPerHour: 0,
      acceptProbability: this.params.acceptProbability,
      packTimeScale: 1,
      customerAbsentRate: 0,
      networkDropRate: 0,
      riderCancelRate: 0,
      locationOutageRate: 0,
      misdeliveryRate: 0,
    };
  }

  setKnobs(): void {
    /* 실서버는 조절하지 않는다 */
  }

  /** 운행 종료 — 진행 중 배송은 끝낸 뒤 OFF_DUTY(VirtualRider.requestStop). */
  stopOperation(): void {
    for (const v of this.driven.values()) v.requestStop();
  }

  /** 실서버는 실제 시각 1× — 박자가 늦거나 탭이 가려져도 벽시계로 맞춘다 */
  async advance(_dtReal: number): Promise<void> {
    const wall = (Date.now() - this.startWall) / 1000;
    let gap = wall - this.clock.now;
    if (gap > MAX_CATCHUP_SEC) {
      this.clock.now = wall - MAX_CATCHUP_SEC;
      gap = MAX_CATCHUP_SEC;
    }
    while (gap > 1e-6) {
      const dt = Math.min(SUBSTEP, gap);
      gap -= dt;
      this.clock.now += dt;
      for (const v of this.driven.values()) v.tick(dt);
    }
    for (const a of this.appRiders.values()) a.glide(wall, RealWorld.CONTROL_POLL_SEC);
    this.clock.now = wall;
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
      const res = await this.doFetch('/sim-auth/status', { cache: 'no-store' });
      if (res.status === 403) {
        this.authStatus = '다른 기기 — 이 PC 의 개발 서버가 붙이는 토큰으로 조회만';
        this.writeAccess = 'remote';
        return;
      }
      const s = (await res.json()) as { riderSigning?: boolean; observer?: boolean; control?: boolean };
      this.authStatus = `개발 서버: 라이더 서명키 ${s.riderSigning ? '있음' : '없음'}, 관찰 계정 ${s.observer ? '있음' : '없음'}, 관제 계정 ${s.control ? '있음' : '없음'}`;
      this.controlAvailable = !!s.control;
      this.writeAccess = s.riderSigning ? 'ok' : 'no-key';
    } catch {
      this.authStatus = '개발 서버 토큰 상태를 읽지 못함';
      this.writeAccess = 'unknown';
    }
  }

  private async poll() {
    if (!this.center) await this.loadCenter(); // 못 읽었으면 다시
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
      if (!prev) this.infer('DeliveryCreated', `${s.deliveryId} 목록에 나타남`, s.deliveryId);
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
    for (const r of this.remote) {
      if (this.driven.has(r.id)) continue; // 움직이는 라이더는 이 브라우저가 위치를 안다
      try {
        const loc = await this.backend.asRider(r.id).getLatestLocation();
        if (loc.lat !== undefined && loc.lng !== undefined) r.pos = { lat: loc.lat, lng: loc.lng };
        r.locationAgeSec = loc.staleSinceSeconds ?? null;
        r.note = `마지막 위치 ${loc.staleSinceSeconds ?? '?'}초 전 (${loc.quality ?? '?'})`;
      } catch (e) {
        r.pos = null;
        r.note = e instanceof ApiProblem && e.status === 404 ? '실서버에 올린 위치 없음' : `위치 조회 실패: ${describe(e)}`;
      }
      r.deliveryId = [...this.rows.values()].find((x) => x.summary.riderId === r.id && !TERMINAL_X.has(x.summary.state ?? ''))?.summary.deliveryId ?? null;
    }

    // 4. 라이더 관제(RR-08) — 운행 중 라이더 전원(라이더 앱 포함) 현재 위치. 이 PC 만(관제 계정 토큰은 개발 서버가 이 경로에만 붙인다)
    await this.pollControl();
  }

  /** 관제 조회 박자 [시뮬] — 계약 설명 "화면은 10초마다 다시 부른다" */
  private static readonly CONTROL_POLL_SEC = 10;

  private async pollControl() {
    if (this.writeAccess === 'remote') {
      this.controlStatus = '라이더 관제: 다른 기기에서는 안 보임(라이더 위치는 라이더 운영·관리자만 — 개발 서버가 있는 PC 에서만)';
      return;
    }
    if (!this.controlAvailable) {
      this.controlStatus = this.writeAccess === 'unknown' ? null : '라이더 관제: 이 PC 에 관제 계정 비밀번호 파일 없음 — 라이더 앱 라이더 위치 못 봄';
      return;
    }
    if (this.clock.now - this.lastControlAt < RealWorld.CONTROL_POLL_SEC) return;
    this.lastControlAt = this.clock.now;
    try {
      const list = await this.backend.listRiderLocations(this.params.mfcId);
      this.lastControl = { items: list.items ?? [], asOf: list.asOf };
      const seen = new Set<string>();
      let located = 0;
      for (const c of list.items ?? []) {
        if (!c.riderId) continue;
        const sim = isSimRiderId(c.riderId);
        // 시뮬레이터 라이더는 위 3번(본인 조회)·이 브라우저 엔진이 그린다 — 여기서는 라이더 앱 라이더만
        if (sim) continue;
        seen.add(c.riderId);
        let r = this.appRiders.get(c.riderId);
        if (!r) {
          r = new AppRider(c.riderId);
          this.appRiders.set(c.riderId, r);
        }
        const loc = c.location;
        const p = loc?.lat !== undefined && loc?.lng !== undefined ? { lat: loc.lat, lng: loc.lng } : null;
        r.setServerPos(p, this.clock.now);
        if (p) located++;
        // 화면 번호(ADR-0070) "김*수 · 482913" — 번호가 없으면 고유번호 앞 4자리
        r.label = [c.nameMasked, c.riderNumber ?? shortRiderId(c.riderId)].filter(Boolean).join(" · ");
        const d = c.activeDeliveries?.[0];
        r.deliveryId = d?.deliveryId ?? null;
        r.locationOffline = !!c.stale;
        r.locationAgeSec = c.staleSinceSeconds ?? null;
        r.phase = d ? (STAGE_PHASE[d.stage ?? ''] ?? (d.pickedUp ? 'TO_CUSTOMER' : 'TO_STORE')) : 'IDLE';
        const age = c.staleSinceSeconds;
        r.note = [
          '라이더 앱',
          d ? `${STAGE_LABEL[d.stage ?? ''] ?? '진행 중'}` : '배송 없음',
          p ? `위치 ${age ?? '?'}초 전${c.stale ? ' — 끊김' : ''}` : '위치 아직 없음',
        ].join(' · ');
      }
      for (const id of [...this.appRiders.keys()]) if (!seen.has(id)) this.appRiders.delete(id); // 운행 끈 라이더는 목록에서 빠진다
      this.controlStatus = `라이더 관제(관제 계정 claude-dev, 이 PC 만): 운행 중 라이더 앱 라이더 ${seen.size}명 · 위치 있음 ${located}명`;
    } catch (e) {
      this.controlStatus = `라이더 관제 실패: ${describe(e)}`;
    }
  }

  private infer(type: DomainEventType, summary: string, deliveryId?: string, riderId?: string) {
    push(this.eventLog, {
      at: this.clock.now,
      type,
      summary: `${summary} (조회로 추정)`,
      inferred: true,
      deliveryId,
      riderId: riderId ?? this.rowRider(deliveryId),
    });
  }

  /** 그 배송의 지금 배정 라이더(목록·배차 조회에서 읽은 값) */
  private rowRider(deliveryId: string | undefined): string | undefined {
    if (!deliveryId) return undefined;
    const r = this.rows.get(deliveryId);
    return r?.dispatch?.assignment?.riderId ?? r?.summary.riderId ?? undefined;
  }

  private inferExec(id: string, state: string | undefined) {
    if (state === 'PICKED_UP') this.infer('PickupCompleted', `${id} 수행 PICKED_UP`, id);
    else if (state === 'COMPLETED') this.infer('DeliveryCompleted', `${id} 수행 COMPLETED`, id);
    else if (state === 'FAILED') this.infer('DeliveryFailed', `${id} 수행 FAILED`, id);
  }

  private inferDispatch(id: string, state: string | undefined, riderId: string | undefined) {
    if (state === 'ASSIGNED') this.infer('DeliveryAssigned', `${id} → ${riderId ?? '?'}`, id, riderId);
    else if (state === 'DISPATCH_FAILED') this.infer('DispatchFailed', `${id} 배차 실패`, id);
    else if (state === 'CANCELLED_BEFORE_PICKUP') this.infer('DeliveryCancelledBeforePickup', `${id} 픽업 전 취소`, id);
  }

  deliveryCards(): DeliveryCard[] {
    return [...this.rows.values()].map((r) => {
      const s = r.summary;
      const d = r.dispatch;
      const at = d?.attempts?.[d.attempts.length - 1];
      return {
        deliveryId: s.deliveryId as string,
        orderId: s.orderId ?? d?.orderId ?? null,
        orderNumber: s.orderNumber ?? null,
        deliveryNumber: s.deliveryNumber ?? null,
        shipmentId: d ? (d.shipmentId ?? null) : null,
        dispatchState: d?.state ?? null,
        executionState: s.state ?? null,
        riderId: d?.assignment?.riderId ?? s.riderId ?? null,
        riderIds: involvedRiders(r),
        radiusKm: d?.state === 'DISPATCHING' ? (at?.currentRadiusKm ?? null) : null,
        customer: null,
        purpose: d?.purpose ?? null,
        pickup: null,
        createdAt: s.createdAt ? (Date.parse(s.createdAt) - this.startWall) / 1000 : 0,
      };
    });
  }

  /**
   * 실서버 배송 한 건의 흐름 — 관찰 계정으로 읽은 배차 관점(생성·제안·배정)과 직원 배송 목록(배정·픽업·완료) 시각, 실제 시각.
   * 가게 도착은 목록에 없어, 이 브라우저가 움직인 가상 라이더 배송이면 엔진이 잰 시각을 출처 "라이더 엔진"으로 붙인다.
   */
  deliveryTimeline(deliveryId: string): DeliveryTimeline | null {
    const r = this.rows.get(deliveryId);
    if (!r) return null;
    const s = r.summary;
    const d = r.dispatch;
    // 배송 생성은 배차 쪽 시각이 먼저(수행 사본은 DeliveryCreated 를 받은 뒤라 조금 늦다 — 취소가 생성보다 앞서 보이는 것을 막음)
    const created = d?.createdAt ?? s.createdAt;
    const steps: TimelineStep[] = dispatchSteps(d, created ? Date.parse(created) : null);
    steps.push(...summarySteps(s, steps.some((x) => x.key === 'assigned')));
    const trip = [...this.driven.values()].map((v) => v.trip).find((t) => t?.deliveryId === deliveryId) ?? this.doneTrips.get(deliveryId);
    if (trip?.storeArrivedAt !== undefined) {
      steps.push({ key: 'engine-store', label: '가게 도착', atMs: this.clock.epochMs(trip.storeArrivedAt), source: '라이더 엔진' });
    }
    const terminal = TERMINAL_X.has(s.state ?? '') || d?.state === 'DISPATCH_FAILED' || d?.state === 'CANCELLED_BEFORE_PICKUP';
    const gaps = ['가게 도착·고객 도착 시각은 직원 배송 목록에 없다 — 이 화면이 움직인 가상 라이더 배송만 엔진이 잰 가게 도착을 보인다'];
    if (!d) gaps.unshift('배차 관점을 아직 못 읽음 — 제안 시각 없음');
    if (s.state === 'FAILED' || s.state === 'CANCELLED') gaps.push(`수행 ${s.state} — 그 시각은 목록에 없다`);
    return assemble({ deliveryId, orderId: s.orderId ?? d?.orderId ?? null, orderNumber: s.orderNumber ?? null, deliveryNumber: s.deliveryNumber ?? null, purpose: d?.purpose ?? null, basis: 'real', gaps }, steps, terminal);
  }

  /**
   * 실서버 지표 — 관찰 계정으로 읽은 최근 배송(최대 30건) 기준, 실제 시각.
   * 구간은 직원 배송 목록의 시각(createdAt·assignedAt·pickedUpAt·completedAt)으로 잰다. 가게 도착 시각은 목록에 없어
   * "MFC 로 이동"과 "가게에서 대기·인계"를 한 구간으로 묶는다.
   */
  metrics(): MetricsSummary {
    let completed = 0;
    let delivering = 0;
    let searching = 0;
    let failed = 0;
    let deliveryFailed = 0;
    const full: number[][] = [];
    for (const r of this.rows.values()) {
      const s = r.summary;
      if (s.state === 'COMPLETED') completed++;
      else if (s.state === 'FAILURE_REPORTED' || s.state === 'FAILED') deliveryFailed++;
      else if (r.dispatch?.state === 'DISPATCH_FAILED') failed++;
      else if (s.state === 'UNASSIGNED') searching++;
      else if (!TERMINAL_X.has(s.state ?? '')) delivering++;
      const t = [s.createdAt, s.assignedAt, s.pickedUpAt, s.completedAt].map((x) => (x ? Date.parse(x) / 1000 : NaN));
      if (s.state === 'COMPLETED' && t.every((x) => Number.isFinite(x))) {
        full.push([(t[1] as number) - (t[0] as number), (t[2] as number) - (t[1] as number), (t[3] as number) - (t[2] as number)]);
      }
    }
    const base = { completed, deliveryFailed, responseLost: this.apiErrors, delivering, searching, dispatchFailed: failed, timeBasis: 'real' as const, apiErrors: this.apiErrors };
    if (!full.length) return { ...base, phases: null };
    const avg = (i: number) => full.reduce((a, r) => a + (r[i] as number), 0) / full.length;
    const segments: PhaseSegment[] = [
      { key: 'findRider', label: '라이더 찾기', sec: avg(0), hint: '배송 생성 → 배정(직원 배송 목록 createdAt → assignedAt)' },
      { key: 'storeAll', label: 'MFC 로 이동·가게(인계까지)', sec: avg(1), hint: '배정 → 픽업 완료(assignedAt → pickedUpAt) — 가게 도착 시각은 목록에 없음' },
      { key: 'toCustomer', label: '고객에게 이동·전달', sec: avg(2), hint: '픽업 완료 → 전달 완료(pickedUpAt → completedAt)' },
    ];
    return { ...base, phases: { n: full.length, totalSec: segments.reduce((a, x) => a + x.sec, 0), segments } };
  }

  diagnostics(): string[] {
    const withD = [...this.rows.values()].filter((r) => r.dispatch);
    const filled = withD.filter((r) => r.dispatch?.shipmentId).length;
    const errs = [...this.rows.values()].filter((r) => r.dispatchError).map((r) => r.dispatchError);
    const lines = [this.authStatus, this.status];
    const m = this.mfcLocation;
    lines.push(
      this.center
        ? `MFC 위치: center-master ${this.center.label} (${m.lat.toFixed(5)}, ${m.lng.toFixed(5)})`
        : `MFC 위치: center-master 못 읽음(${this.centerError ?? '읽는 중'}) — 지도는 설정값 [가정]`,
    );
    if (withD.length) lines.push(`dispatch shipmentId 실측(§5): 채워짐 ${filled} / 읽은 배송 ${withD.length}`);
    if (errs.length) lines.push(`배차 조회 실패 ${errs.length}건 — 예: ${errs[0]}`);
    lines.push(this.operationLock ?? '실서버 가상 라이더 운행 가능(잠금 풀림)');
    if (this.controlStatus) lines.push(this.controlStatus);
    const loc = this.locator as { ready: boolean; reason?: string | null } | null;
    lines.push(
      loc?.ready
        ? '오배송 다시 배송: 받음 — 전달지 주소는 개발 서버 카카오 주소 검색으로 찾음(도로명 주소만, 기록 안 함)'
        : `오배송 다시 배송: 거절 — 주소 검색 준비 안 됨(${loc?.reason ?? '없음'})`,
    );
    return lines;
  }
}

/** 배송에 관여한 라이더 — 배정 라이더 + 배차 시도의 제안 대상(관찰 계정이 볼 수 있는 만큼) */
function involvedRiders(r: Row): string[] {
  const set = new Set<string>();
  for (const at of r.dispatch?.attempts ?? []) for (const o of at.offers ?? []) if (o.riderId) set.add(o.riderId);
  const a = r.dispatch?.assignment?.riderId ?? r.summary.riderId;
  if (a) set.add(a);
  return [...set];
}

function describe(e: unknown): string {
  if (e instanceof ApiProblem) return `${e.status} ${e.code ?? ''}`.trim();
  return e instanceof Error ? e.message : String(e);
}

function push<T>(ring: T[], v: T, max = RING) {
  ring.push(v);
  if (ring.length > max) ring.splice(0, ring.length - max);
}
