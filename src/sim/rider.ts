// 가상 라이더 — 라이더 앱처럼 계약 API 를 부르는 상태기계 (docs/design.md §5, 순서는 rider_e2e.py 와 같게).
// RiderApi·ObserverApi 만 보고 움직이므로 MOCK·실서버(P3)가 같은 코드로 돈다.
//
// 지키는 것
//  - 배송 상태를 만들지 않는다: 픽업 완료는 인계 확정(PackageHandedOver)으로 execution 이 바꾼 것을 조회로 확인, 완료는 사진 + 완료 요청.
//    경로 끝 도착·시간 경과만으로 상태를 넘기지 않는다.
//  - 응답 없음(ResultUnknown)은 실패가 아니다 — 같은 Idempotency-Key 로 다시 보낸다.
//  - 사건 반영 지연을 기다린다(수락 직후 execution UNASSIGNED 등 — "반영 대기").
//  - 전달지(drop-info)는 좌표만 쓰고 나머지는 버린다(저장·로그·화면 금지).
//  - purpose 가 DELIVERY 가 아닌 제안(오배송 회수 등)은 지금은 거절한다(docs/design.md §3-1 — 회수 흐름은 P4).

import type { ObserverApi, RiderApi, WriteOptions } from '../backend/port';
import { CONTRACT, simRiderPhone, type SimParams } from '../config';
import { ApiProblem, ResultUnknown, type Offer, type Shipment } from '../domain/contract';
import { bearingDeg, distanceM, moveToward, type LatLng } from '../util/geo';
import { IdGen, Rng } from '../util/rng';
import { RiderRestrictedError, STOP_RESTRICTIONS, withAuthRecovery } from './authGuard';
import { straightRoutes, type Route, type RouteKind, type RouteProvider } from './route';
import type { SimClock } from './clock';

/** 실서버에서 가입이 허용되지 않았는데 미가입인 라이더 */
export class SignupNotAllowedError extends Error {
  constructor() {
    super('미가입 — 가입 허용 안 됨');
    this.name = 'SignupNotAllowedError';
  }
}

/** 엔진 쪽 단계 — 백엔드 상태가 아니다(화면에는 "엔진" 출처로 보인다). */
export type RiderPhase =
  | 'PREPARING'
  | 'IDLE'
  | 'DECIDING'
  | 'TO_STORE'
  | 'WAIT_ASSIGN_REFLECT'
  | 'AT_STORE_WAIT_READY'
  | 'HANDOVER'
  | 'WAIT_PICKUP_REFLECT'
  | 'TO_CUSTOMER'
  | 'AT_CUSTOMER'
  | 'STOPPED'
  /** 전달 실패 처리(연락·실패 등록·확정 대기) */
  | 'FAILING'
  /** 실패한 상품 들고 MFC 로 */
  | 'RETURNING'
  /** 실서버 읽기 — 이 브라우저가 움직이지 않는 라이더(위치만 조회) */
  | 'REMOTE';

export const PHASE_LABEL: Record<RiderPhase, string> = {
  PREPARING: '준비(가입·운행 시작)',
  IDLE: '대기(제안 조회)',
  DECIDING: '제안 검토',
  TO_STORE: 'MFC 로 이동',
  WAIT_ASSIGN_REFLECT: '배정 반영 대기',
  AT_STORE_WAIT_READY: '가게 — 포장 대기',
  HANDOVER: 'QR 인계',
  WAIT_PICKUP_REFLECT: '픽업 반영 대기',
  TO_CUSTOMER: '고객으로 이동',
  AT_CUSTOMER: '고객 도착 — 전달',
  STOPPED: '멈춤',
  FAILING: '전달 실패 처리',
  RETURNING: '상품 들고 MFC 복귀',
  REMOTE: '실서버(읽기만)',
};

/** 제안을 어떻게 할지 — 순수 함수(시험용). */
export type OfferDecision = { kind: 'ACCEPT' } | { kind: 'REJECT'; reason: 'OTHER' | 'TOO_FAR' } | { kind: 'IGNORE' };

