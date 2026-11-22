// 가상 라이더 — 라이더 앱처럼 계약 API 를 부르는 상태기계 (docs/design.md §5, 순서는 rider_e2e.py 와 같게).
// RiderApi·ObserverApi 만 보고 움직이므로 MOCK·실서버(P3)가 같은 코드로 돈다.
//
// 지키는 것
//  - 배송 상태를 만들지 않는다: 픽업 완료는 인계 확정(PackageHandedOver)으로 execution 이 바꾼 것을 조회로 확인, 완료는 사진 + 완료 요청.
//    경로 끝 도착·시간 경과만으로 상태를 넘기지 않는다.
//  - 응답 없음(ResultUnknown)은 실패가 아니다 — 같은 Idempotency-Key 로 다시 보낸다.
//  - 사건 반영 지연을 기다린다(수락 직후 execution UNASSIGNED 등 — "반영 대기").
//  - 전달지(drop-info)는 좌표만 쓰고 나머지는 버린다(저장·로그·화면 금지).
//  - 일반 배송·재발송(MISDELIVERY_RESHIPMENT)·오배송 회수(MISDELIVERY_RECOVERY)를 받는다. 고객 잘못 다시 배송(MISDELIVERY_REDELIVERY)은
//    전달지에 지도 핀이 없어 주소로 찾을 수단(AddressLocator — MOCK 주소록, 실서버 개발 서버 카카오 주소 검색)이 준비됐을 때만 받는다.
//    고객 반품 회수(CLAIM_RETURN — 고객 집 → MFC)도 받는다(사용자 2026-11-20 "받게 해"). 실패 반납(FAILED_DELIVERY_RETURN)은 제안 없이 배정된다(대기 중 내 배송에서 찾음).
//  - MFC 반납 때 반납 인증번호(execution 0.28.0)를 관찰 계정으로 MFC 직원 화면 목록에서 읽어 넣는다(사용자 2026-11-20 "반납 인증번호를 받게 해" — RR-09).

import type { ObserverApi, RiderApi, WriteOptions } from '../backend/port';
import { CONTRACT, simRiderPhone, type SimParams } from '../config';
import { ApiProblem, ResultUnknown, type DeliveryPurpose, type HandoverAuthorization, type Offer, type Shipment, type VehicleType } from '../domain/contract';
import { bearingDeg, distanceM, moveToward, type LatLng } from '../util/geo';
import { IdGen, Rng } from '../util/rng';
import { RiderRestrictedError, STOP_RESTRICTIONS, withAuthRecovery } from './authGuard';
import type { AddressLocator } from './geocode';
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
  /** 회수지·잘못 둔 곳으로 이동(회수·다시 배송) */
  | 'TO_PICKUP'
  /** 잘못 둔 곳 — 상품 찾기·사진·받음 */
  | 'AT_PICKUP'
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
  TO_PICKUP: '잘못 둔 곳으로 이동',
  AT_PICKUP: '잘못 둔 곳 — 상품 찾기',
  FAILING: '전달 실패 처리',
  RETURNING: '상품 들고 MFC 복귀',
  REMOTE: '실서버(읽기만)',
};

/** 제안을 어떻게 할지 — 순수 함수(시험용). */
export type OfferDecision = { kind: 'ACCEPT' } | { kind: 'REJECT'; reason: 'OTHER' | 'TOO_FAR' } | { kind: 'IGNORE' };

/** 가상 라이더가 받는 배송 목적 — 일반·재발송(가게 → 고객), 오배송 회수(잘못 둔 곳 → MFC), 고객 반품 회수(고객 집 → MFC) */
const ACCEPTED_PURPOSES: ReadonlySet<string> = new Set(['DELIVERY', 'MISDELIVERY_RESHIPMENT', 'MISDELIVERY_RECOVERY', 'CLAIM_RETURN']);

/**
 * canRedeliver: 다시 배송 전달지(주소만, 핀 없음)를 좌표로 찾을 수 있나.
 * maxTripEtaSec: 제안 예상 소요 합(pickupEtaSeconds + dropEtaSeconds — dispatch 0.4.5)이 이보다 길면 TOO_FAR. 둘 중 하나라도 없거나 null 이면 보지 않는다.
 */
export function decideOffer(
  offer: Offer,
  roll: number,
  acceptProbability: number,
  canRedeliver = false,
  maxTripEtaSec: number | null = null,
): OfferDecision {
  // 고객 반품 회수(CLAIM_RETURN)는 받는다(사용자 2026-11-20). 옛 주석: 회수(MISDELIVERY_RECOVERY)·고객 반품·재발송(MISDELIVERY_RESHIPMENT — dispatch 0.4.1)·고객 잘못 다시 배송(MISDELIVERY_REDELIVERY — 0.4.2, 가게 대신 잘못 둔 곳에서 받음)은 받지 않는다(§3-1).
  // 재발송(MISDELIVERY_RESHIPMENT, type RESHIPMENT)은 받는다 — execution 0.5.1 "수행은 일반 배송과 같다", 서비스 코드도 다시 배송(purpose)·회수(type RETURN)만 따로 처리
  // (pmart-backend 6df1e842 ExecutionStore.redelivery·recovery, 2026-11-16 확인). 목적이 없으면 종류로만 본다(FORWARD 만).
  if (offer.purpose !== undefined) {
    const ok = offer.purpose === 'MISDELIVERY_REDELIVERY' ? canRedeliver : ACCEPTED_PURPOSES.has(offer.purpose);
    if (!ok) return { kind: 'REJECT', reason: 'OTHER' };
  } else if (offer.deliveryType !== undefined && offer.deliveryType !== 'FORWARD') return { kind: 'REJECT', reason: 'OTHER' }; // 목적 모름 + 회수·재발송 종류
  const eta = tripEtaSec(offer);
  if (maxTripEtaSec !== null && eta !== null && eta > maxTripEtaSec) return { kind: 'REJECT', reason: 'TOO_FAR' };
  if (roll < acceptProbability) return { kind: 'ACCEPT' };
  // 나머지 절반은 거절, 절반은 무응답으로 만료 [시뮬]
  return roll < acceptProbability + (1 - acceptProbability) / 2 ? { kind: 'REJECT', reason: 'TOO_FAR' } : { kind: 'IGNORE' };
}

