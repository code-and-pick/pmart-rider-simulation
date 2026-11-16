// MOCK 백엔드: 계약 의미를 브라우저 안에서 흉내 낸다. 실서버 동작을 대신하지 않는다(CLAUDE.md).
//
// 다른 서비스가 하는 일도 여기서 대신한다(MOCK 에서만):
//  - 주문 유입·점원 배차 요청(DispatchRequested)·포장 끝(ShipmentReady) → order / mfc-fulfillment
//  - 배차 시도·반경 단계 제안·만료·동시 수락 1명·재시도               → delivery-dispatch
//  - 사건 반영(배정 → execution ASSIGNED, 인계 → PICKED_UP 등)         → 서비스 사이 사건(지연 eventLagSec)
// 정한 값(반경 단계 시간·fence 유효시간·사건 지연·제안 대상 등)은 src/config.ts MockParams 와 docs/backend-requests.md 에 둔다.
//
// 흉내의 단순화 [시뮬]:
//  - AI 추천 제안은 그 반경 단계 안 적격 라이더 모두에게 한 번에 보낸다(실서버는 OR-Tools·AI 서버가 고른다).
//  - 전달지(drop-info)는 가짜 값 — 실제 개인정보가 아니다. 좌표만 의미가 있다.
//  - 회수 배송(DD-2)·운영자 결정·고객 반품은 만들지 않는다(P4 후보).

import { CONTRACT, isSimRiderId, type MockParams } from '../../config';
import {
  ApiProblem,
  type AccountRestriction,
  type AssignmentCancellationRequest,
  type CommandResponse,
  type CompletionRequest,
  type Delivery,
  type DeliveryExecution,
  type DeliveryListItem,
  type DeliveryListResponse,
  type DispatchAttempt,
  type DispatchSettings,
  type DispatchState,
  type DomainEventType,
  type DropInfo,
  type EvidencePhoto,
  type ExecutionState,
  type FailureRequest,
  type FenceState,
  type HandoverAuthorization,
  type HandoverAuthorizationRequest,
  type HandoverCommitRequest,
  type HandoverCommitResult,
  type HandoverResolution,
  type HelpRequest,
  type HelpRequestCreate,
  type LocationBatch,
  type MyDeliveriesResponse,
  type Offer,
  type OfferListResponse,
  type OfferResponseRequest,
  type OfferResponseResult,
  type OfferSource,
  type OfferState,
  type OperatingState,
  type OperatingStateRequest,
  type PackageState,
  type PickupRequest,
  type RiderLocation,
  type RiderProfile,
  type RiderSignupRequest,
  type Shipment,
  type ShipmentState,
  type StaffDeliveryListResponse,
  type StatusHistoryEntry,
  type TransitionRequest,
  type VehicleType,
  type Withdrawal,
} from '../../domain/contract';
import type { SimClock } from '../../sim/clock';
import { destination, distanceM, type LatLng } from '../../util/geo';
import { IdGen, Rng } from '../../util/rng';
import type {
  ApiCallRecord,
  ApiListener,
  DomainEventRecord,
  EventListener,
  ObserverApi,
  RiderApi,
  RiderPort,
  WriteOptions,
} from '../port';

// ───────────── 내부 상태 ─────────────

interface MRider {
  riderId: string;
  signedUp: boolean;
  version: number;
  phone: string;
  name?: string;
  vehicleType: VehicleType;
  deliveryAreas: { mfcId?: string; zoneId?: string }[];
  joinedAt: number;
  operating: { status: 'OFF_DUTY' | 'ON_DUTY'; newDispatchEnabled: boolean; mfcId?: string; changedAt: number; version: number };
  settings: { oneAtATime: boolean; dispatchMode: 'NORMAL' | 'AI_RECOMMENDED'; version: number };
  restriction: AccountRestriction;
  location?: { lat: number; lng: number; accuracyM?: number; recordedAt: string; receivedAt: number };
  consecutiveRejections: number;
  /** 탈퇴 완료 [시뮬] — 계약은 탈퇴 뒤 모습을 정하지 않음(RR-07 질문) */
  withdrawn: boolean;
}

interface MFence {
  state: FenceState;
  authId: string | null;
  fenceVersion: number;
  riderId: string | null;
  deliveryId: string | null;
  expiresAt: number | null;
  authorizedAt: number | null;
}

interface MPackage {
  packageId: string;
  packageVersion: number;
  version: number;
  state: PackageState;
  qrCode: string;
  fence: MFence;
  handoverId: string | null;
  handedOverAt: number | null;
  sealedAt: number | null;
}

interface MShipment {
  shipmentId: string;
  orderId: string;
  deliveryId: string | null;
  version: number;
  state: ShipmentState;
  packages: MPackage[];
  dispatchRequestedAt: number | null;
  estimatedPackMinutes: number;
  readyAt: number | null;
}

interface MAttempt {
  attemptId: string;
  trigger: 'AUTO' | 'STORE_STAFF' | 'REASSIGN' | 'RETRY';
  state: 'SEARCHING' | 'OFFERING' | 'ASSIGNED' | 'FAILED' | 'CANCELLED';
  startedAt: number;
  deadlineAt: number;
  retryCount: number;
  excluded: Set<string>;
  failureReason?: 'NO_RIDER' | 'REPEATED_REJECTION' | 'EXPIRED' | 'SYSTEM_FAILURE';
  radiusKm: number;
}

interface MAssignment {
  assignmentId: string;
  riderId: string;
  assignedAt: number;
  state: 'ASSIGNED' | 'PICKED_UP' | 'CANCELLED' | 'COMPLETED';
  pickedUpAt?: number;
  handoverIds: string[];
  version: number;
}

interface MHelp {
  requestId: string;
  category: string;
  stage: ExecutionState;
  detail: string | null;
  evidenceRefs: string[];
  createdAt: number;
}

/** MOCK 배송 하나 — 배차(dispatch) 쪽과 수행(execution) 쪽을 따로 갖는다(docs/design.md §4). */
export interface MDelivery {
  deliveryId: string;
  orderId: string;
  shipmentId: string;
  mfcId: string;
  /** MOCK 고객 위치 — 실서버에는 없는 정보(실서버는 배정 라이더가 drop-info 로만 안다) */
  customer: LatLng;
  createdAt: number;
  d: {
    state: DispatchState;
    version: number;
    attempts: MAttempt[];
    assignment: MAssignment | null;
    updatedAt: number;
  };
  x: {
    exists: boolean;
    state: ExecutionState;
    version: number;
    riderId: string | null;
    handoverIds: string[];
    packageIds: string[];
    history: StatusHistoryEntry[];
    photos: string[];
    evidence?: { method: string; photoRefs: string[]; takenAt: string; placement?: string };
    failure?: { reason: string; goodsLocation?: string; photoRefs: string[]; contactAttempts: number; reportedAt: string };
    helps: MHelp[];
    assignedAt?: number;
    completedAt?: number;
  };
}

interface MOffer {
  offerId: string;
  attemptId: string;
  deliveryId: string;
  riderId: string;
  radiusKm: number;
  sentAt: number;
  expiresAt: number;
  state: OfferState;
  viewedAt: number | null;
  source: OfferSource;
}

interface MPhoto {
  photoRef: string;
  deliveryId: string;
  riderId: string;
  contentType: EvidencePhoto['contentType'];
  sizeBytes: number;
  uploadedAt: number;
}

type IdemOutcome = { ok: unknown } | { err: unknown };

const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const CUSTOMER_REASONS = new Set(['CUSTOMER_ABSENT', 'UNREACHABLE', 'ADDRESS_ERROR', 'REFUSED']);

function fail(status: number, code: string, title?: string): never {
  throw new ApiProblem(status, { status, code, title: title ?? code, type: 'about:blank', traceId: 'mock' });
}

export interface MockOrderOptions {
  /** 고객 위치(없으면 MFC 둘레 아무 곳) */
  customer?: LatLng;
  /** 주문 → 배차 요청까지 초 */
  pickSec?: number;
  /** 배차 요청 → 포장 끝까지 분 */
  packMinutes?: number;
  packages?: number;
}

export class MockBackend implements RiderPort {
  readonly mode = 'mock' as const;
  readonly observer: ObserverApi;

  readonly riders = new Map<string, MRider>();
  readonly deliveries = new Map<string, MDelivery>();
  readonly shipments = new Map<string, MShipment>();
  readonly offers = new Map<string, MOffer>();
  private readonly photos = new Map<string, MPhoto>();
  private readonly withdrawals = new Map<string, { riderId: string; state: 'PENDING' | 'COMPLETED' | 'REJECTED' }>();
  private readonly idem = new Map<string, { fp: string; outcome: IdemOutcome }>();
  private readonly later: { at: number; fn: () => void }[] = [];
  private readonly apiListeners = new Set<ApiListener>();
  private readonly eventListeners = new Set<EventListener>();
  private readonly ids = new IdGen('m');
  private readonly rng: Rng;
  private readonly riderApis = new Map<string, RiderApi>();