export function decideOffer(offer: Offer, roll: number, acceptProbability: number): OfferDecision {
  // 회수(MISDELIVERY_RECOVERY)·고객 반품·재발송(MISDELIVERY_RESHIPMENT — dispatch 0.4.1)은 받지 않는다(§3-1).
  // 재발송은 "배차는 일반 배송과 같다"지만 execution 이 같은 단계로 처리하는지 계약·서비스 문서에 없다 — P4 에서 확인 뒤 받는다.
  if (offer.purpose !== undefined && offer.purpose !== 'DELIVERY') return { kind: 'REJECT', reason: 'OTHER' };
  if (offer.deliveryType !== undefined && offer.deliveryType !== 'FORWARD') return { kind: 'REJECT', reason: 'OTHER' };
  if (roll < acceptProbability) return { kind: 'ACCEPT' };
  // 나머지 절반은 거절, 절반은 무응답으로 만료 [시뮬]
  return roll < acceptProbability + (1 - acceptProbability) / 2 ? { kind: 'REJECT', reason: 'TOO_FAR' } : { kind: 'IGNORE' };
}

/** 시뮬레이터가 지표·화면에 쓰는 한 배송의 엔진 기록. */
export interface RiderTrip {
  deliveryId: string;
  offeredAt: number;
  acceptedAt?: number;
  storeArrivedAt?: number;
  readyAt?: number;
  pickedUpAt?: number;
  completedAt?: number;
  /** 전달 실패 등록 시각(완료 대신) */
  failedAt?: number;
}

export interface RiderHooks {
  onTripDone(trip: RiderTrip): void;
  onNote(riderId: string, text: string): void;
}

/** 시뮬 시각 기준 대기·이동 약속을 tick 이 풀어 준다(MFC 시뮬레이터 Agent 와 같은 방식). */
export class VirtualRider {
  readonly id: string;
  pos: LatLng;
  heading = 0;
  phase: RiderPhase = 'PREPARING';
  /** 화면 표시용 이유(예: "출고 PREPARING — 포장 대기") */
  note = '';
  deliveryId: string | null = null;
  /** 지금 가는 곳 */
  target: LatLng | null = null;
  /** 지금 따라가는 경로(처음 = 출발, 끝 = 목적지) — 화면 경로선 */
  path: LatLng[] | null = null;
  /** ROAD = 카카오모빌리티 도로 경로(자동차 기준), STRAIGHT = 직선(도로 경로 아님) */
  pathKind: RouteKind | null = null;
  private pathIdx = 0;
  /** 진행 중 배송의 고객 좌표(drop-info 에서 lat·lng 만) */
  dropPoint: LatLng | null = null;
  trip: RiderTrip | null = null;
  done = false;

  private readonly rng: Rng;
  private readonly keys: IdGen;
  private waitUntil: number | null = null;
  private waitResolve: (() => void) | null = null;
  private moveResolve: (() => void) | null = null;
  private moveSpeed = 0;
  private trail: { lat: number; lng: number; recordedAt: string; deliveryId?: string }[] = [];
  private lastSampleAt = -Infinity;
  private lastUploadAt = -Infinity;
  private uploading = false;
  /** 보내는 중인 위치 묶음 — 응답이 끊기면 이 키·이 점 그대로 다시 보낸다 */
  private pendingUpload: { key: string; points: { lat: number; lng: number; recordedAt: string; deliveryId?: string; accuracyM: number }[] } | null = null;
  private readonly api: RiderApi;