/** 제안 예상 소요 합(초) — 라이더 → 픽업지 + 픽업지 → 전달지. 둘 중 하나라도 없으면 null */
export function tripEtaSec(offer: Offer): number | null {
  const s = offer.summary;
  if (s?.pickupEtaSeconds === undefined || s.dropEtaSeconds === undefined) return null;
  return s.pickupEtaSeconds + s.dropEtaSeconds;
}

/** 화면 라이더 카드에 보일 진행 중 주문 요약 — 주문번호·품목 수·금액·예상 소요만(고객 요청사항·주소는 넣지 않는다) */
export interface RiderJob {
  orderNumber: string | null;
  /** 품목 줄 수 */
  lines: number | null;
  itemAmount: number | null;
  /** 수락 때 제안의 예상 소요 합(초) */
  etaSec: number | null;
}

export function jobOf(offer: Offer): RiderJob | null {
  const o = offer.summary?.order;
  const etaSec = tripEtaSec(offer);
  if (!o && etaSec === null) return null;
  return { orderNumber: o?.orderNumber ?? null, lines: o?.items?.length ?? null, itemAmount: o?.itemAmount ?? null, etaSec };
}

/** 시뮬레이터가 지표·화면에 쓰는 한 배송의 엔진 기록. */
export interface RiderTrip {
  deliveryId: string;
  /** 배송 목적(제안의 purpose) — 없으면 일반 */
  purpose?: DeliveryPurpose;
  offeredAt: number;
  acceptedAt?: number;
  storeArrivedAt?: number;
  readyAt?: number;
  pickedUpAt?: number;
  completedAt?: number;
  /** 전달 실패 등록 시각(완료 대신) */
  failedAt?: number;
  /** 라이더가 픽업 전 배정을 취소한 시각(다른 라이더에게 재배차) */
  cancelledAt?: number;
  /** 실패 반납(FAILED_DELIVERY_RETURN)을 MFC 에 반납한 시각 — 고객 전달이 아니라 완료 수에 넣지 않는다 */
  returnedAt?: number;
}

export interface RiderHooks {
  onTripDone(trip: RiderTrip): void;
  onNote(riderId: string, text: string): void;
}

/** 시뮬 시각 기준 대기·이동 약속을 tick 이 풀어 준다(MFC 시뮬레이터 Agent 와 같은 방식). */
/** 가입 때 운전면허 번호가 필수인 수단(rider 0.5.0 RiderSignupRequest.licenseNumber) */
const LICENSE_VEHICLES: readonly VehicleType[] = ['MOTORCYCLE', 'CAR', 'KICKBOARD'];

export class VirtualRider {
  readonly id: string;
  /** 가입할 때 등록하는 운송수단(지도 그림). 실서버 RD-sim-01·02 는 오토바이로 가입돼 있다 */
  vehicle: VehicleType = 'MOTORCYCLE';
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
  /** 진행 중 배송의 주문 요약(화면) — 수락한 제안에서 */
  job: RiderJob | null = null;
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
  /** 이 시각까지 위치를 못 올림(위치 끊김 장면) — 점은 모아 두었다가 풀리면 한꺼번에 */
  private offlineUntil = -Infinity;
  /** 반납이 막힌(반납 인증번호 등) 실패 반납 — 대기 중에 다시 집지 않는다 */
  private readonly stuckReturns = new Set<string>();
  /** 위치 끊김 중인가(화면 표시) */
  /** 신규배차 받는 중(운행 중) — 준비 전·멈춘 라이더는 아님 */
  get dispatchOn(): boolean {
    return this.phase !== 'PREPARING' && this.phase !== 'STOPPED';
  }