  /** false 면 주문을 스스로 만들지 않는다(시험에서 createOrder 로 직접 넣을 때) */
  autoOrders = true;
  private nextOrderAt: number;

  constructor(
    private readonly clock: SimClock,
    readonly mfcId: string,
    readonly mfcLocation: LatLng,
    readonly params: MockParams,
    seed: number,
  ) {
    this.rng = new Rng(seed ^ 0x5eed);
    this.nextOrderAt = this.rng.exp(3600 / Math.max(0.1, params.ordersPerHour));
    this.observer = this.makeObserver();
  }

  // ───────────── 포트 ─────────────

  asRider(riderId: string): RiderApi {
    // RR-01 조건 3 을 MOCK 에서도 같게 — 시뮬레이터 라이더만
    if (!isSimRiderId(riderId)) throw new Error(`시뮬레이터 라이더 ID 가 아님: ${riderId}`);
    let api = this.riderApis.get(riderId);
    if (!api) {
      api = this.makeRiderApi(riderId);
      this.riderApis.set(riderId, api);
    }
    return api;
  }

  onApiCall(listener: ApiListener): () => void {
    this.apiListeners.add(listener);
    return () => this.apiListeners.delete(listener);
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  // ───────────── 세계 진행 (MOCK 이 다른 서비스 대신) ─────────────

  tick(): void {
    const now = this.clock.now;
    // 사건 반영(지연된 일)
    if (this.later.length) {
      const due = this.later.filter((l) => l.at <= now);
      if (due.length) {
        this.later.splice(0, this.later.length, ...this.later.filter((l) => l.at > now));
        due.sort((a, b) => a.at - b.at);
        for (const l of due) l.fn();
      }
    }
    if (this.autoOrders) this.generateOrders();
    this.expireOffers();
    for (const del of this.deliveries.values()) if (del.d.state === 'DISPATCHING') this.dispatchStep(del);
    this.expireFences();
  }

  private generateOrders() {
    const h = this.clock.seoulHour();
    const { startHour, endHour } = CONTRACT.dispatchHours;
    if (h < startHour || h >= endHour) return;
    while (this.clock.now >= this.nextOrderAt) {
      this.createOrder();
      this.nextOrderAt += this.rng.exp(3600 / Math.max(0.1, this.params.ordersPerHour));
    }
  }

  /** 주문 하나 → (pickSec 뒤) 점원 배차 요청 → (packMinutes 뒤) 출하 대기. 시험에서도 부른다. */
  createOrder(opts: MockOrderOptions = {}): { orderId: string; shipmentId: string } {
    const p = this.params;
    const orderId = this.ids.next('OR');
    const shipmentId = this.ids.next('SH');
    const n = opts.packages ?? this.rng.int(p.packagesPerShipment[0], p.packagesPerShipment[1]);
    const packages: MPackage[] = [];
    for (let i = 0; i < n; i++) {
      const packageId = this.ids.next('PK');
      packages.push({
        packageId,
        packageVersion: 1,
        version: 0,
        state: 'OPEN',
        qrCode: `PKG:${packageId}:1`,
        fence: { state: 'NONE', authId: null, fenceVersion: 0, riderId: null, deliveryId: null, expiresAt: null, authorizedAt: null },
        handoverId: null,
        handedOverAt: null,
        sealedAt: null,
      });
    }
    const packMinutes = opts.packMinutes ?? this.rng.range(p.packMinutes[0], p.packMinutes[1]);
    const ship: MShipment = {
      shipmentId,
      orderId,
      deliveryId: null,
      version: 0,
      state: 'PREPARING',
      packages,
      dispatchRequestedAt: null,
      estimatedPackMinutes: Math.round(packMinutes),
      readyAt: null,
    };
    this.shipments.set(shipmentId, ship);
    const customer =
      opts.customer ?? destination(this.mfcLocation, this.rng.range(0, 360), this.rng.range(p.customerDistanceM[0], p.customerDistanceM[1]));
    const pickSec = opts.pickSec ?? this.rng.range(p.pickSec[0], p.pickSec[1]);
    this.schedule(pickSec, () => this.dispatchRequest(ship, customer, packMinutes));
    return { orderId, shipmentId };
  }

  /** 점원 배차 요청(패킹 시작) — DispatchRequested → 배송 생성·배차 시작 */
  private dispatchRequest(ship: MShipment, customer: LatLng, packMinutes: number) {
    const now = this.clock.now;
    ship.dispatchRequestedAt = now;
    ship.version++;
    this.emit('DispatchRequested', `${ship.shipmentId} 배차 요청(예상 포장 ${Math.round(packMinutes)}분)`);
    const deliveryId = this.ids.next('DL');
    ship.deliveryId = deliveryId;
    const del: MDelivery = {
      deliveryId,
      orderId: ship.orderId,
      shipmentId: ship.shipmentId,
      mfcId: this.mfcId,
      customer,
      createdAt: now,
      d: { state: 'DISPATCHING', version: 1, attempts: [], assignment: null, updatedAt: now },
      x: {
        exists: false,
        state: 'UNASSIGNED',
        version: 0,
        riderId: null,
        handoverIds: [],
        packageIds: [],
        history: [],
        photos: [],
        helps: [],
      },
    };
    this.deliveries.set(deliveryId, del);
    this.emit('DeliveryCreated', `${deliveryId} (출고 ${ship.shipmentId})`);
    this.startAttempt(del, 'STORE_STAFF', 0, new Set());
    this.schedule(this.lag(), () => {
      if (!del.x.exists) {
        del.x.exists = true;
        this.xHistory(del, 'UNASSIGNED', 'SYSTEM_EVENT', 'DeliveryCreated');
      }
    });
    this.schedule(packMinutes * 60, () => this.shipmentReady(ship));
  }

  private shipmentReady(ship: MShipment) {
    if (ship.state !== 'PREPARING') return;
    const now = this.clock.now;
    for (const pk of ship.packages) {
      pk.state = 'SEALED';
      pk.sealedAt = now;
      pk.version++;
    }
    this.emit('PackingFinished', `${ship.shipmentId} 포장 ${ship.packages.length}개`);
    ship.state = 'READY';
    ship.readyAt = now;
    ship.version++;
    this.emit('ShipmentReady', `${ship.shipmentId} 출하 대기`);
  }

  private startAttempt(del: MDelivery, trigger: MAttempt['trigger'], retryCount: number, excluded: Set<string>) {
    const now = this.clock.now;
    del.d.attempts.push({
      attemptId: this.ids.next('AT'),
      trigger,
      state: 'SEARCHING',
      startedAt: now,
      deadlineAt: now + CONTRACT.dispatchAttemptDeadlineSec,
      retryCount,
      excluded,
      radiusKm: CONTRACT.radiusStepsKm[0],
    });
  }

  private currentAttempt(del: MDelivery): MAttempt | undefined {
    return del.d.attempts[del.d.attempts.length - 1];
  }

  private dispatchStep(del: MDelivery) {
    const now = this.clock.now;
    const at = this.currentAttempt(del);
    if (!at || (at.state !== 'SEARCHING' && at.state !== 'OFFERING')) return;
    if (now >= at.deadlineAt) {
      at.state = 'FAILED';
      at.failureReason = 'NO_RIDER';
      if (at.retryCount < CONTRACT.dispatchMaxRetries) {
        this.startAttempt(del, 'RETRY', at.retryCount + 1, at.excluded);
      } else {
        this.setDispatchState(del, 'DISPATCH_FAILED');
        this.emit('DispatchFailed', `${del.deliveryId} 라이더 없음(재시도 ${at.retryCount}회)`);
      }
      return;
    }
    const steps = CONTRACT.radiusStepsKm;
    const idx = Math.min(Math.floor((now - at.startedAt) / this.params.radiusStepSec), steps.length - 1);
    at.radiusKm = steps[idx] as number;
    for (const r of this.riders.values()) {
      if (at.excluded.has(r.riderId)) continue;
      if (!this.offerEligible(r)) continue;
      if (r.settings.dispatchMode !== 'AI_RECOMMENDED') continue;
      if (!r.location || distanceM(r.location, this.mfcLocation) > at.radiusKm * 1000) continue;
      let already = false;
      for (const o of this.offers.values()) {
        if (o.attemptId === at.attemptId && o.riderId === r.riderId) {
          already = true;
          break;
        }
      }
      if (already) continue;
      const offer: MOffer = {
        offerId: this.ids.next('OF'),
        attemptId: at.attemptId,
        deliveryId: del.deliveryId,
        riderId: r.riderId,
        radiusKm: at.radiusKm,
        sentAt: now,
        expiresAt: now + CONTRACT.offerResponseWindowSec,
        state: 'SENT',
        viewedAt: null,
        source: 'AI_RECOMMENDED',
      };
      this.offers.set(offer.offerId, offer);
      at.state = 'OFFERING';
      this.emit('DispatchOfferSent', `${del.deliveryId} → ${r.riderId} (반경 ${at.radiusKm}km)`);
    }
  }

  private expireOffers() {
    const now = this.clock.now;
    for (const o of this.offers.values()) {
      if (o.state === 'SENT' && now >= o.expiresAt) this.expireOffer(o);
    }
  }

  private expireOffer(o: MOffer) {
    o.state = 'EXPIRED';
    // 상세를 본 뒤 응답 없이 만료되면 거절 횟수에 넣는다(dispatch getOffer 설명)
    if (o.viewedAt !== null) {
      const r = this.riders.get(o.riderId);
      if (r) r.consecutiveRejections++;
    }
  }

  private expireFences() {
    const now = this.clock.now;
    for (const s of this.shipments.values()) {
      for (const pk of s.packages) {
        if (pk.fence.state === 'HANDOVER_IN_PROGRESS' && pk.fence.expiresAt !== null && now >= pk.fence.expiresAt) {
          pk.fence.state = 'EXPIRED';
        }
      }
    }
  }

  // ───────────── 공통 도우미 ─────────────

  private schedule(delaySec: number, fn: () => void) {
    this.later.push({ at: this.clock.now + Math.max(0, delaySec), fn });
  }

  private lag(): number {
    return this.rng.range(this.params.eventLagSec[0], this.params.eventLagSec[1]);
  }

  private emit(type: DomainEventType, summary: string) {
    const rec: DomainEventRecord = { at: this.clock.now, type, summary };
    for (const l of this.eventListeners) l(rec);
  }

  private log(actor: string, method: ApiCallRecord['method'], path: string, status: number | 'ERR', code?: string) {
    const rec: ApiCallRecord = { at: this.clock.now, actor, method, path, status, code, ms: 0 };
    for (const l of this.apiListeners) l(rec);
  }

  /** 한 API 호출을 감싼다: 기록, 멱등(같은 키·같은 본문 = 같은 결과, 다른 본문 = 409), 오류 형태. */
  private async call<T>(
    actor: string,
    method: ApiCallRecord['method'],
    path: string,
    fn: () => T,
    idem?: { key: string; body: unknown },
    okStatus = 200,
  ): Promise<T> {
    if (idem) {
      const k = `${actor}|${method}|${path}|${idem.key}`;
      const fp = JSON.stringify(idem.body ?? null);
      const prev = this.idem.get(k);
      if (prev) {
        if (prev.fp !== fp) {
          this.log(actor, method, path, 409, 'IDEMPOTENCY_CONFLICT');
          fail(409, 'IDEMPOTENCY_CONFLICT');
        }
        this.log(actor, method, path, 'err' in prev.outcome ? statusOf(prev.outcome.err) : okStatus, 'IDEMPOTENT_REPLAY');
        if ('err' in prev.outcome) throw prev.outcome.err;
        return prev.outcome.ok as T;
      }
      try {
        const v = fn();
        this.idem.set(k, { fp, outcome: { ok: v } });
        this.log(actor, method, path, okStatus);
        return v;
      } catch (e) {
        // 업무 거절(4xx)만 같은 결과로 기억한다
        if (e instanceof ApiProblem && e.status < 500 && e.code !== 'IDEMPOTENCY_CONFLICT') this.idem.set(k, { fp, outcome: { err: e } });
        this.log(actor, method, path, statusOf(e), e instanceof ApiProblem ? e.code : undefined);
        throw e;
      }
    }
    try {
      const v = fn();
      this.log(actor, method, path, okStatus);
      return v;
    } catch (e) {
      this.log(actor, method, path, statusOf(e), e instanceof ApiProblem ? e.code : undefined);
      throw e;
    }
  }

  private cmd(requestId: string, extra: Partial<CommandResponse> = {}): CommandResponse {
    return { status: 'APPLIED', requestId, occurredAt: this.clock.iso(), ...extra };
  }

  private rider(riderId: string): MRider {
    let r = this.riders.get(riderId);
    if (!r) {
      r = {
        riderId,
        signedUp: false,
        version: 0,
        phone: '',
        vehicleType: 'MOTORCYCLE',
        deliveryAreas: [],
        joinedAt: 0,
        operating: { status: 'OFF_DUTY', newDispatchEnabled: false, changedAt: 0, version: 0 },
        settings: { oneAtATime: false, dispatchMode: 'AI_RECOMMENDED', version: 0 },
        restriction: 'NORMAL',
        consecutiveRejections: 0,
        withdrawn: false,
      };
      this.riders.set(riderId, r);
    }
    return r;
  }

  private signedRider(riderId: string): MRider {
    const r = this.rider(riderId);
    if (!r.signedUp) fail(404, 'NOT_FOUND', '가입하지 않은 라이더');
    return r;
  }

  activeDeliveryCount(riderId: string): number {
    let n = 0;
    for (const d of this.deliveries.values()) {
      if (d.d.assignment?.riderId === riderId && (d.d.state === 'ASSIGNED' || d.d.state === 'PICKED_UP')) n++;
    }
    return n;
  }

  /** 제안을 받을 수 있는 상태인가 — GET /offers pollAfterSec null 조건과 같다 */
  private offerEligible(r: MRider): boolean {
    if (!r.signedUp) return false;
    if (r.operating.status !== 'ON_DUTY' || !r.operating.newDispatchEnabled) return false;
    if (r.restriction !== 'NORMAL') return false;
    const active = this.activeDeliveryCount(r.riderId);
    if (r.settings.oneAtATime && active > 0) return false;
    return active < CONTRACT.deliveryListAcceptMax;
  }

  private delivery(deliveryId: string): MDelivery {
    const d = this.deliveries.get(deliveryId);
    if (!d) fail(404, 'NOT_FOUND');
    return d;
  }

  /** execution 쪽에서 이 라이더의 배송(배정 라이더 본인만 — 아니면 404, 있는지 알리지 않음) */
  private myExec(riderId: string, deliveryId: string): MDelivery {
    const d = this.deliveries.get(deliveryId);
    if (!d || !d.x.exists || d.x.riderId !== riderId) fail(404, 'NOT_FOUND');
    return d;
  }

  private checkVersion(current: number, expected?: number) {
    if (expected !== undefined && expected !== current) fail(409, 'VERSION_CONFLICT');
  }

  private setDispatchState(del: MDelivery, s: DispatchState) {
    del.d.state = s;
    del.d.version++;
    del.d.updatedAt = this.clock.now;
  }

  private xHistory(del: MDelivery, state: ExecutionState, actor: 'RIDER' | 'SYSTEM_EVENT' | 'OPERATOR', sourceRef?: string) {
    del.x.state = state;
    del.x.version++;
    del.x.history.push({ state, occurredAt: this.clock.iso(), recordedAt: this.clock.iso(), actor, sourceRef });
  }

  private xTransition(riderId: string, deliveryId: string, from: ExecutionState[], to: ExecutionState, expected?: number): MDelivery {
    const del = this.myExec(riderId, deliveryId);
    this.checkVersion(del.x.version, expected);
    if (!from.includes(del.x.state)) fail(409, 'INVALID_STATE', `${del.x.state} 에서 ${to} 로 갈 수 없음`);
    this.xHistory(del, to, 'RIDER');
    return del;
  }

  // ───────────── 배정 ─────────────

  private assign(del: MDelivery, riderId: string) {
    const now = this.clock.now;
    const at = this.currentAttempt(del);
    if (at) at.state = 'ASSIGNED';
    const assignment: MAssignment = {
      assignmentId: this.ids.next('AS'),
      riderId,
      assignedAt: now,
      state: 'ASSIGNED',
      handoverIds: [],
      version: 1,
    };
    del.d.assignment = assignment;
    this.setDispatchState(del, 'ASSIGNED');
    for (const o of this.offers.values()) {
      if (o.deliveryId === del.deliveryId && o.state === 'SENT' && o.riderId !== riderId) o.state = 'SUPERSEDED';
    }
    this.emit('DeliveryAssigned', `${del.deliveryId} → ${riderId}`);
    // execution 사본은 사건으로 조금 늦게(docs/design.md §4)
    this.schedule(this.lag(), () => {
      if (del.d.assignment?.assignmentId !== assignment.assignmentId) return; // 그 사이 배정이 바뀜
      del.x.exists = true;
      del.x.riderId = riderId;
      del.x.assignedAt = now;
      this.xHistory(del, 'ASSIGNED', 'SYSTEM_EVENT', 'DeliveryAssigned');
    });
  }

  private lateResult(o: MOffer | null, offerId: string, reason: OfferResponseResult['lateReason'], deliveryId: string): OfferResponseResult {
    if (o && (o.state === 'SENT' || o.state === 'EXPIRED' || o.state === 'SUPERSEDED')) o.state = 'LATE';
    return { offerId, outcome: 'LATE', lateReason: reason, deliveryId, decidedAt: this.clock.iso() };
  }

  private respond(riderId: string, offerId: string, body: OfferResponseRequest): OfferResponseResult {
    const o = this.offers.get(offerId);
    if (!o || o.riderId !== riderId) fail(404, 'NOT_FOUND');
    if (body.response !== 'ACCEPT' && body.response !== 'REJECT') fail(400, 'VALIDATION_FAILED');
    if (o.state === 'SENT' && this.clock.now >= o.expiresAt) this.expireOffer(o);
    const del = this.delivery(o.deliveryId);
    const r = this.rider(riderId);
    if (body.response === 'REJECT') {
      if (o.state !== 'SENT') {
        if (o.state === 'EXPIRED') return this.lateResult(o, offerId, 'EXPIRED', del.deliveryId);
        fail(409, 'INVALID_STATE');
      }
      o.state = 'REJECTED';
      r.consecutiveRejections++;
      return {
        offerId,
        outcome: 'REJECTED',
        deliveryId: del.deliveryId,
        consecutiveRejections: r.consecutiveRejections,
        rejectionNotice: r.consecutiveRejections >= CONTRACT.consecutiveRejectionNotice,
        decidedAt: this.clock.iso(),
      };
    }
    if (o.state === 'EXPIRED') return this.lateResult(o, offerId, 'EXPIRED', del.deliveryId);
    if (del.d.state === 'BLOCKED') return this.lateResult(o, offerId, 'ORDER_CANCELLED', del.deliveryId);
    if (o.state === 'SUPERSEDED' || (del.d.assignment && del.d.assignment.riderId !== riderId) || del.d.state !== 'DISPATCHING') {
      return this.lateResult(o, offerId, 'ALREADY_ASSIGNED', del.deliveryId);
    }
    if (o.state !== 'SENT') fail(409, 'INVALID_STATE');
    if (!this.offerEligible(r)) return this.lateResult(o, offerId, 'INELIGIBLE', del.deliveryId);
    o.state = 'ACCEPTED';
    r.consecutiveRejections = 0;
    this.assign(del, riderId);
    return {
      offerId,
      outcome: 'ASSIGNED',
      deliveryId: del.deliveryId,
      assignmentId: del.d.assignment?.assignmentId,
      consecutiveRejections: 0,
      decidedAt: this.clock.iso(),
    };
  }

  private listItems(r: MRider): DeliveryListItem[] {
    if (!this.offerEligible(r) || !r.location) return [];
    const items: { item: DeliveryListItem; d: number }[] = [];
    for (const del of this.deliveries.values()) {
      if (del.d.state !== 'DISPATCHING') continue;
      const at = this.currentAttempt(del);
      if (!at || at.excluded.has(r.riderId)) continue;
      const straight = distanceM(r.location, this.mfcLocation);
      if (straight > at.radiusKm * 1000) continue;
      const ship = this.shipments.get(del.shipmentId);
      items.push({
        d: straight,
        item: {
          deliveryId: del.deliveryId,
          mfcId: del.mfcId,
          dropAreaLabel: '(MOCK 동)',
          deliveryMode: 'SINGLE',
          straightDistanceKm: round2(straight / 1000),
          distanceKm: round2(distanceM(this.mfcLocation, del.customer) / 1000),
          bagCount: ship?.packages.length,
          containsAlcohol: false,
          readyAt: ship ? this.clock.iso((ship.dispatchRequestedAt ?? 0) + ship.estimatedPackMinutes * 60) : undefined,
        },
      });
    }
    return items.sort((a, b) => a.d - b.d).map((x) => x.item);
  }

  private acceptFromList(riderId: string, deliveryId: string): OfferResponseResult {
    const del = this.delivery(deliveryId);
    const r = this.rider(riderId);
    const offerId = this.ids.next('OF');
    const late = (reason: OfferResponseResult['lateReason']): OfferResponseResult => ({
      offerId,
      outcome: 'LATE',
      lateReason: reason,
      deliveryId,
      decidedAt: this.clock.iso(),
    });
    if (del.d.state === 'BLOCKED') return late('ORDER_CANCELLED');
    if (del.d.state !== 'DISPATCHING') return late(del.d.assignment ? 'ALREADY_ASSIGNED' : 'INELIGIBLE');
    if (!this.listItems(r).some((i) => i.deliveryId === deliveryId)) return late('INELIGIBLE');
    const at = this.currentAttempt(del);
    this.offers.set(offerId, {
      offerId,
      attemptId: at?.attemptId ?? '',
      deliveryId,
      riderId,
      radiusKm: at?.radiusKm ?? 0,
      sentAt: this.clock.now,
      expiresAt: this.clock.now,
      state: 'ACCEPTED',
      viewedAt: this.clock.now,
      source: 'DELIVERY_LIST',
    });
    this.assign(del, riderId);
    return { offerId, outcome: 'ASSIGNED', deliveryId, assignmentId: del.d.assignment?.assignmentId, decidedAt: this.clock.iso() };
  }

  // ───────────── 인계 (mfc-fulfillment 흉내) ─────────────

  private findPackage(packageId: string): { ship: MShipment; pk: MPackage } {
    for (const ship of this.shipments.values()) {
      const pk = ship.packages.find((p) => p.packageId === packageId);
      if (pk) return { ship, pk };
    }
    fail(404, 'NOT_FOUND');
  }

  private authorize(riderId: string, packageId: string, body: HandoverAuthorizationRequest): HandoverAuthorization {
    const { ship, pk } = this.findPackage(packageId);
    if (body.riderId !== riderId) fail(403, 'FORBIDDEN', '토큰 주체와 riderId 가 다름');
    if (pk.state === 'HANDED_OVER') fail(409, 'ALREADY_HANDED_OVER');
    if (body.scannedCode !== pk.qrCode) fail(409, 'PACKAGE_INVALIDATED');
    if (pk.state !== 'SEALED' || (ship.state !== 'READY' && ship.state !== 'PARTIALLY_HANDED_OVER')) fail(409, 'INVALID_STATE');
    if (ship.deliveryId !== body.deliveryId) fail(409, 'DELIVERY_MISMATCH');
    const del = this.delivery(body.deliveryId);
    if (del.d.state !== 'ASSIGNED' || !del.d.assignment) fail(409, 'NOT_ASSIGNED');
    if (del.d.assignment.riderId !== riderId) fail(403, 'RIDER_MISMATCH');
    const now = this.clock.now;
    const f = pk.fence;
    if (f.state === 'HANDOVER_IN_PROGRESS' && f.expiresAt !== null && now < f.expiresAt) {
      if (f.riderId === riderId && f.deliveryId === body.deliveryId) return this.authView(pk);
      fail(409, 'FENCE_ACTIVE');
    }
    pk.fence = {
      state: 'HANDOVER_IN_PROGRESS',
      authId: this.ids.next('HA'),
      fenceVersion: f.fenceVersion + 1,
      riderId,
      deliveryId: body.deliveryId,
      expiresAt: now + this.params.fenceTtlSec,
      authorizedAt: now,
    };
    pk.version++;
    return this.authView(pk);
  }

  private authView(pk: MPackage): HandoverAuthorization {
    return {
      handoverAuthorizationId: pk.fence.authId ?? undefined,
      packageId: pk.packageId,
      packageVersion: pk.packageVersion,
      fenceVersion: pk.fence.fenceVersion,
      riderId: pk.fence.riderId ?? undefined,
      deliveryId: pk.fence.deliveryId ?? undefined,
      fenceExpiresAt: pk.fence.expiresAt !== null ? this.clock.iso(pk.fence.expiresAt) : undefined,
      authorizedAt: pk.fence.authorizedAt !== null ? this.clock.iso(pk.fence.authorizedAt) : undefined,
    };
  }

  private commit(riderId: string, packageId: string, body: HandoverCommitRequest, requestId: string): HandoverCommitResult {
    const { ship, pk } = this.findPackage(packageId);
    if (body.riderId !== riderId) fail(403, 'FORBIDDEN');
    if (pk.state === 'HANDED_OVER') fail(409, 'ALREADY_HANDED_OVER');
    const f = pk.fence;
    if (f.authId !== body.handoverAuthorizationId || (f.state !== 'HANDOVER_IN_PROGRESS' && f.state !== 'EXPIRED')) fail(409, 'INVALID_STATE');
    if (f.fenceVersion !== body.fenceVersion) fail(409, 'FENCE_VERSION_MISMATCH');
    if (f.state === 'EXPIRED' || (f.expiresAt !== null && this.clock.now >= f.expiresAt)) {
      f.state = 'EXPIRED';
      fail(409, 'FENCE_EXPIRED');
    }
    if (f.riderId !== riderId) fail(403, 'FORBIDDEN');
    const now = this.clock.now;
    const handoverId = this.ids.next('HO');
    pk.state = 'HANDED_OVER';
    pk.handoverId = handoverId;
    pk.handedOverAt = now;
    pk.version++;
    f.state = 'COMMITTED';
    const all = ship.packages.every((p) => p.state === 'HANDED_OVER');
    ship.state = all ? 'HANDED_OVER' : 'PARTIALLY_HANDED_OVER';
    ship.version++;
    this.emit('PackageHandedOver', `${pk.packageId} → ${riderId}`);
    const del = this.delivery(f.deliveryId ?? '');
    // dispatch 는 PackageHandedOver 로 PICKED_UP 판정(모든 포장)
    const asg = del.d.assignment;
    if (asg) {
      asg.handoverIds.push(handoverId);
      if (all) {
        asg.state = 'PICKED_UP';
        asg.pickedUpAt = now;
        this.setDispatchState(del, 'PICKED_UP');
      }
    }
    // execution 도 같은 사건으로(조금 늦게) — 픽업 완료는 인계 확정으로만(execution 계약 머리)
    this.schedule(this.lag(), () => {
      del.x.handoverIds.push(handoverId);
      del.x.packageIds.push(pk.packageId);
      const allX = ship.packages.every((p) => p.handoverId !== null && del.x.handoverIds.includes(p.handoverId));
      if (allX && (del.x.state === 'ASSIGNED' || del.x.state === 'ARRIVED_AT_STORE')) {
        this.xHistory(del, 'PICKED_UP', 'SYSTEM_EVENT', handoverId);
        this.emit('PickupCompleted', `${del.deliveryId} 픽업 완료`);
      }
    });
    return {
      status: 'APPLIED',
      requestId,
      handoverId,
      inventoryCommitId: this.ids.next('IC'),
      packageState: pk.state,
      shipmentState: ship.state,
      handedOverAt: this.clock.iso(now),
    };
  }

  // ───────────── 조회 형태(계약 모양) ─────────────

  private offerView(o: MOffer): Offer {
    const del = this.deliveries.get(o.deliveryId);
    const r = this.riders.get(o.riderId);
    const ship = del ? this.shipments.get(del.shipmentId) : undefined;
    return {
      offerId: o.offerId,
      attemptId: o.attemptId,
      deliveryId: o.deliveryId,
      riderId: o.riderId,
      radiusKm: o.radiusKm,
      sentAt: this.clock.iso(o.sentAt),
      expiresAt: this.clock.iso(o.expiresAt),
      remainingSec: o.state === 'SENT' ? Math.max(0, Math.floor(o.expiresAt - this.clock.now)) : 0,
      state: o.state,
      viewedAt: o.viewedAt !== null ? this.clock.iso(o.viewedAt) : null,
      source: o.source,
      bundleId: null,
      bundleSize: 1,
      stopSequence: 1,
      deliveryType: 'FORWARD',
      purpose: 'DELIVERY',
      summary: {
        mfcId: this.mfcId,
        dropAreaLabel: '(MOCK 동)',
        distanceKm: del ? round2(distanceM(this.mfcLocation, del.customer) / 1000) : undefined,
        // 도로 거리 대신 직선 [시뮬] — MOCK 에는 길찾기가 없다
        pickupDistanceKm: r?.location ? round2(distanceM(r.location, this.mfcLocation) / 1000) : undefined,
        bagCount: ship?.packages.length,
        containsAlcohol: false,
        deliveryMode: 'SINGLE',
      },
    };
  }

  private dispatchView(del: MDelivery): Delivery {
    const a = del.d.assignment;
    return {
      deliveryId: del.deliveryId,
      version: del.d.version,
      type: 'FORWARD',
      orderId: del.orderId,
      shipmentId: del.shipmentId,
      mfcId: del.mfcId,
      state: del.d.state,
      purpose: 'DELIVERY',
      assignment: a
        ? {
            assignmentId: a.assignmentId,
            deliveryId: del.deliveryId,
            riderId: a.riderId,
            vehicleType: this.riders.get(a.riderId)?.vehicleType,
            state: a.state,
            assignedAt: this.clock.iso(a.assignedAt),
            bundleId: null,
            stopSequence: null,
            pickedUpAt: a.pickedUpAt !== undefined ? this.clock.iso(a.pickedUpAt) : undefined,
            handoverIds: [...a.handoverIds],
            version: a.version,
          }
        : undefined,
      attempts: del.d.attempts.map(
        (at): DispatchAttempt => ({
          attemptId: at.attemptId,
          deliveryId: del.deliveryId,
          trigger: at.trigger,
          state: at.state,
          currentRadiusKm: at.radiusKm,
          retryCount: at.retryCount,
          startedAt: this.clock.iso(at.startedAt),
          deadlineAt: this.clock.iso(at.deadlineAt),
          failureReason: at.failureReason,
        }),
      ),
      createdAt: this.clock.iso(del.createdAt),
      updatedAt: this.clock.iso(del.d.updatedAt),
    };
  }

  private execView(del: MDelivery): DeliveryExecution {
    const x = del.x;
    return {
      deliveryId: del.deliveryId,
      version: x.version,
      type: 'FORWARD',
      orderId: del.orderId,
      riderId: x.riderId ?? undefined,
      mfcId: del.mfcId,
      state: x.state,
      handoverIds: [...x.handoverIds],
      packageIds: [...x.packageIds],
      evidence: x.evidence ? { ...x.evidence, photoRefs: [...x.evidence.photoRefs] } : undefined,
      failure: x.failure ? { ...x.failure, photoRefs: [...x.failure.photoRefs] } : undefined,
      incidents: x.helps.map((h) => ({ incidentId: `${del.deliveryId}:${h.requestId}`, category: h.category, raisedAt: this.clock.iso(h.createdAt) })),
      history: x.history.map((h) => ({ ...h })),
      assignedAt: x.assignedAt !== undefined ? this.clock.iso(x.assignedAt) : undefined,
      completedAt: x.completedAt !== undefined ? this.clock.iso(x.completedAt) : undefined,
      purpose: 'DELIVERY',
    };
  }

  private shipmentView(s: MShipment): Shipment {
    return {
      shipmentId: s.shipmentId,
      orderId: s.orderId,
      deliveryId: s.deliveryId,
      version: s.version,
      state: s.state,
      holdReason: null,
      packages: s.packages.map((pk) => ({
        packageId: pk.packageId,
        packageVersion: pk.packageVersion,
        shipmentId: s.shipmentId,
        orderId: s.orderId,
        version: pk.version,
        state: pk.state,
        qrCode: pk.qrCode,
        bagCount: 1,
        containsAlcohol: false,
        fence: {
          state: pk.fence.state,
          handoverAuthorizationId: pk.fence.authId,
          fenceVersion: pk.fence.fenceVersion,
          riderId: pk.fence.riderId,
          expiresAt: pk.fence.expiresAt !== null ? this.clock.iso(pk.fence.expiresAt) : null,
        },
        sealedAt: pk.sealedAt !== null ? this.clock.iso(pk.sealedAt) : null,
        handedOverAt: pk.handedOverAt !== null ? this.clock.iso(pk.handedOverAt) : null,
        invalidatedReason: null,
      })),
      bagCount: s.packages.length,
      containsAlcohol: false,
      readyAt: s.readyAt !== null ? this.clock.iso(s.readyAt) : null,
      dispatchRequest:
        s.dispatchRequestedAt !== null
          ? {
              shipmentId: s.shipmentId,
              trigger: 'MANUAL',
              estimatedPackMinutes: s.estimatedPackMinutes,
              estimatedReadyAt: this.clock.iso(s.dispatchRequestedAt + s.estimatedPackMinutes * 60),
              requestedAt: this.clock.iso(s.dispatchRequestedAt),
              requestedBy: 'mock-staff',
            }
          : null,
    };
  }

  private profileView(r: MRider): RiderProfile {
    return {
      riderId: r.riderId,
      version: r.version,
      name: r.name,
      phoneMasked: r.phone ? `${r.phone.slice(0, 3)}****${r.phone.slice(-4)}` : undefined,
      vehicleType: r.vehicleType,
      deliveryAreas: r.deliveryAreas.map((a) => ({ ...a })),
      operating: this.operatingView(r),
      settings: { ...r.settings },
      restriction: { state: r.restriction },
      joinedAt: this.clock.iso(r.joinedAt),
    };
  }

  private operatingView(r: MRider): OperatingState {
    return {
      status: r.operating.status,
      newDispatchEnabled: r.operating.newDispatchEnabled,
      mfcId: r.operating.mfcId,
      activeDeliveryCount: this.activeDeliveryCount(r.riderId),
      changedAt: this.clock.iso(r.operating.changedAt),
      version: r.operating.version,
    };
  }

  // ───────────── 라이더 창구 ─────────────

  private makeRiderApi(riderId: string): RiderApi {
    const b = this;
    const me = riderId;
    const now = () => this.clock.now;

    const api: RiderApi = {
      riderId,

      // rider-service
      getMe: () => b.call(me, 'GET', '/riders/me', () => b.profileView(b.signedRider(me))),
      signup: (body: RiderSignupRequest, o: WriteOptions) =>
        b.call(
          me,
          'POST',
          '/riders/signups',
          () => {
            const r = b.rider(me);
            if (r.signedUp || r.withdrawn) fail(409, 'DUPLICATE_RIDER'); // 탈퇴한 ID 재가입 불가 [시뮬]
            if (!/^01[0-9]{8,9}$/.test(body.phone) || !body.deliveryAreas?.length) fail(400, 'VALIDATION_FAILED');
            for (const other of b.riders.values()) if ((other.signedUp || other.withdrawn) && other.phone === body.phone) fail(409, 'DUPLICATE_RIDER');
            r.signedUp = true;
            r.phone = body.phone;
            r.name = body.name;
            r.vehicleType = body.vehicleType;
            r.deliveryAreas = body.deliveryAreas.map((a) => ({ ...a }));
            r.joinedAt = now();
            r.version = 1;
            r.operating = { status: 'OFF_DUTY', newDispatchEnabled: false, changedAt: now(), version: 1 };
            r.settings = { oneAtATime: false, dispatchMode: 'AI_RECOMMENDED', version: 1 };
            return b.profileView(r);
          },
          { key: o.idempotencyKey, body: { ...body, phone: '<phone>' } },
          201,
        ),
      getOperatingState: () => b.call(me, 'GET', '/riders/me/state', () => b.operatingView(b.signedRider(me))),
      setOperatingState: (body: OperatingStateRequest, o: WriteOptions) =>
        b.call(
          me,
          'PUT',
          '/riders/me/state',
          () => {
            const r = b.signedRider(me);
            b.checkVersion(r.operating.version, o.expectedVersion);
            const enable = body.status === 'ON_DUTY' && body.newDispatchEnabled;
            if (enable && r.restriction !== 'NORMAL') fail(403, 'FORBIDDEN', '계정 제한');
            if (body.status === 'OFF_DUTY' && b.activeDeliveryCount(me) > 0) fail(409, 'INVALID_STATE', '진행 중 배송 있음');
            r.operating = {
              status: body.status,
              newDispatchEnabled: enable,
              mfcId: body.mfcId ?? r.operating.mfcId,
              changedAt: now(),
              version: r.operating.version + 1,
            };
            b.emit('RiderStateChanged', `${me} ${body.status}${enable ? '·신규배차 ON' : ''}`);
            return b.operatingView(r);
          },
          { key: o.idempotencyKey, body },
        ),
      withdraw: (body, o: WriteOptions) =>
        b.call(
          me,
          'POST',
          '/riders/me/withdrawals',
          () => {
            const r = b.signedRider(me);
            // 계약: 진행 중 배송·미정산 수행료·제한 조사 중이면 409. MOCK 에는 수행료 정산이 없어 앞의 둘만 본다 [시뮬]
            if (b.activeDeliveryCount(me) > 0 || r.restriction !== 'NORMAL') fail(409, 'INVALID_STATE');
            const requestId = o.idempotencyKey;
            b.withdrawals.set(requestId, { riderId: me, state: 'COMPLETED' });
            r.signedUp = false;
            r.withdrawn = true;
            r.operating = { ...r.operating, status: 'OFF_DUTY', newDispatchEnabled: false, version: r.operating.version + 1 };
            b.emit('RiderStateChanged', `${me} 탈퇴`);
            return b.cmd(requestId, { status: 'ACCEPTED', resultId: requestId });
          },
          { key: o.idempotencyKey, body: body ?? {} },
          202,
        ),
      getWithdrawal: (requestId: string) =>
        b.call(me, 'GET', `/riders/me/withdrawals/${requestId}`, (): Withdrawal => {
          const w = b.withdrawals.get(requestId);
          if (!w || w.riderId !== me) fail(404, 'NOT_FOUND');
          return { requestId, state: w.state, blockers: [] };
        }),
      getDispatchSettings: () => b.call(me, 'GET', '/riders/me/settings', () => ({ ...b.signedRider(me).settings }) as DispatchSettings),
      setDispatchSettings: (body: DispatchSettings, o: WriteOptions) =>
        b.call(
          me,
          'PUT',
          '/riders/me/settings',
          () => {
            const r = b.signedRider(me);
            b.checkVersion(r.settings.version, o.expectedVersion);
            r.settings = {
              oneAtATime: body.oneAtATime ?? r.settings.oneAtATime,
              dispatchMode: body.dispatchMode ?? r.settings.dispatchMode,
              version: r.settings.version + 1,
            };
            return { ...r.settings };
          },
          { key: o.idempotencyKey, body },
        ),

      // delivery-tracking
      uploadLocations: (body: LocationBatch, o: WriteOptions) =>
        b.call(
          me,
          'POST',
          '/riders/me/locations',
          () => {
            const pts = body.points ?? [];
            if (pts.length < 1 || pts.length > CONTRACT.locationBatchMax) fail(400, 'VALIDATION_FAILED');
            const r = b.rider(me);
            for (const p of pts) {
              if (!r.location || p.recordedAt >= r.location.recordedAt) {
                r.location = { lat: p.lat, lng: p.lng, accuracyM: p.accuracyM, recordedAt: p.recordedAt, receivedAt: now() };
              }
            }
            return b.cmd(o.idempotencyKey, { status: 'ACCEPTED', appliedQty: pts.length });
          },
          { key: o.idempotencyKey, body },
          202,
        ),
      getLatestLocation: () =>
        b.call(me, 'GET', '/riders/me/locations/latest', (): RiderLocation => {
          const loc = b.rider(me).location;
          if (!loc) fail(404, 'NOT_FOUND');
          return {
            riderId: me,
            lat: loc.lat,
            lng: loc.lng,
            accuracyM: loc.accuracyM,
            recordedAt: loc.recordedAt,
            receivedAt: b.clock.iso(loc.receivedAt),
            quality: 'GOOD',
            inServiceZone: true,
            staleSinceSeconds: Math.floor(now() - loc.receivedAt),
          };
        }),

      // delivery-dispatch
      listOffers: (q) =>
        b.call(me, 'GET', '/offers', (): OfferListResponse => {
          const r = b.rider(me);
          const items = [...b.offers.values()]
            .filter((o) => o.riderId === me)
            .filter((o) => (q?.state ? o.state === q.state : o.state === 'SENT' && now() < o.expiresAt))
            .sort((x, y) => y.sentAt - x.sentAt)
            .map((o) => b.offerView(o));
          return {
            items,
            page: { nextCursor: null, size: items.length },
            serverTime: b.clock.iso(),
            pollAfterSec: b.offerEligible(r) ? CONTRACT.offersPollDefaultSec : null,
          };
        }),
      getOffer: (offerId: string) =>
        b.call(me, 'GET', `/offers/${offerId}`, () => {
          const o = b.offers.get(offerId);
          if (!o || o.riderId !== me) fail(404, 'NOT_FOUND');
          if (o.viewedAt === null) o.viewedAt = now();
          return b.offerView(o);
        }),
      respondToOffer: (offerId: string, body: OfferResponseRequest, o: WriteOptions) =>
        b.call(me, 'POST', `/offers/${offerId}/responses`, () => b.respond(me, offerId, body), {
          key: o.idempotencyKey,
          body: { response: body.response, rejectReason: body.rejectReason },
        }),
      listDeliveryList: () =>
        b.call(me, 'GET', '/delivery-list', (): DeliveryListResponse => {
          const r = b.rider(me);
          return { items: b.listItems(r), serverTime: b.clock.iso(), pollAfterSec: b.offerEligible(r) ? CONTRACT.offersPollDefaultSec : null };
        }),
      acceptFromDeliveryList: (deliveryId: string, o: WriteOptions) =>
        b.call(me, 'POST', `/delivery-list/${deliveryId}/acceptances`, () => b.acceptFromList(me, deliveryId), {
          key: o.idempotencyKey,
          body: null,
        }),
      getDispatch: (deliveryId: string) =>
        b.call(me, 'GET', `/deliveries/${deliveryId}/dispatch`, () => {
          const del = b.delivery(deliveryId);
          const mine = del.d.assignment?.riderId === me;
          const offered = [...b.offers.values()].some((o) => o.deliveryId === deliveryId && o.riderId === me);
          if (!mine && !offered) fail(403, 'FORBIDDEN');
          return b.dispatchView(del);
        }),
      cancelAssignment: (deliveryId: string, body: AssignmentCancellationRequest, o: WriteOptions) =>
        b.call(
          me,
          'POST',
          `/deliveries/${deliveryId}/assignment-cancellations`,
          () => {
            const del = b.delivery(deliveryId);
            if (del.d.assignment?.riderId !== me) fail(403, 'FORBIDDEN');
            b.checkVersion(del.d.version, o.expectedVersion);
            if (del.d.state === 'PICKED_UP') fail(422, 'PICKED_UP_CASE_REQUIRED');
            if (del.d.state !== 'ASSIGNED') fail(409, 'INVALID_STATE');
            const asg = del.d.assignment;
            asg.state = 'CANCELLED';
            del.d.assignment = null;
            // 진행 중 인계 허가 해제(mfc-fulfillment 가 하는 일)
            const ship = b.shipments.get(del.shipmentId);
            for (const pk of ship?.packages ?? []) if (pk.fence.state === 'HANDOVER_IN_PROGRESS' && pk.fence.riderId === me) pk.fence.state = 'NONE';
            const reassign = body.reassign ?? true;
            if (reassign) {
              const prev = b.currentAttempt(del);
              const excluded = new Set(prev?.excluded ?? []);
              excluded.add(me);
              b.setDispatchState(del, 'DISPATCHING');
              b.startAttempt(del, 'REASSIGN', 0, excluded);
              b.emit('DeliveryAssignmentChanged', `${deliveryId} ${me} 배차 취소 → 재배차`);
            } else {
              b.setDispatchState(del, 'CANCELLED_BEFORE_PICKUP');
              b.emit('DeliveryCancelledBeforePickup', `${deliveryId} 픽업 전 취소`);
            }
            b.schedule(b.lag(), () => {
              del.x.riderId = null;
              b.xHistory(del, reassign ? 'UNASSIGNED' : 'CANCELLED', 'SYSTEM_EVENT', 'DeliveryAssignmentChanged');
            });
            const at = b.currentAttempt(del);
            return b.cmd(o.idempotencyKey, { status: 'ACCEPTED', resultId: reassign ? at?.attemptId : deliveryId, version: del.d.version });
          },
          { key: o.idempotencyKey, body },
          202,
        ),

      // delivery-execution
      getExecution: (deliveryId: string) =>
        b.call(me, 'GET', `/deliveries/${deliveryId}`, () => b.execView(b.myExec(me, deliveryId))),
      listMyDeliveries: (q) =>
        b.call(me, 'GET', '/riders/me/deliveries', (): MyDeliveriesResponse => {
          const items = [...b.deliveries.values()]
            .filter((d) => d.x.exists && d.x.riderId === me)
            .filter((d) => !q?.state || d.x.state === q.state)
            .map((d) => b.execView(d));
          return { items, page: { nextCursor: null, size: items.length } };
        }),
      reportStoreArrival: (deliveryId: string, body: TransitionRequest, o: WriteOptions) =>
        b.call(
          me,
          'POST',
          `/deliveries/${deliveryId}/store-arrivals`,
          () => {
            const del = b.xTransition(me, deliveryId, ['ASSIGNED'], 'ARRIVED_AT_STORE', o.expectedVersion);
            return b.cmd(o.idempotencyKey, { version: del.x.version });
          },
          { key: o.idempotencyKey, body },
        ),
      reportPickup: (deliveryId: string, body: PickupRequest, o: WriteOptions) =>
        b.call(
          me,
          'POST',
          `/deliveries/${deliveryId}/pickups`,
          () => {
            // 상태는 PackageHandedOver 로 바뀐다 — 여기서는 인계 ID 가 모든 포장을 덮는지 확인만(docs/design.md §5-6)
            const del = b.myExec(me, deliveryId);
            if (!['ARRIVED_AT_STORE', 'ASSIGNED', 'PICKED_UP'].includes(del.x.state)) fail(409, 'INVALID_STATE');
            const ship = b.shipments.get(del.shipmentId);
            const need = (ship?.packages ?? []).map((p) => p.handoverId);
            if (!body.handoverIds?.length || need.some((h) => h === null || !body.handoverIds.includes(h))) {
              fail(422, 'HANDOVER_NOT_CONFIRMED');
            }
            return b.cmd(o.idempotencyKey, { version: del.x.version });
          },
          { key: o.idempotencyKey, body },
        ),
      getDropInfo: (deliveryId: string) =>
        b.call(me, 'GET', `/deliveries/${deliveryId}/drop-info`, (): DropInfo => {
          const del = b.myExec(me, deliveryId);
          if (!['PICKED_UP', 'ARRIVED_AT_CUSTOMER', 'FAILURE_REPORTED'].includes(del.x.state)) fail(409, 'DROP_INFO_CLOSED');
          // MOCK 가짜 값 — 실제 개인정보가 아니다. 좌표만 의미가 있다.
          return {
            deliveryId,
            roadAddress: '(MOCK 주소)',
            detailAddress: '(MOCK)',
            postalCode: null,
            receiverName: '(MOCK 고객)',
            receiverPhone: '01000000000',
            entranceMethod: 'FREE',
            entranceNote: null,
            deliveryNote: null,
            lat: del.customer.lat,
            lng: del.customer.lng,
          };
        }),
      reportCustomerArrival: (deliveryId: string, body: TransitionRequest, o: WriteOptions) =>
        b.call(
          me,
          'POST',
          `/deliveries/${deliveryId}/customer-arrivals`,
          () => {
            const del = b.xTransition(me, deliveryId, ['PICKED_UP'], 'ARRIVED_AT_CUSTOMER', o.expectedVersion);
            return b.cmd(o.idempotencyKey, { version: del.x.version });
          },
          { key: o.idempotencyKey, body },
        ),
      uploadEvidencePhoto: (deliveryId: string, file: Blob, o: WriteOptions) =>
        b.call(
          me,
          'POST',
          `/deliveries/${deliveryId}/evidence-photos`,
          (): EvidencePhoto => {
            const del = b.myExec(me, deliveryId);
            if (del.x.state !== 'PICKED_UP' && del.x.state !== 'ARRIVED_AT_CUSTOMER') fail(409, 'INVALID_STATE', '픽업 전·완료 뒤에는 사진을 올릴 수 없음');
            const type = file.type as EvidencePhoto['contentType'];
            if (!ALLOWED_PHOTO_TYPES.includes(type) || file.size <= 0 || file.size > CONTRACT.evidencePhotoMaxBytes) fail(422, 'PHOTO_INVALID');
            const photoRef = b.ids.next('PH');
            b.photos.set(photoRef, { photoRef, deliveryId, riderId: me, contentType: type, sizeBytes: file.size, uploadedAt: now() });
            del.x.photos.push(photoRef);
            return { photoRef, contentType: type, sizeBytes: file.size, uploadedAt: b.clock.iso() };
          },
          { key: o.idempotencyKey, body: { size: file.size, type: file.type } },
          201,
        ),
      reportCompletion: (deliveryId: string, body: CompletionRequest, o: WriteOptions) =>
        b.call(
          me,
          'POST',
          `/deliveries/${deliveryId}/completions`,
          () => {
            const del = b.myExec(me, deliveryId);
            b.checkVersion(del.x.version, o.expectedVersion);
            if (del.x.state !== 'ARRIVED_AT_CUSTOMER') fail(409, 'INVALID_STATE');
            const refs = body.evidence?.photoRefs ?? [];
            if (!refs.length || refs.some((r) => b.photos.get(r)?.deliveryId !== deliveryId || b.photos.get(r)?.riderId !== me)) {
              fail(422, 'EVIDENCE_REQUIRED');
            }
            del.x.evidence = { method: body.method, photoRefs: [...refs], takenAt: body.evidence.takenAt, placement: body.evidence.placement };
            del.x.completedAt = now();
            b.xHistory(del, 'COMPLETED', 'RIDER');
            b.emit('DeliveryCompleted', `${deliveryId} 전달 완료(${body.method})`);
            // dispatch 는 DeliveryCompleted 로 CLOSED
            b.schedule(b.lag(), () => {
              if (del.d.assignment) del.d.assignment.state = 'COMPLETED';
              b.setDispatchState(del, 'CLOSED');
            });
            return b.cmd(o.idempotencyKey, { version: del.x.version });
          },
          { key: o.idempotencyKey, body },
        ),
      reportFailure: (deliveryId: string, body: FailureRequest, o: WriteOptions) =>
        b.call(
          me,
          'POST',
          `/deliveries/${deliveryId}/failures`,
          () => {
            const del = b.myExec(me, deliveryId);
            b.checkVersion(del.x.version, o.expectedVersion);
            if (del.x.state !== 'PICKED_UP' && del.x.state !== 'ARRIVED_AT_CUSTOMER') fail(409, 'INVALID_STATE');
            const refs = body.evidenceRefs ?? [];
            if (!refs.length || refs.some((r) => b.photos.get(r)?.deliveryId !== deliveryId || b.photos.get(r)?.riderId !== me)) {
              fail(422, 'EVIDENCE_REQUIRED');
            }
            if (CUSTOMER_REASONS.has(body.reason) && (body.contactAttempts?.length ?? 0) < 2) fail(422, 'CONTACT_ATTEMPTS_REQUIRED');
            del.x.failure = {
              reason: body.reason,
              goodsLocation: body.goodsLocation,
              photoRefs: [...refs],
              contactAttempts: body.contactAttempts?.length ?? 0,
              reportedAt: b.clock.iso(),
            };
            b.xHistory(del, 'FAILURE_REPORTED', 'RIDER');
            return b.cmd(o.idempotencyKey, { version: del.x.version });
          },
          { key: o.idempotencyKey, body },
        ),
      createHelpRequest: (deliveryId: string, body: HelpRequestCreate, o: WriteOptions) =>
        b.call(
          me,
          'POST',
          `/deliveries/${deliveryId}/help-requests`,
          () => {
            const del = b.myExec(me, deliveryId);
            if (['COMPLETED', 'FAILED', 'CANCELLED', 'UNASSIGNED'].includes(del.x.state)) fail(409, 'INVALID_STATE');
            const requestId = o.idempotencyKey;
            del.x.helps.push({
              requestId,
              category: body.category,
              stage: del.x.state,
              detail: body.detail ?? null,
              evidenceRefs: [...(body.evidenceRefs ?? [])],
              createdAt: now(),
            });
            b.emit('DeliveryIncidentRaised', `${deliveryId} 도움요청 ${body.category}`);
            return b.cmd(requestId, { status: 'ACCEPTED', resultId: requestId });
          },
          { key: o.idempotencyKey, body },
          202,
        ),
      getHelpRequest: (deliveryId: string, requestId: string) =>
        b.call(me, 'GET', `/deliveries/${deliveryId}/help-requests/${requestId}`, (): HelpRequest => {
          const del = b.myExec(me, deliveryId);
          const h = del.x.helps.find((x) => x.requestId === requestId);
          if (!h) fail(404, 'NOT_FOUND');
          return {
            requestId,
            deliveryId,
            incidentId: `${deliveryId}:${requestId}`,
            caseId: null,
            state: 'OPEN',
            category: h.category,
            stage: h.stage,
            detail: h.detail,
            evidenceRefs: [...h.evidenceRefs],
            createdAt: b.clock.iso(h.createdAt),
            resolvedAt: null,
            resolvedBy: null,
            resolutionNote: null,
          };
        }),
      // MOCK 에는 회수 배송이 없다 — 일반 배송에 회수 단계를 부르면 계약처럼 409
      reportReturnPickup: (deliveryId: string, body, o: WriteOptions) =>
        b.call(
          me,
          'POST',
          `/deliveries/${deliveryId}/returns/pickups`,
          () => {
            b.myExec(me, deliveryId);
            return fail(409, 'INVALID_STATE', '회수 배송이 아님');
          },
          { key: o.idempotencyKey, body },
        ),
      reportReturnStoreDelivery: (deliveryId: string, body, o: WriteOptions) =>
        b.call(
          me,
          'POST',
          `/deliveries/${deliveryId}/returns/store-deliveries`,
          () => {
            b.myExec(me, deliveryId);
            return fail(409, 'INVALID_STATE', '회수 배송이 아님');
          },
          { key: o.idempotencyKey, body },
        ),

      // mfc-fulfillment 인계
      authorizeHandover: (packageId: string, body: HandoverAuthorizationRequest, o: WriteOptions) =>
        b.call(me, 'POST', `/packages/${packageId}/handover-authorizations`, () => b.authorize(me, packageId, body), {
          key: o.idempotencyKey,
          body: { ...body, scannedAt: undefined },
        }, 201),
      commitHandover: (packageId: string, body: HandoverCommitRequest, o: WriteOptions) =>
        b.call(me, 'POST', `/packages/${packageId}/handover-commits`, () => b.commit(me, packageId, body, o.idempotencyKey), {
          key: o.idempotencyKey,
          body: { ...body, handedOverAt: undefined },
        }, 201),
      getHandoverResolution: (packageId: string) =>
        b.call(me, 'GET', `/packages/${packageId}/handover-resolution`, (): HandoverResolution => {
          const { ship, pk } = b.findPackage(packageId);
          return {
            packageId,
            packageVersion: pk.packageVersion,
            packageState: pk.state,
            verdict: pk.state === 'HANDED_OVER' ? 'HANDED_OVER' : pk.fence.state === 'HANDOVER_IN_PROGRESS' ? 'HANDOVER_IN_PROGRESS' : 'READY',
            fence: {
              state: pk.fence.state,
              handoverAuthorizationId: pk.fence.authId,
              fenceVersion: pk.fence.fenceVersion,
              expiresAt: pk.fence.expiresAt !== null ? b.clock.iso(pk.fence.expiresAt) : null,
            },
            handoverId: pk.handoverId,
            inventoryApplyStatus: pk.state === 'HANDED_OVER' ? 'APPLIED' : 'NOT_REQUESTED',
            shipmentId: ship.shipmentId,
            orderId: ship.orderId,
            riderId: pk.fence.riderId,
          };
        }),
    };
    return api;
  }

  // ───────────── 관찰 계정 ─────────────

  private makeObserver(): ObserverApi {
    const b = this;
    const who = 'observer';
    return {
      searchDeliveries: (q) =>
        b.call(who, 'GET', `/deliveries?mfcId=${q.mfcId}`, (): StaffDeliveryListResponse => {
          const items = [...b.deliveries.values()]
            .filter((d) => d.x.exists && d.mfcId === q.mfcId)
            .filter((d) => (!q.orderId || d.orderId === q.orderId) && (!q.riderId || d.x.riderId === q.riderId) && (!q.state || d.x.state === q.state))
            .sort((x, y) => (q.sort === 'OLDEST' ? x.createdAt - y.createdAt : y.createdAt - x.createdAt))
            .slice(0, q.size ?? 20)
            .map((d) => ({
              deliveryId: d.deliveryId,
              version: d.x.version,
              type: 'FORWARD' as const,
              orderId: d.orderId,
              mfcId: d.mfcId,
              riderId: d.x.riderId,
              state: d.x.state,
              assignedAt: d.x.assignedAt !== undefined ? b.clock.iso(d.x.assignedAt) : null,
              completedAt: d.x.completedAt !== undefined ? b.clock.iso(d.x.completedAt) : null,
              createdAt: b.clock.iso(d.createdAt),
            }));
          return { items, page: { nextCursor: null, size: items.length } };
        }),
      getExecution: (deliveryId: string) =>
        b.call(who, 'GET', `/deliveries/${deliveryId}`, () => {
          const d = b.delivery(deliveryId);
          if (!d.x.exists) fail(404, 'NOT_FOUND');
          return b.execView(d);
        }),
      getDispatch: (deliveryId: string) => b.call(who, 'GET', `/deliveries/${deliveryId}/dispatch`, () => b.dispatchView(b.delivery(deliveryId))),
      getShipment: (shipmentId: string) =>
        b.call(who, 'GET', `/shipments/${shipmentId}`, () => {
          const s = b.shipments.get(shipmentId);
          if (!s) fail(404, 'NOT_FOUND');
          return b.shipmentView(s);
        }),
    };
  }
}

function statusOf(e: unknown): number | 'ERR' {
  return e instanceof ApiProblem ? e.status : 'ERR';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