  constructor(
    readonly index: number,
    api: RiderApi,
    private readonly observer: ObserverApi,
    private readonly clock: SimClock,
    private readonly params: SimParams,
    readonly home: LatLng,
    start: LatLng,
    private readonly hooks: RiderHooks,
    /**
     * allowSignup: 미가입이면 가입할지(가입은 백엔드에 지울 수 없는 데이터를 남긴다 — RR-07).
     * routes: MFC·고객으로 갈 때 경로(기본 직선 — 시험). 화면은 개발 서버 도로 경로(DevServerRoutes).
     */
    private readonly options: { allowSignup: boolean; routes?: RouteProvider } = { allowSignup: true },
  ) {
    this.id = api.riderId;
    // 401 → 계정 제한 확인 → 정지면 멈춤(RR-01 조건 7)
    this.api = withAuthRecovery(api, (t) => this.say(t));
    this.pos = { ...start };
    this.rng = new Rng(params.seed * 7919 + index * 104729);
    this.keys = new IdGen(`${this.id}-`);
  }

  // ───────────── 박자 ─────────────

  tick(dt: number): void {
    const now = this.clock.now;
    if (this.moveResolve && this.path) {
      // 경로 점을 차례로 따라간다(한 박자에 여러 점을 지날 수 있다)
      let left = this.moveSpeed * dt;
      while (left > 0 && this.pathIdx < this.path.length) {
        const next = this.path[this.pathIdx] as LatLng;
        const d = distanceM(this.pos, next);
        if (d <= left) {
          if (d > 0.01) this.heading = bearingDeg(this.pos, next);
          this.pos = { ...next };
          left -= d;
          this.pathIdx++;
        } else {
          const m = moveToward(this.pos, next, left);
          if (distanceM(this.pos, m.pos) > 0.01) this.heading = bearingDeg(this.pos, m.pos);
          this.pos = m.pos;
          left = 0;
        }
      }
      if (this.pathIdx >= this.path.length) {
        const r = this.moveResolve;
        this.moveResolve = null;
        r();
      }
    }
    if (this.waitResolve && this.waitUntil !== null && now >= this.waitUntil) {
      const r = this.waitResolve;
      this.waitResolve = null;
      this.waitUntil = null;
      r();
    }
    this.sampleAndUpload(now);
  }

  /** 1초마다 위치 점을 모아 locationUploadIntervalSec 마다 올린다. 응답 없음이면 같은 키로 다시. */
  private sampleAndUpload(now: number) {
    if (this.phase === 'PREPARING' || this.phase === 'STOPPED') return;
    if (now - this.lastSampleAt >= 1) {
      this.lastSampleAt = now;
      this.trail.push({ lat: this.pos.lat, lng: this.pos.lng, recordedAt: this.clock.iso(now), deliveryId: this.deliveryId ?? undefined });
      if (this.trail.length > CONTRACT.locationBatchMax) this.trail.splice(0, this.trail.length - CONTRACT.locationBatchMax);
    }
    if (this.uploading || now - this.lastUploadAt < this.params.locationUploadIntervalSec) return;
    // 보내는 중인 묶음이 있으면(앞서 응답이 끊김) 그 묶음을 같은 키·같은 점으로 다시 — 새 점을 붙이면 같은 키·다른 본문(409 IDEMPOTENCY_CONFLICT)
    if (!this.pendingUpload) {
      if (!this.trail.length) return;
      const points = this.trail.splice(0, this.trail.length).map((p) => ({ ...p, accuracyM: 8 }));
      this.pendingUpload = { key: this.keys.next('loc'), points };
    }
    const batch = this.pendingUpload;
    this.uploading = true;
    this.api
      .uploadLocations({ points: batch.points }, { idempotencyKey: batch.key })
      .then(() => {
        this.pendingUpload = null;
        this.lastUploadAt = this.clock.now;
      })
      .catch((e: unknown) => {
        // 응답 없음 → 다음 박자에 같은 묶음 그대로. 거절이면 그 묶음은 버린다.
        if (!(e instanceof ResultUnknown)) this.pendingUpload = null;
        this.lastUploadAt = this.clock.now;
      })
      .finally(() => {
        this.uploading = false;
      });
  }

  private wait(sec: number): Promise<void> {
    return new Promise((resolve) => {
      this.waitUntil = this.clock.now + Math.max(0, sec);
      this.waitResolve = resolve;
    });
  }