  get locationOffline(): boolean {
    return this.clock.now < this.offlineUntil;
  }

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
    private readonly options: {
      allowSignup: boolean;
      routes?: RouteProvider;
      /** 주소 → 좌표(다시 배송 전달지는 핀이 없다). MOCK 주소록 / 실서버 개발 서버 카카오 주소 검색(사용자 2026-11-16 "그렇게 해") */
      locator?: AddressLocator;
    } = { allowSignup: true },
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
    if (now < this.offlineUntil) return; // 위치 끊김 — 올리지 않는다(점은 위에서 계속 모은다, 최근 200점)
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
      // 오토바이·자동차·킥보드는 운전면허 번호가 필수(rider 0.5.0 422 LICENSE_REQUIRED) — 시뮬레이터는 면허 번호를 지어내지 않고 면허가 필요 없는 전기자전거로 가입(실서버만 — MOCK 은 여러 수단 그림을 그대로)
      if (this.params.mode === 'http' && LICENSE_VEHICLES.includes(this.vehicle)) this.vehicle = 'E_BIKE';
      await this.write(this.opts('signup'), (o) =>
        this.api.signup(
          {
            // 시험 전화번호 010-0000-00NN(사용자 2026-11-16, RR-02)
            phone: simRiderPhone(this.index),
            vehicleType: this.vehicle,
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
    this.job = null;
    this.trip = null;
    const handled = new Set<string>();
    let returnCheckAt = -Infinity;
    for (;;) {
      if (this.done) return null;
      // 제안 없이 바로 배정되는 실패 반납(dispatch 0.6.0) — 내 배송에서 찾는다(대기 들어올 때·30초마다 [시뮬])
      if (this.clock.now - returnCheckAt >= 30) {
        returnCheckAt = this.clock.now;
        const back = await this.findFailedReturn();
        if (back) return back;
      }
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
    const decision = decideOffer(detail, this.rng.next(), this.params.acceptProbability, this.options.locator?.ready === true, this.params.maxTripEtaSec);
    const [lo, hi] = this.params.offerResponseDelaySec;
    const delay = Math.min(this.rng.range(lo, hi), Math.max(0, (detail.remainingSec ?? CONTRACT.offerResponseWindowSec) - 2));
    this.trip = { deliveryId: detail.deliveryId ?? '', purpose: detail.purpose, offeredAt: this.clock.now };
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
      this.job = jobOf(detail);
      this.say(`수락 → 배정 ${res.deliveryId}`);
      return detail;
    }
    const eta = tripEtaSec(detail);
    const why = decision.kind === 'REJECT' ? decision.reason + (decision.reason === 'TOO_FAR' && eta !== null ? ` — 예상 ${Math.round(eta / 60)}분` : '') : '';
    this.say(res.outcome === 'LATE' ? `늦은 수락: ${res.lateReason}` : `거절(${why})`);
    return null;
  }

  /** 4~8. 배정된 배송 하나를 끝까지. */
  private async deliver(offer: Offer) {
    const deliveryId = offer.deliveryId as string;
    this.deliveryId = deliveryId;
    const trip = this.trip ?? { deliveryId, purpose: offer.purpose, offeredAt: this.clock.now };
    this.trip = trip;
    if (offer.purpose === 'MISDELIVERY_RECOVERY' || offer.purpose === 'MISDELIVERY_REDELIVERY') {
      await this.fromWrongPlace(deliveryId, trip, offer.purpose);
      return;
    }
    if (offer.purpose === 'FAILED_DELIVERY_RETURN') {
      await this.returnFailedGoods(deliveryId, trip);
      return;
    }
    if (offer.purpose === 'CLAIM_RETURN') {
      await this.claimReturn(deliveryId, trip);
      return;
    }

    // 4. MFC 로
    this.phase = 'TO_STORE';
    this.say('MFC 로 이동');
    // 라이더 배정 취소(조절 바 riderCancelRate) — 0 이면 난수를 쓰지 않는다
    if (this.params.riderCancelRate > 0 && this.rng.next() < this.params.riderCancelRate) {
      if (await this.cancelOnTheWay(deliveryId, trip)) return;
    } else {
      await this.moveTo(this.home, this.params.riderSpeedMps, true);
    }

    // execution 에 배정이 보일 때까지(사건 반영 대기)
    this.phase = 'WAIT_ASSIGN_REFLECT';
    const reflectFrom = this.clock.now;
    let version = await this.waitExecution(deliveryId, (s) => s === 'ASSIGNED', this.params.assignmentReflectWaitSec);
    // 수락 → execution 배정 반영까지(라이더 앱은 이 사이 GET /deliveries/{id} 가 404 — pmart-clients 라이더 앱 "수락 직후 다시 묻기")
    if (version !== null) this.say(`배정 반영 ${Math.round(this.clock.now - reflectFrom)}초`);
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
    const ship = await this.waitShipmentReady(dispatch.shipmentId, deliveryId);
    trip.readyAt = this.clock.now;
    this.phase = 'HANDOVER';
    // 틀린 번호는 배송당 한 번만(MOCK) — 서버는 같은 라이더·배송의 틀린 횟수를 합쳐 5번이면 잠근다
    let typo = this.params.handoverCodeTypoRate > 0 && this.rng.next() < this.params.handoverCodeTypoRate;
    // 이 출고 포장 번호들 — 일부러 넣는 틀린 번호가 옆 포장 번호와 같으면 그 포장이 허가돼 버린다
    const shipCodes = new Set((ship.packages ?? []).flatMap((p) => (p.handoverCode ? [p.handoverCode] : [])));
    for (const pk of ship.packages ?? []) {
      if (pk.state === 'HANDED_OVER' || !pk.packageId || !pk.qrCode) continue;
      // QR 이 안 찍히는 상황(조절 바 handoverByCodeRate) — 라벨 숫자로 같은 허가. 숫자가 없는 옛 포장은 QR 로.
      const byCode = !!pk.handoverCode && this.params.handoverByCodeRate > 0 && this.rng.next() < this.params.handoverByCodeRate;
      const code = byCode && pk.handoverCode ? { code: pk.handoverCode, typo, taken: shipCodes } : null;
      if (code?.typo) typo = false;
      await this.handover(pk.packageId, pk.qrCode, deliveryId, code);
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

    await this.toCustomerAndHandOff(deliveryId, trip);
  }

  /**
   * 7~8. 고객으로 → 도착 → 사진 → 완료(또는 고객 부재면 실패). drop-info 는 좌표만 쓴다(주소·전화는 저장·기록하지 않음).
   * 다시 배송은 핀이 없어 주소로 찾는다(locateAddress — MOCK). 못 찾으면 전달 실패(ADDRESS_ERROR)로 상품을 들고 돌아간다.
   * 실패 등록이 운영자와의 대화(DELIVERY_FAILURE)를 같이 열어 도움요청은 따로 보내지 않는다(execution 0.14.0 — 앱과 같게).
   */
  private async toCustomerAndHandOff(deliveryId: string, trip: RiderTrip) {
    const drop = await this.api.getDropInfo(deliveryId);
    const pin = drop.lat !== null && drop.lat !== undefined && drop.lng !== null && drop.lng !== undefined ? { lat: drop.lat, lng: drop.lng } : null;
    // 핀이 없으면 도로명 주소만으로 찾는다(상세 주소·수령인·전화는 쓰지 않음). 주소는 메모·기록에 남기지 않는다
    const point = pin ?? (this.options.locator ? await this.options.locator.locate(drop.roadAddress) : null);
    if (!point) {
      this.say('전달지 위치를 못 찾음 — 전달 실패 등록(주소)');
      const photo = await this.write(this.opts('photo'), (o) => this.api.uploadEvidencePhoto(deliveryId, testPhoto(), o));
      await this.failDelivery(deliveryId, trip, photo.photoRef, 'ADDRESS_ERROR');
      return;
    }
    if (!pin) this.say('전달지 핀 없음 — 주소로 위치 찾음');
    this.dropPoint = point;
    this.phase = 'TO_CUSTOMER';
    this.say('고객으로 이동');
    // 위치 끊김(조절 바 locationOutageRate) — 배송 상태는 그대로, tracking 이 3분 뒤 RiderLocationStale 만 낸다
    if (this.params.locationOutageRate > 0 && this.rng.next() < this.params.locationOutageRate) {
      this.offlineUntil = this.clock.now + this.params.locationOutageSec;
      this.say(`위치 전송 끊김 ${Math.round(this.params.locationOutageSec / 60)}분(앱 위치 전송 멈춤) — 배송은 계속`);
    }
    await this.moveTo(this.dropPoint, this.params.riderSpeedMps, true);
    await this.handOffAtDoor(deliveryId, trip, true);
  }

  /**
   * 8. 도착 → 사진 → 완료. mayFail = 고객 부재(조절 바)를 굴릴지 — 실패가 반려돼 다시 온 때는 굴리지 않는다.
   * 고객 "받았어요"·픽업 5시간 자동 완료(execution 0.20.0)와 겹치면 도착·완료가 409 — 다시 조회해 COMPLETED 면 끝난 것으로 본다.
   */
  private async handOffAtDoor(deliveryId: string, trip: RiderTrip, mayFail: boolean) {
    this.phase = 'AT_CUSTOMER';
    const finish = (how: string) => {
      trip.completedAt = this.clock.now;
      this.say(`${how} ${deliveryId}`);
      this.hooks.onTripDone(trip);
      this.dropPoint = null;
      this.target = null;
    };
    const cur = await this.api.getExecution(deliveryId);
    if (cur.state === 'COMPLETED') return finish('이미 완료됨(고객 확인·자동 완료)');
    if (cur.state !== 'ARRIVED_AT_CUSTOMER') {
      const arriveBody = { occurredAt: this.clock.iso(), location: { ...this.pos } }; // 한 번만 — 재전송 때 같은 본문
      if (!(await this.unlessCompleted(deliveryId, () => this.write(this.opts('arrive-customer', cur.version), (o) => this.api.reportCustomerArrival(deliveryId, arriveBody, o))))) {
        return finish('이미 완료됨(고객 확인·자동 완료)');
      }
    }
    await this.wait(20); // 문 앞까지 [시뮬]
    const photo = await this.write(this.opts('photo'), (o) => this.api.uploadEvidencePhoto(deliveryId, testPhoto(), o));
    // 고객 부재(조절 바 customerAbsentRate) — 0 이면 난수를 쓰지 않는다(기존 흐름·시험 그대로)
    if (mayFail && this.params.customerAbsentRate > 0 && this.rng.next() < this.params.customerAbsentRate) {
      await this.failDelivery(deliveryId, trip, photo.photoRef);
      return;
    }
    const takenAt = this.clock.iso();
    const after = await this.api.getExecution(deliveryId);
    const done = await this.unlessCompleted(deliveryId, () =>
      this.write(this.opts('complete', after.version), (o) =>
        this.api.reportCompletion(
          deliveryId,
          { method: 'CONTACTLESS', evidence: { photoRefs: [photo.photoRef], takenAt, placement: 'FRONT_DOOR' }, occurredAt: takenAt },
          o,
        ),
      ),
    );
    finish(done ? '전달 완료' : '이미 완료됨(고객 확인·자동 완료)');
  }

  /** 쓰기를 해 보고, 409 인데 배송이 이미 COMPLETED 면 false(고객 확인·자동 완료가 먼저). 그 밖 오류는 그대로 던진다. */
  private async unlessCompleted(deliveryId: string, run: () => Promise<unknown>): Promise<boolean> {
    try {
      await run();
      return true;
    } catch (e) {
      if (!(e instanceof ApiProblem && e.status === 409)) throw e;
      const x = await this.api.getExecution(deliveryId);
      if (x.state === 'COMPLETED') return false;
      throw e;
    }
  }

  /**
   * 회수(MISDELIVERY_RECOVERY)·다시 배송(MISDELIVERY_REDELIVERY): 잘못 둔 곳으로 → 상품 찾아 사진 → 받음(returns/pickups).
   *  - 회수: RETURN_PICKED_UP → MFC 로 → 반납(returns/store-deliveries → RETURNED_TO_STORE).
   *  - 다시 배송: PICKED_UP → 실제 집(주소로 찾음) → 고객 도착 → 사진 → 완료(일반 배송과 같음).
   * 가게 도착·MFC 인계는 없다(execution 409). 잘못 둔 곳 좌표는 배정 라이더에게만 보이는 배차 조회 recovery.pickup.
   */
  private async fromWrongPlace(deliveryId: string, trip: RiderTrip, purpose: 'MISDELIVERY_RECOVERY' | 'MISDELIVERY_REDELIVERY') {
    const recovery = purpose === 'MISDELIVERY_RECOVERY';
    const disp = await this.api.getDispatch(deliveryId);
    const p = disp.recovery?.pickup;
    if (p?.lat === undefined || p.lng === undefined) {
      // 좌표가 없으면 찾아갈 수 없다 — 배정을 놓는다(재배차). 운영자 확인은 도움요청으로
      this.say('잘못 둔 곳 좌표 없음 — 배정 취소(재배차)');
      await this.write(this.opts('cancel', disp.version), (o) =>
        this.api.cancelAssignment(deliveryId, { requestedBy: 'RIDER', reason: 'RIDER_UNABLE', reasonDetail: '회수지 좌표 없음(시뮬레이터)', reassign: true }, o),
      );
      trip.cancelledAt = this.clock.now;
      this.hooks.onTripDone(trip);
      return;
    }
    const wrong = { lat: p.lat, lng: p.lng };
    this.phase = 'TO_PICKUP';
    this.say(recovery ? '회수 — 잘못 둔 곳으로 이동' : '다시 배송 — 잘못 둔 곳으로 이동');
    await this.moveTo(wrong, this.params.riderSpeedMps, true);

    this.phase = 'WAIT_ASSIGN_REFLECT';
    const reflectFrom = this.clock.now;
    let version = await this.waitExecution(deliveryId, (s) => s === 'ASSIGNED', this.params.assignmentReflectWaitSec);
    // 수락 → execution 배정 반영까지(라이더 앱은 이 사이 GET /deliveries/{id} 가 404 — pmart-clients 라이더 앱 "수락 직후 다시 묻기")
    if (version !== null) this.say(`배정 반영 ${Math.round(this.clock.now - reflectFrom)}초`);
    if (version === null) {
      this.say('배정이 execution 에 보이지 않음 — 이 배송을 놓고 대기로');
      this.hooks.onTripDone(trip);
      return;
    }
    this.phase = 'AT_PICKUP';
    this.say('잘못 둔 곳 도착 — 상품 찾아 사진');
    await this.wait(30); // 상품 찾기 [시뮬]
    const photo = await this.write(this.opts('photo'), (o) => this.api.uploadEvidencePhoto(deliveryId, testPhoto(), o));
    version = (await this.api.getExecution(deliveryId)).version ?? version;
    const pickBody = { items: [], evidenceRefs: [photo.photoRef], occurredAt: this.clock.iso(), location: { ...this.pos } }; // 한 번만 — 재전송 때 같은 본문
    await this.write(this.opts('ret-pickup', version), (o) => this.api.reportReturnPickup(deliveryId, pickBody, o));
    trip.pickedUpAt = this.clock.now;

    if (!recovery) {
      this.say('잘못 둔 곳에서 받음 — 실제 집으로');
      await this.toCustomerAndHandOff(deliveryId, trip);
      return;
    }
    this.say('회수품 받음 — MFC 로');
    this.phase = 'RETURNING';
    await this.moveTo(this.home, this.params.riderSpeedMps, true);
    const back = await this.waitExecution(deliveryId, (s) => s === 'RETURN_PICKED_UP', 60);
    if (back === null) throw new Error(`회수 뒤 RETURN_PICKED_UP 이 보이지 않음 (${deliveryId})`);
    if (!(await this.storeReturn(deliveryId, back, [photo.photoRef]))) {
      this.hooks.onTripDone(trip);
      return;
    }
    trip.completedAt = this.clock.now;
    this.say(`회수품 MFC 반납 ${deliveryId}`);
    this.hooks.onTripDone(trip);
    this.target = null;
  }

  /**
   * 배정 취소(픽업 전): 가게로 가다가 사정이 생겨 취소 → dispatch 가 이 라이더를 빼고 재배차(reassign 기본 true).
   * 인계 전이라 상품은 가게에 남는다(dispatch 계약). 취소가 거절되면(409 등 — 이미 픽업·상태 바뀜) 그대로 배송한다.
   * 돌려주는 값: 취소됐으면 true.
   */
  private async cancelOnTheWay(deliveryId: string, trip: RiderTrip): Promise<boolean> {
    const going = this.moveTo(this.home, this.params.riderSpeedMps, true);
    await this.wait(this.rng.range(30, 90)); // 가다가 사정이 생김 [시뮬]
    this.say('사정이 생겨 배정 취소 요청(픽업 전)');
    try {
      const disp = await this.api.getDispatch(deliveryId);
      await this.write(this.opts('cancel', disp.version), (o) =>
        this.api.cancelAssignment(deliveryId, { requestedBy: 'RIDER', reason: 'RIDER_UNABLE', reasonDetail: '개인 사정(시뮬레이터)', reassign: true }, o),
      );
    } catch (e) {
      if (!(e instanceof ApiProblem)) throw e;
      this.say(`배정 취소 거절(${e.status} ${e.code ?? ''}) — 그대로 배송`);
      await going;
      return false;
    }
    // 이동을 멈춘다(가던 경로 버림) — 대기로 돌아가면 MFC 근처로 천천히 다가간다
    this.moveResolve = null;
    this.path = null;
    this.pathKind = null;
    this.target = null;
    trip.cancelledAt = this.clock.now;
    this.say(`배정 취소 — ${deliveryId} 다른 라이더에게 재배차`);
    this.hooks.onTripDone(trip);
    return true;
  }

  /**
   * 고객 반품 회수(CLAIM_RETURN — dispatch 0.5.0·execution 0.10.0): 배정 → 전달지(= 회수지, 고객 집 — 받기 전에도 열림) → 고객 집 →
   * 사진 → 받음(returns/pickups, items 빈 배열 — 줄·수량은 claim 이 정함) → RETURN_PICKED_UP → MFC → 반납(반납 인증번호).
   * 가게 도착·MFC 인계·고객 도착·전달 완료 같은 일반 단계는 없다(409). 전달지는 좌표만 쓰고 버린다.
   * 고객 부재로 못 받는 경우(받기 전 실패 등록)는 아직 흉내 내지 않는다.
   */
  private async claimReturn(deliveryId: string, trip: RiderTrip) {
    this.phase = 'WAIT_ASSIGN_REFLECT';
    const reflectFrom = this.clock.now;
    let version = await this.waitExecution(deliveryId, (s) => s === 'ASSIGNED', this.params.assignmentReflectWaitSec);
    if (version === null) {
      this.say('배정이 execution 에 보이지 않음 — 이 배송을 놓고 대기로');
      this.hooks.onTripDone(trip);
      return;
    }
    this.say(`배정 반영 ${Math.round(this.clock.now - reflectFrom)}초`);
    const drop = await this.api.getDropInfo(deliveryId);
    const pin = drop.lat !== null && drop.lat !== undefined && drop.lng !== null && drop.lng !== undefined ? { lat: drop.lat, lng: drop.lng } : null;
    const point = pin ?? (this.options.locator ? await this.options.locator.locate(drop.roadAddress) : null);
    if (!point) {
      this.say('반품 회수지(고객 집) 위치를 못 찾음 — 배정 취소(재배차)');
      const disp = await this.api.getDispatch(deliveryId);
      await this.write(this.opts('cancel', disp.version), (o) =>
        this.api.cancelAssignment(deliveryId, { requestedBy: 'RIDER', reason: 'RIDER_UNABLE', reasonDetail: '회수지 위치 못 찾음(시뮬레이터)', reassign: true }, o),
      );
      trip.cancelledAt = this.clock.now;
      this.hooks.onTripDone(trip);
      return;
    }
    this.dropPoint = point;
    this.phase = 'TO_PICKUP';
    this.say('반품 회수 — 고객 집으로 이동');
    await this.moveTo(point, this.params.riderSpeedMps, true);
    this.phase = 'AT_PICKUP';
    this.say('고객 집 도착 — 반품 상품 받아 사진');
    await this.wait(30); // 고객에게 받기 [시뮬]
    const photo = await this.write(this.opts('photo'), (o) => this.api.uploadEvidencePhoto(deliveryId, testPhoto(), o));
    version = (await this.api.getExecution(deliveryId)).version ?? version;
    const pickBody = { items: [], evidenceRefs: [photo.photoRef], occurredAt: this.clock.iso(), location: { ...this.pos } }; // 한 번만 — 재전송 때 같은 본문
    await this.write(this.opts('ret-pickup', version), (o) => this.api.reportReturnPickup(deliveryId, pickBody, o));
    trip.pickedUpAt = this.clock.now;
    this.dropPoint = null;
    this.say('반품 상품 받음 — MFC 로');
    this.phase = 'RETURNING';
    await this.moveTo(this.home, this.params.riderSpeedMps, true);
    const back = await this.waitExecution(deliveryId, (s) => s === 'RETURN_PICKED_UP', 60);
    if (back === null) throw new Error(`반품 받은 뒤 RETURN_PICKED_UP 이 보이지 않음 (${deliveryId})`);
    if (!(await this.storeReturn(deliveryId, back, [photo.photoRef]))) {
      this.hooks.onTripDone(trip);
      return;
    }
    trip.completedAt = this.clock.now;
    this.say(`반품 상품 MFC 반납 ${deliveryId}`);
    this.hooks.onTripDone(trip);
    this.target = null;
  }

  /**
   * MFC 반납(returns/store-deliveries). 반납 인증번호(execution 0.28.0)는 MFC 직원 화면 목록(GET /return-handovers?mfcId= — 관찰 계정, MFC 작업자)에서
   * 이 배송 번호를 읽어 넣는다 = 직원이 라이더에게 번호를 불러 준다(RR-09). 목록을 못 읽거나 없으면 번호 없이 보낸다(서버 설정이 꺼져 있으면 통과).
   * 돌려주는 값: 반납됐으면 true. 번호 때문에 막히면(422 RETURN_HANDOVER_*) 멈추지 않고 false.
   */
  private async storeReturn(deliveryId: string, version: number, evidenceRefs: string[]): Promise<boolean> {
    const code = await this.returnCode(deliveryId);
    if (code === 'LOCKED') {
      this.say('반납 인증번호 잠김(5번 틀림) — MFC 직원이 번호를 새로 내야 함');
      return false;
    }
    // 본문은 한 번만 — 응답이 끊겨 같은 키로 다시 보낼 때 같은 본문
    const body = { ...(evidenceRefs.length ? { evidenceRefs } : {}), occurredAt: this.clock.iso(), location: { ...this.pos }, ...(code ? { handoverCode: code } : {}) };
    try {
      await this.write(this.opts('ret-store', version), (o) => this.api.reportReturnStoreDelivery(deliveryId, body, o));
    } catch (e) {
      if (!(e instanceof ApiProblem && e.status === 422 && e.code?.startsWith('RETURN_HANDOVER'))) throw e;
      this.say(`MFC 반납 막힘(422 ${e.code}) — 반납 인증번호 확인 필요`);
      return false;
    }
    if (code) this.say('반납 인증번호(직원 화면)로 반납'); // 번호 자체는 메모·로그에 남기지 않는다(인증용 값)
    return true;
  }

  /** 직원 화면의 반납 인증번호 — 없으면 null, 잠겼으면 'LOCKED'. 목록을 못 읽으면 null(번호 없이 보내 본다) */
  private async returnCode(deliveryId: string): Promise<string | null | 'LOCKED'> {
    try {
      const list = await this.observer.listReturnHandovers(this.params.mfcId);
      const row = (list.items ?? []).find((x) => x.deliveryId === deliveryId);
      if (!row) return null;
      return row.locked ? 'LOCKED' : row.code;
    } catch (e) {
      if (e instanceof ApiProblem) {
        this.say(`반납 인증번호 목록을 못 읽음(${e.status} ${e.code ?? ''}) — 번호 없이 반납 시도`);
        return null;
      }
      throw e;
    }
  }

  /**
   * 전달 실패(고객 부재): 연락 2번(계약 — 고객 사유는 2회 이상 필수) → 문 앞 사진을 근거로 실패 등록(FAILURE_REPORTED, 아직 진행 중)
   * → 운영자 확정(FAILED) 기다림 → 상품을 들고 MFC 로 복귀. 실패 확정은 라이더가 하지 않는다(execution 계약 — 운영자).
   * 확정되면 dispatch 가 반납 배송(FAILED_DELIVERY_RETURN)을 이 라이더에게 바로 배정한다 — 대기로 돌아가면 idleUntilAssigned 가 찾아 반납(returns/store-deliveries).
   * 다른 라이더가 반납하기로 정해지면(returnBy OTHER_RIDER) 그 배송은 이 라이더에게 안 보인다(404) — 그 자리에서 끝낸다.
   * 운영자가 반려(REJECT)하거나 확정을 되돌리면(0.32.0) 배송이 PICKED_UP·ARRIVED_AT_CUSTOMER 로 돌아온다 — 전달을 이어간다.
   */
  private async failDelivery(deliveryId: string, trip: RiderTrip, photoRef: string, reason: 'CUSTOMER_ABSENT' | 'ADDRESS_ERROR' = 'CUSTOMER_ABSENT') {
    this.phase = 'FAILING';
    this.say(reason === 'CUSTOMER_ABSENT' ? '고객 부재 — 연락 2번 시도' : '주소 확인 — 고객에게 연락 2번 시도');
    const first = this.clock.iso();
    await this.wait(30); // 전화·메시지 [시뮬]
    const second = this.clock.iso();
    const x = await this.api.getExecution(deliveryId);
    await this.write(this.opts('fail', x.version), (o) =>
      this.api.reportFailure(
        deliveryId,
        {
          reason,
          detail: reason === 'CUSTOMER_ABSENT' ? '고객 부재(시뮬레이터)' : '주소로 위치를 못 찾음(시뮬레이터)',
          evidenceRefs: [photoRef],
          goodsLocation: 'WITH_RIDER',
          // 안심번호를 없앤 뒤(execution 0.11.0) 라이더 앱이 보내는 값
          contactAttempts: [
            { attemptedAt: first, method: 'PHONE_CALL', result: 'NO_ANSWER' },
            { attemptedAt: second, method: 'SMS', result: 'NO_ANSWER' },
          ],
          occurredAt: second,
        },
        o,
      ),
    );
    trip.failedAt = this.clock.now;
    this.say('전달 실패 등록(운영자 대화 열림) — 운영자 확정 기다림');
    // 확정은 사람(운영자)이 한다 — 실서버면 오래 걸릴 수 있어 최대 30분만 기다리고, 그 뒤에도 상품은 들고 돌아간다
    // (늦게 확정되면 반납 배송은 대기 중에 찾아 처리한다)
    const settled = (s: string | undefined) => s === 'FAILED' || s === 'PICKED_UP' || s === 'ARRIVED_AT_CUSTOMER';
    const v = await this.waitExecution(deliveryId, settled, 30 * 60);
    const now = v === null ? null : await this.api.getExecution(deliveryId);
    if (now && (now.state === 'PICKED_UP' || now.state === 'ARRIVED_AT_CUSTOMER')) {
      trip.failedAt = undefined;
      this.say('실패 반려·되돌림 — 전달 이어감');
      await this.handOffAtDoor(deliveryId, trip, false);
      return;
    }
    if (now?.failure?.returnBy === 'OTHER_RIDER') {
      this.say('실패 확정 — 다른 라이더가 반납하러 옴(상품 넘길 준비)');
      this.dropPoint = null;
      this.hooks.onTripDone(trip);
      this.target = null;
      return;
    }
    this.say(v === null ? '실패 확정 안 됨(30분) — 상품 들고 MFC 로' : '실패 확정 — 상품 들고 MFC 로(반납 배송)');
    this.phase = 'RETURNING';
    this.dropPoint = null;
    await this.moveTo(this.home, this.params.riderSpeedMps, true);
    this.say(`MFC 도착 — ${deliveryId} 상품 반납은 반납 배송으로`);
    this.hooks.onTripDone(trip);
    this.target = null;
  }

  /** 나에게 제안 없이 배정된 실패 반납(ASSIGNED) — 있으면 deliver 로 넘길 제안 모양 */
  private async findFailedReturn(): Promise<Offer | null> {
    let mine;
    try {
      mine = await this.api.listMyDeliveries({ state: 'ASSIGNED' });
    } catch (e) {
      if (e instanceof ApiProblem) return null; // 조회가 안 되면 다음 박자에 다시
      throw e;
    }
    const back = (mine.items ?? []).find((x) => x.purpose === 'FAILED_DELIVERY_RETURN' && x.state === 'ASSIGNED' && x.deliveryId && !this.stuckReturns.has(x.deliveryId));
    if (!back?.deliveryId) return null;
    this.trip = { deliveryId: back.deliveryId, purpose: 'FAILED_DELIVERY_RETURN', offeredAt: this.clock.now, acceptedAt: this.clock.now };
    this.say(`실패 반납 배정됨 ${back.deliveryId}(원래 ${back.originDeliveryId ?? '?'}) — MFC 로`);
    return { deliveryId: back.deliveryId, purpose: 'FAILED_DELIVERY_RETURN', deliveryType: 'RETURN' };
  }

  /**
   * 실패 반납(FAILED_DELIVERY_RETURN): 상품을 들고 MFC 로 → ASSIGNED 에서 바로 반납(returns/store-deliveries → RETURNED_TO_STORE).
   * 받음(returns/pickups) 단계는 없다(execution 0.15.0 — 409). 반납 인증번호는 storeReturn 이 직원 화면 목록에서 읽어 넣는다.
   */
  private async returnFailedGoods(deliveryId: string, trip: RiderTrip) {
    this.phase = 'RETURNING';
    if (distanceM(this.pos, this.home) > 30) {
      this.say('실패 상품 들고 MFC 로');
      await this.moveTo(this.home, this.params.riderSpeedMps, true);
    }
    const version = await this.waitExecution(deliveryId, (s) => s === 'ASSIGNED', this.params.assignmentReflectWaitSec);
    if (version === null) {
      this.say(`실패 반납 ${deliveryId} 이 execution 에 ASSIGNED 로 안 보임 — 대기로`);
      this.stuckReturns.add(deliveryId);
      this.hooks.onTripDone(trip);
      return;
    }
    if (!(await this.storeReturn(deliveryId, version, []))) {
      this.stuckReturns.add(deliveryId);
      this.hooks.onTripDone(trip);
      return;
    }
    trip.returnedAt = this.clock.now;
    this.say(`실패 상품 MFC 반납 ${deliveryId}`);
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

  /** 출고 READY 까지 기다린다. 오래 걸리면(storeWaitHelpSec) 도움요청 STORE_WAITING 을 한 번 보낸다. */
  private async waitShipmentReady(shipmentId: string, deliveryId: string): Promise<Shipment> {
    const since = this.clock.now;
    let helped = false;
    for (;;) {
      const helpAfter = this.params.storeWaitHelpSec;
      if (!helped && helpAfter !== null && this.clock.now - since >= helpAfter) {
        helped = true;
        try {
          await this.write(this.opts('help'), (o) =>
            this.api.createHelpRequest(deliveryId, { category: 'STORE_WAITING', detail: `포장 대기 ${Math.round((this.clock.now - since) / 60)}분 넘음(시뮬레이터)` }, o),
          );
          this.say('포장이 늦어 도움요청(STORE_WAITING) — 계속 기다림');
        } catch (e) {
          if (!(e instanceof ApiProblem)) throw e;
          this.say(`도움요청 거절(${e.status} ${e.code ?? ''}) — 계속 기다림`);
        }
      }
      const s = await this.observer.getShipment(shipmentId);
      if (s.state === 'READY' || s.state === 'PARTIALLY_HANDED_OVER') return s;
      if (s.state === 'HANDED_OVER' || s.state === 'CANCELLED' || s.state === 'CLOSED_PARTIAL') {
        throw new Error(`출고 ${shipmentId} 상태 ${s.state} — 인계할 수 없음`);
      }
      this.say(`포장 대기(출고 ${s.state})`);
      await this.wait(this.params.storeWaitPollSec);
    }
  }

  /**
   * 라벨 숫자로 인계 허가(fulfillment F-8·R-26) — 라이더 앱 "번호로 인계"와 같은 길.
   * typo 면 먼저 틀린 번호를 한 번 넣어 409 HANDOVER_CODE_MISMATCH·남은 횟수를 본다(MOCK 만 — 실서버는 handoverCodeTypoRate 0).
   * 번호로 허가를 못 받으면(400·409 — 틀림·잠김·같은 번호 둘·다른 배송) null → 부른 쪽이 QR 로 다시 받는다(라이더 앱과 같게).
   * 숫자마다 새 멱등 키(라이더 앱과 같게 — 같은 키·다른 본문은 409 IDEMPOTENCY_CONFLICT).
   */
  private async authorizeByCode(c: HandoverByCode, deliveryId: string): Promise<HandoverAuthorization | null> {
    const send = (handoverCode: string) =>
      this.write(this.opts('ho-code'), (o) => this.api.authorizeHandoverByCode({ riderId: this.id, deliveryId, handoverCode }, o));
    if (c.typo) {
      const wrong = wrongCode(c.code, c.taken);
      try {
        await send(wrong);
        this.say(`틀린 번호 ${wrong} 가 통과됨 — 서버 확인 필요`);
      } catch (e) {
        if (!(e instanceof ApiProblem)) throw e;
        const left = e.problem.details?.find((d) => d.field === 'attemptsLeft')?.reason;
        this.say(`번호 틀림(${e.status} ${e.code ?? ''}${left !== undefined ? ` · 남은 ${left}번` : ''}) — 다시 입력`);
      }
    }
    try {
      const auth = await send(c.code);
      this.say(`번호 ${c.code} 로 인계 허가 ${auth.packageId ?? ''}`);
      return auth;
    } catch (e) {
      if (!(e instanceof ApiProblem && (e.status === 400 || e.status === 409))) throw e;
      this.say(`번호 인계 막힘(${e.status} ${e.code ?? ''}) — QR 로 다시`);
      return null;
    }
  }

  /** 포장 하나: QR(또는 라벨 숫자) 허가 → 확정. 확정 결과를 모르면 판정 조회로 해소. fence 만료면 다시 찍는다. */
  private async handover(packageId: string, qrCode: string, deliveryId: string, byCode: HandoverByCode | null = null) {
    let code = byCode;
    for (let attempt = 0; attempt < 3; attempt++) {
      const authBody = { riderId: this.id, deliveryId, scannedCode: qrCode, scannedAt: this.clock.iso() }; // 한 번만 — 재전송 때 같은 본문
      let auth = code ? await this.authorizeByCode(code, deliveryId) : null;
      // 다시 찍을 때 틀린 번호는 또 넣지 않고, 번호가 막혔으면 이 포장은 QR 로
      if (code) code = auth ? { ...code, typo: false } : null;
      if (!auth) {
        auth = await this.write(this.opts('ho-auth'), (o) => this.api.authorizeHandover(packageId, authBody, o));
        this.say(`QR 인계 ${packageId}`);
      }
      // 확정·판정 조회는 응답의 packageId 로(계약 — 번호 허가는 서버가 포장을 고른다)
      const pkgId = auth.packageId ?? packageId;
      const fence = auth;
      await this.wait(3); // 포장을 받아 드는 시간 [시뮬]
      try {
        const res = await this.write(this.opts('ho-commit'), (o) =>
          this.api.commitHandover(
            pkgId,
            { handoverAuthorizationId: fence.handoverAuthorizationId ?? '', fenceVersion: fence.fenceVersion ?? 0, riderId: this.id },
            o,
          ),
        );
        if (res.status === 'APPLIED') return;
        if (res.status === 'UNKNOWN_RESULT') {
          for (let i = 0; i < 10; i++) {
            await this.wait(2);
            const v = await this.api.getHandoverResolution(pkgId);
            if (v.verdict === 'HANDED_OVER') return;
          }
        }
        throw new Error(`인계 확정 ${res.status} (${pkgId}) — 대사 필요`);
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

/** 번호로 인계할 포장 — code 라벨 숫자, typo 먼저 틀린 번호 한 번(MOCK), taken 같은 출고 포장 번호들 */
interface HandoverByCode {
  code: string;
  typo: boolean;
  taken: ReadonlySet<string>;
}

/** 일부러 넣는 틀린 번호 — 같은 자릿수, 맞는 번호·같은 출고 다른 포장 번호와 겹치지 않게. */
export function wrongCode(code: string, taken: ReadonlySet<string>): string {
  const mod = 10 ** code.length;
  for (let d = 1; d < mod; d++) {
    const w = String((Number(code) + d) % mod).padStart(code.length, '0');
    if (!taken.has(w)) return w;
  }
  return code; // 모든 번호가 쓰임 — 현실에선 없음
}

/** 시험용 증빙 사진(JPEG 머리만 있는 작은 바이트) — 실제 사진이 아니다. */
function testPhoto(): Blob {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
  return new Blob([bytes], { type: 'image/jpeg' });
}