  /**
   * target 까지 이동. viaRoad 면 경로 공급자(도로 — 못 받으면 직선)로, 아니면 직선(대기 중 짧은 이동).
   * 앞의 이동(대기 중 다가가기)은 버린다. viaRoad 가 아니면 await 없이 곧바로 이동을 건다.
   */
  private async moveTo(target: LatLng, speedMps: number, viaRoad = false): Promise<void> {
    this.moveResolve = null;
    this.target = { ...target };
    let route: Route = { kind: 'STRAIGHT', points: [{ ...this.pos }, { ...target }] };
    if (viaRoad) {
      route = await (this.options.routes ?? straightRoutes).route(this.pos, target);
      if (route.note) this.say(`직선으로 이동 — ${route.note}`);
    }
    this.path = route.points;
    this.pathKind = route.kind;
    this.pathIdx = 1;
    this.moveSpeed = speedMps;
    return new Promise((resolve) => {
      this.moveResolve = resolve;
    });
  }

  private opts(prefix: string, expectedVersion?: number): WriteOptions {
    return { idempotencyKey: this.keys.next(prefix), expectedVersion };
  }

  /** 쓰기 한 번: 응답 없음이면 같은 키로 최대 5번 다시 보낸다. 거절(ApiProblem)은 호출자에게. */
  private async write<T>(o: WriteOptions, fn: (o: WriteOptions) => Promise<T>): Promise<T> {
    for (let i = 0; ; i++) {
      try {
        return await fn(o);
      } catch (e) {
        if (e instanceof ResultUnknown && i < 5) {
          this.say('응답 없음 — 같은 키로 다시 보냄');
          await this.wait(2 + i * 2);
          continue;
        }
        throw e;
      }
    }
  }

  /** 화면 메모 + 기록. 같은 문장이 연달아 오면(예: 5초마다 "포장 대기") 기록에는 한 번만 남긴다. */
  private say(text: string) {
    if (text === this.note) return;
    this.note = text;
    this.hooks.onNote(this.id, text);
  }

  // ───────────── 순서 ─────────────

  /**
   * 운행 종료 요청 — 진행 중 배송은 끝까지 하고, 그 뒤(또는 대기 중이면 곧) 운행 상태를 OFF_DUTY 로 바꾼다.
   * 실서버에서 ON_DUTY 로 남겨 두면 아무도 움직이지 않는 라이더에게 실제 제안이 간다.
   */
  requestStop(): void {
    if (this.done) return;
    this.done = true;
    this.say(this.deliveryId ? '운행 종료 요청 — 진행 중 배송을 끝낸 뒤 OFF' : '운행 종료 요청');
  }

  async run(): Promise<void> {
    try {
      await this.prepare();
      while (!this.done) {
        const offer = await this.idleUntilAssigned();
        if (!offer) break;
        await this.deliver(offer);
      }
      await this.goOffDuty();
    } catch (e) {
      this.phase = 'STOPPED';
      if (e instanceof RiderRestrictedError) this.say(`멈춤: 계정 제한 ${e.restriction} — 운행하지 않음(RR-01 조건 7)`);
      else if (e instanceof SignupNotAllowedError) this.say('멈춤: 미가입 — 실서버 가입은 사용자 결정 대기(RR-02)');
      else this.say(`멈춤: ${e instanceof ApiProblem ? `${e.status} ${e.code ?? ''}` : String(e)}`);
    }
  }

  /** 1. 준비: 가입 확인(제한이면 멈춤) → 배차 설정(AI 추천·하나씩 배달) → 운행 ON·신규배차 ON */
  private async prepare() {
    this.phase = 'PREPARING';
    try {
      const me = await this.api.getMe();
      const r = me.restriction?.state;
      if (r && STOP_RESTRICTIONS.includes(r)) throw new RiderRestrictedError(this.id, r);
    } catch (e) {
      if (!(e instanceof ApiProblem && e.status === 404)) throw e;
      if (!this.options.allowSignup) throw new SignupNotAllowedError();
      this.say('미가입 → 가입');
      await this.write(this.opts('signup'), (o) =>
        this.api.signup(
          {
            // 시험 전화번호 010-0000-00NN(사용자 2026-11-16, RR-02)
            phone: simRiderPhone(this.index),
            vehicleType: 'MOTORCYCLE',
            deliveryAreas: [{ mfcId: this.params.mfcId }],
            consents: [{ consentType: 'TERMS', version: 'sim' }],
          },
          o,
        ),
      );
    }
    await this.write(this.opts('settings'), (o) => this.api.setDispatchSettings({ oneAtATime: true, dispatchMode: 'AI_RECOMMENDED' }, o));
    await this.write(this.opts('state'), (o) =>
      this.api.setOperatingState({ status: 'ON_DUTY', newDispatchEnabled: true, mfcId: this.params.mfcId }, o),
    );
    this.phase = 'IDLE';
    this.say('운행 시작');
  }

  /**
   * 운행 종료: OFF_DUTY·신규배차 OFF. 완료 직후에는 rider-service 의 "진행 중 배송 수"가 사건으로 조금 늦게 줄어 409 가 올 수 있다
   * (docs/design.md §4 반영 지연) — 그래서 409 면 잠깐 기다렸다 몇 번 다시 한다(새 키 — 409 는 처리 안 된 요청).
   */
  private async goOffDuty() {
    for (let i = 0; ; i++) {
      try {
        await this.write(this.opts('off'), (o) => this.api.setOperatingState({ status: 'OFF_DUTY', newDispatchEnabled: false }, o));
        this.phase = 'STOPPED';
        this.say('운행 종료(OFF_DUTY)');
        return;
      } catch (e) {
        if (e instanceof ApiProblem && e.status === 409 && i < 6) {
          this.say('운행 종료 대기 — 진행 중 배송 반영 기다림');
          await this.wait(5);
          continue;
        }
        this.phase = 'STOPPED';
        this.say(`운행 종료 실패: ${e instanceof ApiProblem ? `${e.status} ${e.code ?? ''}` : String(e)} — 운행 상태 확인 필요`);
        return;
      }
    }
  }

  /** 2·3. 대기 — 제안을 pollAfterSec 간격으로 보고, 받기로 하면 수락. 배정되면 그 제안을 돌려준다. */
  private async idleUntilAssigned(): Promise<Offer | null> {
    this.phase = 'IDLE';
    this.deliveryId = null;
    this.dropPoint = null;
    this.trip = null;
    const handled = new Set<string>();
    for (;;) {
      if (this.done) return null;
      // 대기 중에는 MFC 근처(300m)로 천천히 다가간다 [시뮬]
      if (!this.moveResolve && distanceM(this.pos, this.home) > 400) {
        const near = moveToward(this.home, this.pos, 300).pos;
        void this.moveTo(near, this.params.riderSpeedMps * this.params.idleDriftFactor);
      }
      const list = await this.api.listOffers();
      const pollSec = list.pollAfterSec ?? null;
      const offer = (list.items ?? []).find((o) => o.offerId && !handled.has(o.offerId));
      if (offer?.offerId) {
        handled.add(offer.offerId);
        const accepted = await this.considerOffer(offer);
        if (accepted) return accepted;
        this.phase = 'IDLE';
      }
      if (pollSec === null) this.say('제안을 받을 수 없는 상태(pollAfterSec null)');
      else if (this.note.startsWith('제안을 받을 수 없는')) this.say('대기 — 제안 조회');
      await this.wait(pollSec ?? 15);
    }
  }

  private async considerOffer(offer: Offer): Promise<Offer | null> {
    const offerId = offer.offerId as string;
    this.phase = 'DECIDING';
    const detail = await this.api.getOffer(offerId);
    const decision = decideOffer(detail, this.rng.next(), this.params.acceptProbability);
    const [lo, hi] = this.params.offerResponseDelaySec;
    const delay = Math.min(this.rng.range(lo, hi), Math.max(0, (detail.remainingSec ?? CONTRACT.offerResponseWindowSec) - 2));
    this.trip = { deliveryId: detail.deliveryId ?? '', offeredAt: this.clock.now };
    if (decision.kind === 'IGNORE') {
      this.say(`제안 ${detail.deliveryId} 무응답(만료되게 둠)`);
      return null;
    }
    await this.wait(delay);
    if (this.done) return null; // 운행 종료 요청 뒤에는 수락하지 않는다(만료되게 둠)
    let res;
    try {
      res = await this.write(this.opts('offer'), (o) =>
        this.api.respondToOffer(offerId, decision.kind === 'ACCEPT' ? { response: 'ACCEPT' } : { response: 'REJECT', rejectReason: decision.reason }, o),
      );
    } catch (e) {
      // 그 사이 다른 라이더에게 배정·취소되는 등 제안이 이미 닫힘 — 계약상 409/404 가 올 수 있다. 대기로 돌아간다.
      if (e instanceof ApiProblem && e.status >= 400 && e.status < 500) {
        this.say(`제안 응답 거절됨(${e.status} ${e.code ?? ''}) — 대기로`);
        return null;
      }
      throw e;
    }
    if (res.outcome === 'ASSIGNED') {
      this.trip.acceptedAt = this.clock.now;
      this.say(`수락 → 배정 ${res.deliveryId}`);
      return detail;
    }
    this.say(res.outcome === 'LATE' ? `늦은 수락: ${res.lateReason}` : `거절(${decision.kind === 'REJECT' ? decision.reason : ''})`);
    return null;
  }

  /** 4~8. 배정된 배송 하나를 끝까지. */
  private async deliver(offer: Offer) {
    const deliveryId = offer.deliveryId as string;
    this.deliveryId = deliveryId;
    const trip = this.trip ?? { deliveryId, offeredAt: this.clock.now };
    this.trip = trip;

    // 4. MFC 로
    this.phase = 'TO_STORE';
    this.say('MFC 로 이동');
    await this.moveTo(this.home, this.params.riderSpeedMps, true);

    // execution 에 배정이 보일 때까지(사건 반영 대기)
    this.phase = 'WAIT_ASSIGN_REFLECT';
    let version = await this.waitExecution(deliveryId, (s) => s === 'ASSIGNED', this.params.assignmentReflectWaitSec);
    if (version === null) {
      this.say('배정이 execution 에 보이지 않음 — 이 배송을 놓고 대기로');
      this.hooks.onTripDone(trip);
      return;
    }
    // 본문은 한 번만 만든다 — 응답이 끊겨 같은 키로 다시 보낼 때 시각·위치가 바뀌면 같은 키·다른 본문(409 IDEMPOTENCY_CONFLICT)
    const storeBody = { occurredAt: this.clock.iso(), location: { ...this.pos } };
    await this.write(this.opts('arrive-store', version), (o) => this.api.reportStoreArrival(deliveryId, storeBody, o));
    trip.storeArrivedAt = this.clock.now;

    // 5. 인계 — 출고·포장 QR 은 관찰 계정으로 읽는다(RR-03 시뮬레이터 가정 = 라벨을 본다)
    this.phase = 'AT_STORE_WAIT_READY';
    const dispatch = await this.api.getDispatch(deliveryId);
    if (!dispatch.shipmentId) throw new Error(`배차 조회에 shipmentId 없음 (${deliveryId}) — §5 orderId 로 잇기 필요`);
    const ship = await this.waitShipmentReady(dispatch.shipmentId);
    trip.readyAt = this.clock.now;
    this.phase = 'HANDOVER';
    for (const pk of ship.packages ?? []) {
      if (pk.state === 'HANDED_OVER' || !pk.packageId || !pk.qrCode) continue;
      await this.handover(pk.packageId, pk.qrCode, deliveryId);
    }

    // 6. 픽업 확인 — execution 이 PickupCompleted 로 PICKED_UP 이 될 때까지
    this.phase = 'WAIT_PICKUP_REFLECT';
    this.say('픽업 반영 대기');
    version = await this.waitExecution(deliveryId, (s) => s === 'PICKED_UP', 60);
    if (version === null) throw new Error(`인계 뒤 PICKED_UP 이 보이지 않음 (${deliveryId})`);
    trip.pickedUpAt = this.clock.now;
    const exec = await this.api.getExecution(deliveryId);
    if (exec.handoverIds?.length) {
      await this.write(this.opts('pickup'), (o) => this.api.reportPickup(deliveryId, { handoverIds: exec.handoverIds ?? [] }, o));
    }

    // 7. 고객으로 — drop-info 는 좌표만
    const drop = await this.api.getDropInfo(deliveryId);
    if (drop.lat === null || drop.lat === undefined || drop.lng === null || drop.lng === undefined) {
      throw new Error(`전달지에 지도 핀 없음 (${deliveryId})`);
    }
    this.dropPoint = { lat: drop.lat, lng: drop.lng };
    this.phase = 'TO_CUSTOMER';
    this.say('고객으로 이동');
    await this.moveTo(this.dropPoint, this.params.riderSpeedMps, true);

    // 8. 도착 → 사진 → 완료
    this.phase = 'AT_CUSTOMER';
    const cur = await this.api.getExecution(deliveryId);
    const arriveBody = { occurredAt: this.clock.iso(), location: { ...this.pos } }; // 한 번만 — 재전송 때 같은 본문
    await this.write(this.opts('arrive-customer', cur.version), (o) => this.api.reportCustomerArrival(deliveryId, arriveBody, o));
    await this.wait(20); // 문 앞까지 [시뮬]
    const photo = await this.write(this.opts('photo'), (o) => this.api.uploadEvidencePhoto(deliveryId, testPhoto(), o));
    // 고객 부재(조절 바 customerAbsentRate) — 0 이면 난수를 쓰지 않는다(기존 흐름·시험 그대로)
    if (this.params.customerAbsentRate > 0 && this.rng.next() < this.params.customerAbsentRate) {
      await this.failDelivery(deliveryId, trip, photo.photoRef);
      return;
    }
    const takenAt = this.clock.iso();
    const after = await this.api.getExecution(deliveryId);
    await this.write(this.opts('complete', after.version), (o) =>
      this.api.reportCompletion(
        deliveryId,
        { method: 'CONTACTLESS', evidence: { photoRefs: [photo.photoRef], takenAt, placement: 'FRONT_DOOR' }, occurredAt: takenAt },
        o,
      ),
    );
    trip.completedAt = this.clock.now;
    this.say(`전달 완료 ${deliveryId}`);
    this.hooks.onTripDone(trip);
    this.dropPoint = null;
    this.target = null;
  }

  /**
   * 전달 실패(고객 부재): 연락 2번(계약 — 고객 사유는 2회 이상 필수) → 문 앞 사진을 근거로 실패 등록(FAILURE_REPORTED, 아직 진행 중)
   * → 운영자 확정(FAILED) 기다림 → 상품을 들고 MFC 로 복귀. 실패 확정은 라이더가 하지 않는다(execution 계약 — 운영자).
   */
  private async failDelivery(deliveryId: string, trip: RiderTrip, photoRef: string) {
    this.phase = 'FAILING';
    this.say('고객 부재 — 연락 2번 시도');
    const first = this.clock.iso();
    await this.wait(30); // 전화·메시지 [시뮬]
    const second = this.clock.iso();
    const x = await this.api.getExecution(deliveryId);
    await this.write(this.opts('fail', x.version), (o) =>
      this.api.reportFailure(
        deliveryId,
        {
          reason: 'CUSTOMER_ABSENT',
          detail: '고객 부재(시뮬레이터)',
          evidenceRefs: [photoRef],
          goodsLocation: 'WITH_RIDER',
          contactAttempts: [
            { attemptedAt: first, method: 'SAFE_NUMBER_CALL', result: 'NO_ANSWER' },
            { attemptedAt: second, method: 'APP_MESSAGE', result: 'NO_ANSWER' },
          ],
          occurredAt: second,
        },
        o,
      ),
    );
    trip.failedAt = this.clock.now;
    this.say('전달 실패 등록 — 운영자 확정 기다림');
    // 확정은 사람(운영자)이 한다 — 실서버면 오래 걸릴 수 있어 최대 30분만 기다리고, 그 뒤에도 상품은 들고 돌아간다
    const v = await this.waitExecution(deliveryId, (s) => s === 'FAILED', 30 * 60);
    this.say(v === null ? '실패 확정 안 됨(30분) — 상품 들고 MFC 로' : '실패 확정 — 상품 들고 MFC 로 복귀');
    this.phase = 'RETURNING';
    this.dropPoint = null;
    await this.moveTo(this.home, this.params.riderSpeedMps, true);
    this.say(`MFC 복귀 — ${deliveryId} 상품 반납(회수는 별도 배송)`);
    this.hooks.onTripDone(trip);
    this.target = null;
  }

  /** execution 조회로 조건이 될 때까지 기다린다. 404(아직 사본 없음·배정 반영 전)는 기다림. 돌려주는 값 = 그때 버전. */
  private async waitExecution(deliveryId: string, ok: (s: string | undefined) => boolean, maxSec: number): Promise<number | null> {
    const until = this.clock.now + maxSec;
    for (;;) {
      try {
        const x = await this.api.getExecution(deliveryId);
        if (ok(x.state)) return x.version ?? 0;
      } catch (e) {
        if (!(e instanceof ApiProblem && e.status === 404)) throw e;
      }
      if (this.clock.now >= until) return null;
      await this.wait(1);
    }
  }

  private async waitShipmentReady(shipmentId: string): Promise<Shipment> {
    for (;;) {
      const s = await this.observer.getShipment(shipmentId);
      if (s.state === 'READY' || s.state === 'PARTIALLY_HANDED_OVER') return s;
      if (s.state === 'HANDED_OVER' || s.state === 'CANCELLED' || s.state === 'CLOSED_PARTIAL') {
        throw new Error(`출고 ${shipmentId} 상태 ${s.state} — 인계할 수 없음`);
      }
      this.say(`포장 대기(출고 ${s.state})`);
      await this.wait(this.params.storeWaitPollSec);
    }
  }

  /** 포장 하나: QR 허가 → 확정. 확정 결과를 모르면 판정 조회로 해소. fence 만료면 다시 찍는다. */
  private async handover(packageId: string, qrCode: string, deliveryId: string) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const authBody = { riderId: this.id, deliveryId, scannedCode: qrCode, scannedAt: this.clock.iso() }; // 한 번만 — 재전송 때 같은 본문
      const auth = await this.write(this.opts('ho-auth'), (o) => this.api.authorizeHandover(packageId, authBody, o));
      this.say(`QR 인계 ${packageId}`);
      await this.wait(3); // 포장을 받아 드는 시간 [시뮬]
      try {
        const res = await this.write(this.opts('ho-commit'), (o) =>
          this.api.commitHandover(
            packageId,
            { handoverAuthorizationId: auth.handoverAuthorizationId ?? '', fenceVersion: auth.fenceVersion ?? 0, riderId: this.id },
            o,
          ),
        );
        if (res.status === 'APPLIED') return;
        if (res.status === 'UNKNOWN_RESULT') {
          for (let i = 0; i < 10; i++) {
            await this.wait(2);
            const v = await this.api.getHandoverResolution(packageId);
            if (v.verdict === 'HANDED_OVER') return;
          }
        }
        throw new Error(`인계 확정 ${res.status} (${packageId}) — 대사 필요`);
      } catch (e) {
        if (e instanceof ApiProblem && e.code === 'FENCE_EXPIRED') {
          this.say('인계 허가 만료 — 다시 찍음');
          continue;
        }
        throw e;
      }
    }
    throw new Error(`인계 반복 실패 (${packageId})`);
  }
}

/** 시험용 증빙 사진(JPEG 머리만 있는 작은 바이트) — 실제 사진이 아니다. */
function testPhoto(): Blob {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
  return new Blob([bytes], { type: 'image/jpeg' });
}
