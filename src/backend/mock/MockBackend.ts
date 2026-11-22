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
//  - 오배송(조절 바 misdeliveryRate): 전달 완료 뒤 case-service 대신 MisdeliveryConfirmed → 라이더·시스템 잘못이면 MFC 회수(DD-2) + 재발송,
//    고객 잘못이면 다시 배송(ADR-0065 — 200m 미만 원래 기사 먼저 0원, 이상 결제 대기 → order-orchestration 대신 결제·거절).
//  - 운영자 상태 정정·고객 반품 회수(CLAIM_RETURN)는 만들지 않는다.

import { CONTRACT, isSimRiderId, MOCK_ORDER, type MockParams } from '../../config';
import {
  ApiProblem,
  ResultUnknown,
  type AccountRestriction,
  type AssignmentCancellationRequest,
  type Center,
  type CommandResponse,
  type CompletionMethod,
  type CompletionRequest,
  type Delivery,
  type DeliveryExecution,
  type DeliveryListItem,
  type DeliveryListResponse,
  type DeliveryPurpose,
  type DeliveryType,
  type OrderShippingAddress,
  type OrderStatus,
  type StaffOrderDetail,
  type StaffPiiField,
  type StaffPiiReveal,
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
  type HandoverCodeAuthorizationRequest,
  type HandoverCommitRequest,
  type HandoverCommitResult,
  type HandoverResolution,
  type PickupPointList,
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
  type ReturnHandover,
  type RiderDisplayNames,
  type StaffDeliveryListResponse,
  type StatusHistoryEntry,
  type TransitionRequest,
  type VehicleType,
  type Withdrawal,
  type WithdrawalBlocker,
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
  /** 마지막 업로드 받은 시각(점 품질·순서 무관 — tracking rider_signal.last_received_at) */
  lastReceivedAt?: number;
  /** 이 기준 시각의 끊김은 이미 알렸다(끊김 한 번에 한 번 — tracking alerted_for) */
  staleAlertedFor?: number;
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
  /** 라벨 숫자 4자리(fulfillment 0.23.0) — QR 이 안 찍힐 때 라이더 입력 */
  handoverCode: string;
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
  /** 재발송 출고(MISDELIVERY_RESHIPMENT)면 목적·사건 */
  purpose: DeliveryPurpose;
  caseId?: string;
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
  /** MOCK 도착지 — 일반·재발송·다시 배송은 고객(다시 배송은 실제 집), 회수는 MFC. 실서버는 배정 라이더가 drop-info 로만 안다 */
  customer: LatLng;
  createdAt: number;
  type: DeliveryType;
  purpose: DeliveryPurpose;
  caseId?: string;
  originDeliveryId?: string;
  /** 회수·다시 배송의 픽업지(잘못 둔 곳) — 배차 반경의 중심. 없으면 MFC */
  pickup?: { at: LatLng; source: 'RIDER_COMPLETION_LOCATION' | 'DROP_ADDRESS' };
  /** 다시 배송 실제 집 주소(MOCK 가짜 문자열) — 좌표는 MockBackend.locateAddress 로만 */
  homeAddress?: string;
  /** 고객 반품 회수(CLAIM_RETURN) 클레임 */
  claimId?: string;
  /** 반납 인증번호(execution 0.28.0) — 직원 화면 목록을 처음 볼 때 만든다 */
  returnCode?: { code: string; failed: number; locked: boolean; issuedAt: number };
  /** 다시 배송 결제 대기(200m 이상) — 결제되면 배차를 푼다 */
  paymentRequired?: boolean;
  /** 다시 배송 200m 미만 — 원래 기사에게 먼저(반경 무관, 0원). 그 제안이 끝나면 지운다 */
  preferRiderId?: string;
  /** 제안 예상 배달료(원) — 다시 배송 원래 기사 0원, 나머지는 표시 안 함 */
  feeZero?: boolean;
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
    evidence?: { method: CompletionMethod; photoRefs: string[]; takenAt: string; placement?: string };
    failure?: {
      reason: string;
      goodsLocation?: string;
      photoRefs: string[];
      contactAttempts: number;
      reportedAt: string;
      /** 실패 등록이 같이 연 DELIVERY_FAILURE 대화(execution 0.14.0) */
      helpRequestId?: string;
      decision?: 'CONFIRM' | 'REJECT';
      decidedBy?: string;
      decidedAt?: string;
      custody?: 'RIDER' | 'STORE';
      /** 실패 확정(custody RIDER) 뒤 같은 라이더에게 바로 배정한 반납 배송(execution 0.15.0) */
      returnDeliveryId?: string;
      returnBy?: 'SAME_RIDER' | 'OTHER_RIDER';
    };
    helps: MHelp[];
    assignedAt?: number;
    completedAt?: number;
    /** 전달 완료를 누른 곳(MOCK tracking 위치) — 오배송 회수지 */
    completedAtPos?: LatLng;
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

/** MOCK 반납 인증번호 4자리 — 배송 ID 로 정한다(난수를 쓰면 다른 MOCK 난수 순서가 바뀐다) */
function returnCodeOf(deliveryId: string): string {
  let h = 7;
  for (const ch of deliveryId) h = (h * 31 + ch.charCodeAt(0)) % 10000;
  return String(h).padStart(4, '0');
}

/** 라벨 숫자 인계 — 같은 라이더·배송이 이만큼 틀리면 잠김(fulfillment 0.23.0 R-26) */
const MAX_CODE_FAILURES = 5;

function fail(status: number, code: string, title?: string, details?: ReadonlyArray<{ field: string; reason: string }>): never {
  throw new ApiProblem(status, { status, code, title: title ?? code, type: 'about:blank', traceId: 'mock', ...(details ? { details: [...details] } : {}) });
}

export interface MockOrderOptions {
  /** 고객 위치(없으면 MFC 둘레 아무 곳) */
  customer?: LatLng;
  /** 주문 → 배차 요청까지 초 */
  pickSec?: number;
  /** 배차 요청 → 포장 끝까지 분 */
  packMinutes?: number;
  packages?: number;
  /** 재발송 출고: 원래 주문·목적·사건 */
  orderId?: string;
  purpose?: DeliveryPurpose;
  caseId?: string;
}

/** MOCK 주문 요약 — 실서버는 order `rider-summary`. 고객 요청사항은 만들지 않는다(화면·로그에 옮기지 않는 값) */
interface MOrderSummary {
  orderNumber: string;
  items: { name: string; optionLabel: string | null; qty: number; lineAmount: number }[];
  itemAmount: number;
  /** 주문 확정(시뮬레이션 초) — 주문 창 "주문" 탭 */
  confirmedAt: number;
  /** 요청사항이 있나(가짜 문구) */
  hasNote: boolean;
}

/** MOCK 배송지 — 가린 값(직원 상세 가림 규칙대로: 이름 첫·끝 글자, 전화 앞 3·끝 4, 상세 주소 ***) */
const MOCK_ADDRESS_MASKED: OrderShippingAddress = {
  roadAddress: '(MOCK) 부산 부산진구 가상대로 123',
  detailAddress: '***',
  postalCode: '47000',
  receiverName: '김*상',
  receiverPhone: '010-****-0000',
  entranceMethod: 'PASSWORD',
  entranceNote: null,
  geo: null,
};

/** MOCK 품목 이름(가짜) */
const MOCK_ITEM_NAMES = ['우유 1L', '계란 10구', '두부', '바나나', '생수 2L', '식빵', '양파 1.5kg', '닭가슴살', '요거트', '감자 1kg', '사과 4입', '라면 5입'];

export class MockBackend implements RiderPort {
  readonly mode = 'mock' as const;
  readonly observer: ObserverApi;

  readonly riders = new Map<string, MRider>();
  readonly deliveries = new Map<string, MDelivery>();
  readonly shipments = new Map<string, MShipment>();
  readonly offers = new Map<string, MOffer>();
  private readonly photos = new Map<string, MPhoto>();
  private readonly involved = new Map<string, Set<string>>();
  private readonly withdrawals = new Map<string, { riderId: string; state: 'PENDING' | 'COMPLETED' | 'REJECTED'; blockers: WithdrawalBlocker[] }>();
  private readonly idem = new Map<string, { fp: string; outcome: IdemOutcome }>();
  private readonly later: { at: number; fn: () => void }[] = [];
  private readonly apiListeners = new Set<ApiListener>();
  private readonly eventListeners = new Set<EventListener>();
  private readonly ids = new IdGen('m');
  private readonly rng: Rng;
  /** 주문 요약 전용 난수 — 기존 난수 순서(시험 기대값)를 흔들지 않게 따로 */
  private readonly orderRng: Rng;
  /** MOCK 이 order-service 대신 갖는 주문 요약(dispatch 제안 order · execution orderSummary) */
  private readonly orderSummaries = new Map<string, MOrderSummary>();
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
    this.orderRng = new Rng(seed ^ 0x0dde);
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

  // ───────────── 배송 종류 (execution 규칙 — ExecutionService.mfcPickupOnly·forwardOnly·photoAllowed) ─────────────

  /** 가게 도착·MFC 인계 픽업은 다시 배송·회수에 없다 */
  private mfcPickupOnly(del: MDelivery) {
    if (del.purpose === 'MISDELIVERY_REDELIVERY') fail(409, 'INVALID_STATE', '오배송 다시 배송 — 잘못 둔 곳에서 받음(returns/pickups)');
    this.forwardOnly(del);
  }

  /** 일반 단계(가게 도착·픽업·고객 도착·전달 완료·실패 등록)는 회수 배송에 쓰지 않는다 */
  private forwardOnly(del: MDelivery) {
    if (del.type === 'RETURN') fail(409, 'INVALID_STATE', '회수 배송 — returns/pickups·store-deliveries');
  }

  /** 사진을 올릴 수 있는 상태 — 다시 배송은 잘못 둔 곳(배정)부터, 회수는 배정·회수 뒤, 그 밖은 픽업 뒤 */
  private photoStates(del: MDelivery): ExecutionState[] {
    if (del.purpose === 'MISDELIVERY_REDELIVERY') return ['ASSIGNED', 'PICKED_UP', 'ARRIVED_AT_CUSTOMER'];
    if (del.type === 'RETURN') return ['ASSIGNED', 'RETURN_PICKED_UP'];
    return ['PICKED_UP', 'ARRIVED_AT_CUSTOMER'];
  }

  // ───────────── 오배송 (MOCK 이 case-service·order-orchestration 대신) ─────────────

  private readonly addressBook = new Map<string, LatLng>();

  /**
   * MOCK 주소 → 좌표. 다시 배송 전달지에는 지도 핀이 없어(execution) 라이더는 주소로 찾아간다 — MOCK 라이더는 이것으로.
   * 실서버에는 이 길이 없다(주소 검색은 사용자 결정 — docs/design.md §3-1).
   */
  locateAddress(roadAddress: string): LatLng | null {
    const p = this.addressBook.get(roadAddress);
    return p ? { ...p } : null;
  }

  /** 전달 완료 뒤 조절 바 확률로 오배송 확인을 건다(일반·재발송만 — 다시 배송·회수는 아님) */
  private maybeMisdelivery(del: MDelivery) {
    const p = this.params;
    if (p.misdeliveryRate <= 0 || del.pickup) return;
    if (this.rng.next() >= p.misdeliveryRate) return;
    this.schedule(p.misdeliveryConfirmSec, () => this.confirmMisdelivery(del));
  }

  /** 전달 완료 뒤 조절 바 확률로 고객 반품 회수를 만든다(일반·재발송만) — 0 이면 난수를 쓰지 않는다 */
  private maybeClaimReturn(del: MDelivery) {
    const p = this.params;
    if (p.claimReturnRate <= 0 || del.pickup) return;
    if (this.rng.next() >= p.claimReturnRate) return;
    this.schedule(p.claimReturnAfterSec, () => this.createClaimReturn(del));
  }

  /**
   * claim·dispatch 대신: 고객 반품 회수 배송(type RETURN, purpose CLAIM_RETURN, claimId — dispatch 0.5.0·execution 0.10.0).
   * 회수지 = 고객 집, 도착지 = MFC. 배차는 일반 배송과 같은 표(MFC 중심 반경 — "바로 배차·일반 표").
   */
  private createClaimReturn(origin: MDelivery) {
    const now = this.clock.now;
    const deliveryId = this.ids.next('DL');
    const claimId = this.ids.next('CL');
    const del: MDelivery = {
      deliveryId,
      orderId: origin.orderId,
      shipmentId: `CLM-${claimId}`,
      mfcId: this.mfcId,
      customer: { ...origin.customer },
      createdAt: now,
      type: 'RETURN',
      purpose: 'CLAIM_RETURN',
      claimId,
      originDeliveryId: origin.deliveryId,
      d: { state: 'CREATED', version: 1, attempts: [], assignment: null, updatedAt: now },
      x: { exists: false, state: 'UNASSIGNED', version: 0, riderId: null, handoverIds: [], packageIds: [], history: [], photos: [], helps: [] },
    };
    this.deliveries.set(deliveryId, del);
    this.schedule(this.lag(), () => {
      if (!del.x.exists) {
        del.x.exists = true;
        this.xHistory(del, 'UNASSIGNED', 'SYSTEM_EVENT', 'DeliveryCreated');
      }
    });
    this.emit('DeliveryCreated', `${deliveryId} 고객 반품 회수(${claimId}, 원래 ${origin.deliveryId})`, { deliveryId });
    this.setDispatchState(del, 'DISPATCHING');
    this.startAttempt(del, 'AUTO', 0, new Set());
  }

  /** case-service 대신: 오배송 확인 → 귀책에 따라 회수 + 재발송, 또는 다시 배송 */
  private confirmMisdelivery(origin: MDelivery) {
    const caseId = this.ids.next('CS');
    const wrong = origin.x.completedAtPos ?? origin.customer;
    const source = origin.x.completedAtPos ? 'RIDER_COMPLETION_LOCATION' : 'DROP_ADDRESS';
    const originRider = origin.x.riderId ?? undefined;
    const customerFault = this.rng.next() < this.params.customerFaultShare;
    this.emit('MisdeliveryConfirmed', `${origin.deliveryId} 오배송 확인(${customerFault ? '고객 잘못 → 다시 배송' : '라이더·시스템 잘못 → 회수 + 재발송'}) 사건 ${caseId}`, {
      deliveryId: origin.deliveryId,
      riderId: originRider,
    });
    if (customerFault) {
      this.createRedelivery(origin, caseId, wrong, source);
    } else {
      this.createRecovery(origin, caseId, wrong, source, originRider);
      // MFC 재발송: 점원이 새로 피킹·포장 → 재발송 출고(DispatchRequested purpose MISDELIVERY_RESHIPMENT)
      this.createOrder({ orderId: origin.orderId, purpose: 'MISDELIVERY_RESHIPMENT', caseId, customer: origin.customer });
    }
  }

  private newPickupDelivery(
    origin: MDelivery,
    caseId: string,
    kind: 'RECOVERY' | 'REDELIVERY',
    wrong: LatLng,
    source: 'RIDER_COMPLETION_LOCATION' | 'DROP_ADDRESS',
    to: LatLng,
  ): MDelivery {
    const now = this.clock.now;
    const deliveryId = this.ids.next('DL');
    const del: MDelivery = {
      deliveryId,
      orderId: origin.orderId,
      shipmentId: `${kind === 'RECOVERY' ? 'RCV' : 'RDL'}-${caseId}`,
      mfcId: this.mfcId,
      customer: to,
      createdAt: now,
      type: kind === 'RECOVERY' ? 'RETURN' : 'RESHIPMENT',
      purpose: kind === 'RECOVERY' ? 'MISDELIVERY_RECOVERY' : 'MISDELIVERY_REDELIVERY',
      caseId,
      originDeliveryId: origin.deliveryId,
      pickup: { at: { ...wrong }, source },
      d: { state: 'CREATED', version: 1, attempts: [], assignment: null, updatedAt: now },
      x: { exists: false, state: 'UNASSIGNED', version: 0, riderId: null, handoverIds: [], packageIds: [], history: [], photos: [], helps: [] },
    };
    this.deliveries.set(deliveryId, del);
    this.schedule(this.lag(), () => {
      if (!del.x.exists) {
        del.x.exists = true;
        this.xHistory(del, 'UNASSIGNED', 'SYSTEM_EVENT', 'DeliveryCreated');
      }
    });
    return del;
  }

  /** 회수(DD-2): 잘못 둔 곳 → MFC, 원래 라이더 빼고 회수지 중심 반경으로 바로 배차 */
  private createRecovery(origin: MDelivery, caseId: string, wrong: LatLng, source: 'RIDER_COMPLETION_LOCATION' | 'DROP_ADDRESS', originRider?: string) {
    const del = this.newPickupDelivery(origin, caseId, 'RECOVERY', wrong, source, this.mfcLocation);
    this.emit('DeliveryCreated', `${del.deliveryId} 회수(${caseId}, 원래 ${origin.deliveryId})`, { deliveryId: del.deliveryId });
    this.setDispatchState(del, 'DISPATCHING');
    this.startAttempt(del, 'AUTO', 0, new Set(originRider ? [originRider] : []));
  }

  /**
   * 운영자 실패 확정을 MOCK 이 대신 — FAILED + DeliveryFailed, dispatch CLOSED.
   * 상품을 라이더가 들고 있으면(custody RIDER) 반납 배송(type RETURN, purpose FAILED_DELIVERY_RETURN)을 만들어
   * 같은 라이더에게 제안 없이 바로 배정한다(dispatch 0.6.0·execution 0.15.0 — 받음 단계 없이 ASSIGNED 에서 MFC 반납).
   * MOCK 은 늘 같은 라이더(SAME_RIDER) — 다른 라이더 반납(OTHER_RIDER)은 운영자가 고르는 일이라 흉내 내지 않는다.
   */
  private confirmFailure(del: MDelivery, riderId: string) {
    const f = del.x.failure;
    if (del.x.state !== 'FAILURE_REPORTED' || !f) return;
    f.decision = 'CONFIRM';
    f.decidedBy = 'mock-operator';
    f.decidedAt = this.clock.iso();
    f.custody = f.goodsLocation === 'RETURNED_TO_STORE' ? 'STORE' : 'RIDER';
    this.xHistory(del, 'FAILED', 'OPERATOR', 'mock-operator');
    this.emit('DeliveryFailed', `${del.deliveryId} 전달 실패 확정(MOCK 운영자)`, { deliveryId: del.deliveryId, riderId });
    this.setDispatchState(del, 'CLOSED');
    if (f.custody !== 'RIDER') return;
    const back = this.newReturnDelivery(del);
    f.returnDeliveryId = back.deliveryId;
    f.returnBy = 'SAME_RIDER';
    this.emit('DeliveryCreated', `${back.deliveryId} 실패 반납(원래 ${del.deliveryId}) — 같은 라이더에게 바로 배정`, { deliveryId: back.deliveryId });
    this.assign(back, riderId);
  }

  private newReturnDelivery(origin: MDelivery): MDelivery {
    const now = this.clock.now;
    const deliveryId = this.ids.next('DL');
    const del: MDelivery = {
      deliveryId,
      orderId: origin.orderId,
      shipmentId: `FRT-${origin.deliveryId}`,
      mfcId: this.mfcId,
      customer: { ...this.mfcLocation },
      createdAt: now,
      type: 'RETURN',
      purpose: 'FAILED_DELIVERY_RETURN',
      originDeliveryId: origin.deliveryId,
      d: { state: 'CREATED', version: 1, attempts: [], assignment: null, updatedAt: now },
      x: { exists: false, state: 'UNASSIGNED', version: 0, riderId: null, handoverIds: [], packageIds: [], history: [], photos: [], helps: [] },
    };
    this.deliveries.set(deliveryId, del);
    return del;
  }

  /** MFC 반납을 기다리는 배송인가 — 회수품 들고 오는 중, 또는 실패 반납 배정(받음 단계 없음) */
  private awaitingReturn(d: MDelivery): boolean {
    return d.x.state === 'RETURN_PICKED_UP' || (d.purpose === 'FAILED_DELIVERY_RETURN' && d.x.state === 'ASSIGNED');
  }

  /** 반납 인증번호 검사(execution 0.28.0) — 번호가 왔거나 설정이 필수면. 틀리면 남은 횟수, 5번이면 잠김 */
  private checkReturnCode(del: MDelivery, code: string | undefined) {
    if (code === undefined) {
      if (this.params.returnHandoverRequired) fail(422, 'RETURN_HANDOVER_CODE_REQUIRED', '반납 인증번호 필요');
      return;
    }
    const rc = del.returnCode;
    if (rc?.locked) fail(422, 'RETURN_HANDOVER_LOCKED', '5번 틀려 잠김 — MFC 직원이 새로 내야 함');
    if (!rc || rc.code !== code) {
      if (rc) {
        rc.failed++;
        if (rc.failed >= MAX_CODE_FAILURES) rc.locked = true;
      }
      const left = rc ? Math.max(0, MAX_CODE_FAILURES - rc.failed) : MAX_CODE_FAILURES;
      fail(422, 'RETURN_HANDOVER_CODE_MISMATCH', '반납 인증번호가 맞지 않음', [{ field: 'attemptsLeft', reason: String(left) }]);
    }
  }

  /** 다시 배송(ADR-0065): 잘못 둔 곳 → 실제 집. 200m 미만 원래 기사 먼저(0원), 이상 결제 대기 */
  private createRedelivery(origin: MDelivery, caseId: string, wrong: LatLng, source: 'RIDER_COMPLETION_LOCATION' | 'DROP_ADDRESS') {
    const [lo, hi] = this.params.redeliveryDistanceM;
    const home = destination(wrong, this.rng.range(0, 360), this.rng.range(lo, hi));
    const del = this.newPickupDelivery(origin, caseId, 'REDELIVERY', wrong, source, home);
    del.homeAddress = `(MOCK 실제 집 ${caseId})`;
    this.addressBook.set(del.homeAddress, home);
    const meters = Math.round(distanceM(wrong, home));
    this.emit('DeliveryCreated', `${del.deliveryId} 다시 배송(${caseId}, 잘못 둔 곳 ↔ 실제 집 ${meters}m)`, { deliveryId: del.deliveryId });
    if (meters < CONTRACT.redeliveryFreeRadiusM) {
      del.preferRiderId = origin.x.riderId ?? undefined;
      del.feeZero = true;
      this.setDispatchState(del, 'DISPATCHING');
      this.startAttempt(del, 'AUTO', 0, new Set());
      return;
    }
    // 결제 대기 — 배차하지 않는다(배달리스트에도 없음). order-orchestration·고객 앱 대신 redeliveryPaySec 뒤 결제 또는 거절
    del.paymentRequired = true;
    this.emit('RedeliveryPaymentRequired', `${del.deliveryId} 다시 배송비 9,000원 결제 대기(${meters}m)`, { deliveryId: del.deliveryId });
    this.schedule(this.params.redeliveryPaySec, () => {
      if (del.d.state !== 'CREATED') return;
      if (this.rng.next() < this.params.redeliveryPayProbability) {
        // redelivery-releases — 결제됨 → 배차 풀기
        del.paymentRequired = false;
        this.setDispatchState(del, 'DISPATCHING');
        this.startAttempt(del, 'AUTO', 0, new Set());
      } else {
        // redelivery-cancellations — 결제 안 함 → 픽업 전 취소 + MFC 회수(원래 라이더 제외)
        del.paymentRequired = false;
        this.setDispatchState(del, 'CANCELLED_BEFORE_PICKUP');
        this.schedule(this.lag(), () => this.xHistory(del, 'CANCELLED', 'SYSTEM_EVENT', 'DeliveryCancelledBeforePickup'));
        this.emit('DeliveryCancelledBeforePickup', `${del.deliveryId} 결제 안 함 → 다시 배송 취소, 회수 후 환불`, { deliveryId: del.deliveryId });
        this.createRecovery(origin, caseId, wrong, source, origin.x.riderId ?? undefined);
      }
    });
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
    if (now - this.lastStaleCheckAt >= CONTRACT.locationStaleCheckSec) {
      this.lastStaleCheckAt = now;
      this.checkStale();
    }
  }

  private lastStaleCheckAt = -Infinity;

  /**
   * 위치 끊김(MOCK 이 tracking 대신 — services/delivery-tracking-service/CLAUDE.md RiderWatch.checkStale):
   * 진행 중 배송(배정~픽업)이 있고 기준 = 마지막 수신·배정 시각 중 늦은 것이 3분 지났으면 RiderLocationStale.
   * 끊김 한 번에 한 번만, 알림만 하고 배송 상태는 바꾸지 않는다(계약 — 위치는 배송 상태를 바꾸지 않음).
   */
  private checkStale() {
    const now = this.clock.now;
    for (const del of this.deliveries.values()) {
      const a = del.d.assignment;
      if (!a || (del.d.state !== 'ASSIGNED' && del.d.state !== 'PICKED_UP')) continue;
      const r = this.riders.get(a.riderId);
      if (!r) continue;
      const base = Math.max(r.lastReceivedAt ?? -Infinity, a.assignedAt);
      if (now - base < CONTRACT.locationStaleSec || r.staleAlertedFor === base) continue;
      r.staleAlertedFor = base;
      this.emit('RiderLocationStale', `${a.riderId} 위치 ${Math.floor(now - base)}초 끊김 (${del.deliveryId})`, { deliveryId: del.deliveryId, riderId: a.riderId });
    }
  }

  private generateOrders() {
    const h = this.clock.seoulHour();
    const { startHour, endHour } = CONTRACT.dispatchHours;
    if (h < startHour || h >= endHour) return;
    if (this.params.ordersPerHour <= 0) return; // 조절 바 0 = 주문 없음
    while (this.clock.now >= this.nextOrderAt) {
      this.createOrder();
      this.nextOrderAt += this.rng.exp(3600 / this.params.ordersPerHour);
    }
  }

  /** 주문량이 바뀌었을 때(조절 바) 다음 주문 시각을 새 주문량으로 다시 뽑는다 */
  resetOrderClock(): void {
    this.nextOrderAt = this.clock.now + (this.params.ordersPerHour > 0 ? this.rng.exp(3600 / this.params.ordersPerHour) : 0);
  }

  /** 주문 하나 → (pickSec 뒤) 점원 배차 요청 → (packMinutes 뒤) 출하 대기. 시험에서도 부른다. */
  createOrder(opts: MockOrderOptions = {}): { orderId: string; shipmentId: string } {
    const p = this.params;
    const orderId = opts.orderId ?? this.ids.next('OR');
    if (!this.orderSummaries.has(orderId)) this.orderSummaries.set(orderId, this.makeOrderSummary());
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
        handoverCode: this.newHandoverCode(packages),
        fence: { state: 'NONE', authId: null, fenceVersion: 0, riderId: null, deliveryId: null, expiresAt: null, authorizedAt: null },
        handoverId: null,
        handedOverAt: null,
        sealedAt: null,
      });
    }
    const packMinutes = opts.packMinutes ?? this.rng.range(p.packMinutes[0], p.packMinutes[1]) * p.packTimeScale;
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
      purpose: opts.purpose ?? 'DELIVERY',
      caseId: opts.caseId,
    };
    this.shipments.set(shipmentId, ship);
    const customer =
      opts.customer ?? destination(this.mfcLocation, this.rng.range(0, 360), this.rng.range(p.customerDistanceM[0], p.customerDistanceM[1]));
    const pickSec = opts.pickSec ?? this.rng.range(p.pickSec[0], p.pickSec[1]);
    this.schedule(pickSec, () => this.dispatchRequest(ship, customer, packMinutes));
    return { orderId, shipmentId };
  }

  private makeOrderSummary(): MOrderSummary {
    const p = this.params;
    const r = this.orderRng;
    const lines = r.int(p.orderLines[0], p.orderLines[1]);
    const names = [...MOCK_ITEM_NAMES];
    const items: MOrderSummary['items'] = [];
    for (let i = 0; i < lines && names.length > 0; i++) {
      const name = names.splice(r.int(0, names.length - 1), 1)[0] as string;
      const qty = r.int(p.lineQty[0], p.lineQty[1]);
      const unit = Math.round(r.range(p.unitPriceWon[0], p.unitPriceWon[1]) / 100) * 100;
      items.push({ name, optionLabel: null, qty, lineAmount: unit * qty });
    }
    return {
      orderNumber: String(r.int(10_000_000, 99_999_999)),
      items,
      itemAmount: items.reduce((s, it) => s + it.lineAmount, 0),
      confirmedAt: this.clock.now,
      hasNote: r.next() < MOCK_ORDER.noteRate,
    };
  }

  /**
   * MOCK 직원용 주문 상세(order 0.13.1 GET /orders/lookups/{id} 흉내) — 가린 배송지·요청사항, 가짜 금액. 없는 주문은 null.
   * 상태는 이 주문 배송들의 수행 상태로 짐작한다(실서버는 order 원장).
   */
  staffOrder(orderId: string): StaffOrderDetail | null {
    const s = this.orderSummaries.get(orderId);
    if (!s) return null;
    const dels = [...this.deliveries.values()].filter((d) => d.orderId === orderId && d.purpose !== 'MISDELIVERY_RECOVERY');
    const xs = dels.map((d) => d.x.state);
    const status: OrderStatus = xs.includes('COMPLETED')
      ? 'COMPLETED'
      : xs.some((x) => x === 'PICKED_UP' || x === 'ARRIVED_AT_CUSTOMER' || x === 'FAILURE_REPORTED')
        ? 'IN_DELIVERY'
        : 'PREPARING';
    const tip = s.itemAmount >= MOCK_ORDER.freeTipOverWon ? 0 : MOCK_ORDER.deliveryTipWon;
    return {
      orderNumber: s.orderNumber,
      orderId,
      customerId: 'AC-mock',
      status,
      version: 1,
      mfcId: this.mfcId,
      deliveryMode: 'SINGLE',
      arrivalWindow: null,
      confirmedAt: this.clock.iso(s.confirmedAt),
      outOfStockPreference: 'CANCEL_OOS_ONLY',
      deliveryNote: null,
      deliveryNoteMasked: s.hasNote,
      amounts: {
        itemAmount: s.itemAmount,
        deliveryTipBase: MOCK_ORDER.deliveryTipWon,
        deliveryTip: tip,
        deliveryTipReason: tip ? 'STANDARD' : 'OVER_30000',
        bagFee: 0,
        totalAmount: s.itemAmount + tip,
        approvedAmount: s.itemAmount + tip,
        firstPurchaseApplied: false,
      },
      payment: { paymentAttemptId: `PA-mock-${orderId}` },
      shippingAddress: { ...MOCK_ADDRESS_MASKED },
      shippingAddressMasked: true,
      lines: s.items.map((it, i) => ({
        orderLineId: `${orderId}-L${i + 1}`,
        sku: `SKU-MOCK-${i + 1}`,
        productName: it.name,
        optionLabel: it.optionLabel,
        lineAmount: it.lineAmount,
        unitPrice: Math.round(it.lineAmount / it.qty),
        discountShare: 0,
        originalQty: it.qty,
        unfulfilledQty: 0,
        cancelledBeforeShipQty: 0,
        deliveredQty: status === 'COMPLETED' ? it.qty : 0,
      })),
      fulfillmentIssues: [],
    };
  }

  /** MOCK 원문 열람(pii-reveals 흉내) — 요청한 항목만 가짜 원문, 열람 기록 ID 도 가짜 */
  staffOrderReveal(orderId: string, fields: readonly StaffPiiField[]): StaffPiiReveal {
    const s = this.orderSummaries.get(orderId);
    if (!s) throw new ApiProblem(404, { code: 'ORDER_NOT_FOUND', title: '없는 주문' });
    const del = [...this.deliveries.values()].find((d) => d.orderId === orderId);
    const has = (f: StaffPiiField) => fields.includes(f);
    return {
      orderId,
      piiAccessLogId: this.ids.next('PAL'),
      recordedAt: this.clock.iso(),
      fields: [...fields],
      shippingAddress: {
        ...MOCK_ADDRESS_MASKED,
        receiverName: has('NAME') ? '김가상(MOCK)' : MOCK_ADDRESS_MASKED.receiverName,
        receiverPhone: has('PHONE') ? '010-0000-0000(MOCK)' : MOCK_ADDRESS_MASKED.receiverPhone,
        detailAddress: has('ADDRESS') ? '101동 1001호(MOCK)' : MOCK_ADDRESS_MASKED.detailAddress,
        geo: has('ADDRESS') && del ? { ...del.customer } : null,
        entranceNote: has('ENTRANCE') ? '공동현관 #0000(MOCK)' : null,
      },
      deliveryNote: has('ENTRANCE') && s.hasNote ? '문 앞에 두고 벨 눌러 주세요(MOCK)' : null,
    };
  }

  /** 직선 거리(m) → 예상 소요(초) [시뮬] — 실서버는 도로(카카오모빌리티) */
  private etaSec(m: number): number {
    return Math.round((m / 1000) * this.params.etaSecPerStraightKm);
  }

  /** 점원 배차 요청(패킹 시작) — DispatchRequested → 배송 생성·배차 시작 */
  private dispatchRequest(ship: MShipment, customer: LatLng, packMinutes: number) {
    const now = this.clock.now;
    ship.dispatchRequestedAt = now;
    ship.version++;
    const deliveryId = this.ids.next('DL');
    const reship = ship.purpose === 'MISDELIVERY_RESHIPMENT';
    this.emit('DispatchRequested', `${ship.shipmentId} ${reship ? '재발송 ' : ''}배차 요청(예상 포장 ${Math.round(packMinutes)}분)`, { deliveryId });
    ship.deliveryId = deliveryId;
    const del: MDelivery = {
      deliveryId,
      orderId: ship.orderId,
      shipmentId: ship.shipmentId,
      mfcId: this.mfcId,
      customer,
      createdAt: now,
      type: reship ? 'RESHIPMENT' : 'FORWARD',
      purpose: ship.purpose,
      caseId: ship.caseId,
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
    this.emit('DeliveryCreated', `${deliveryId} (출고 ${ship.shipmentId}${reship ? ` · 재발송 ${ship.caseId}` : ''})`, { deliveryId });
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
    this.emit('PackingFinished', `${ship.shipmentId} 포장 ${ship.packages.length}개`, { deliveryId: ship.deliveryId ?? undefined });
    ship.state = 'READY';
    ship.readyAt = now;
    ship.version++;
    this.emit('ShipmentReady', `${ship.shipmentId} 출하 대기`, { deliveryId: ship.deliveryId ?? undefined });
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
        this.emit('DispatchFailed', `${del.deliveryId} 라이더 없음(재시도 ${at.retryCount}회)`, { deliveryId: del.deliveryId });
      }
      return;
    }
    const steps = CONTRACT.radiusStepsKm;
    const idx = Math.min(Math.floor((now - at.startedAt) / this.params.radiusStepSec), steps.length - 1);
    at.radiusKm = steps[idx] as number;
    // 다시 배송 200m 미만: 원래 기사에게 먼저(반경 무관) — 그 제안이 거절·만료되면 근처 다른 라이더(dispatch 0.4.2)
    if (del.preferRiderId) {
      const first = [...this.offers.values()].find((o) => o.deliveryId === del.deliveryId && o.riderId === del.preferRiderId);
      if (first && first.state !== 'SENT') {
        del.preferRiderId = undefined;
        del.feeZero = false;
      }
    }
    // 반경 중심 = 픽업지(회수·다시 배송은 잘못 둔 곳, 그 밖은 MFC)
    const center = del.pickup?.at ?? this.mfcLocation;
    for (const r of this.riders.values()) {
      if (at.excluded.has(r.riderId)) continue;
      if (del.preferRiderId && r.riderId !== del.preferRiderId) continue;
      if (!this.offerEligible(r)) continue;
      if (r.settings.dispatchMode !== 'AI_RECOMMENDED') continue;
      if (!r.location) continue;
      if (!del.preferRiderId && distanceM(r.location, center) > at.radiusKm * 1000) continue;
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
      this.involve(del.deliveryId, r.riderId);
      at.state = 'OFFERING';
      this.emit('DispatchOfferSent', `${del.deliveryId} → ${r.riderId} (반경 ${at.radiusKm}km)`, { deliveryId: del.deliveryId, riderId: r.riderId });
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

  /** 사건 기록. ids 는 화면에서 라이더·배송별로 거르는 데 쓴다(계약 사건 본문이 아니다). */
  private emit(type: DomainEventType, summary: string, ids: { riderId?: string; deliveryId?: string } = {}) {
    const rec: DomainEventRecord = { at: this.clock.now, type, summary, ...ids };
    for (const l of this.eventListeners) l(rec);
  }

  /** 이 배송에 관여한 라이더(제안을 받았거나 배정된) — 화면에서 라이더별로 배송을 거를 때. 매 프레임 불리므로 모아 둔 값 */
  ridersOf(deliveryId: string): string[] {
    return [...(this.involved.get(deliveryId) ?? [])];
  }

  private involve(deliveryId: string, riderId: string) {
    let s = this.involved.get(deliveryId);
    if (!s) {
      s = new Set();
      this.involved.set(deliveryId, s);
    }
    s.add(riderId);
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
      // 응답 끊김 흉내(조절 바 networkDropRate): 절반은 처리 전에 끊김(아무 일도 안 일어남),
      // 절반은 처리한 뒤 응답만 사라짐(서버에는 반영됨) — 어느 쪽이든 호출자는 같은 키로 다시 보내야 하고, 두 번째는 같은 결과를 받는다.
      const drop = this.params.networkDropRate > 0 && this.rng.next() < this.params.networkDropRate;
      const dropBefore = drop && this.rng.next() < 0.5;
      if (dropBefore) {
        this.log(actor, method, path, 'ERR', 'NETWORK_DROP_BEFORE');
        throw new ResultUnknown(`응답 없음(처리 전 끊김): ${method} ${path}`);
      }
      try {
        const v = fn();
        this.idem.set(k, { fp, outcome: { ok: v } });
        if (drop) {
          this.log(actor, method, path, 'ERR', 'NETWORK_DROP_AFTER');
          throw new ResultUnknown(`응답 없음(처리 뒤 끊김): ${method} ${path}`);
        }
        this.log(actor, method, path, okStatus);
        return v;
      } catch (e) {
        if (e instanceof ResultUnknown) throw e;
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

  /** 탈퇴를 막는 것(rider 0.6.0 WithdrawalBlocker 5종). RESTRICTION_REVIEW(라이더가 낸 제한 검토가 결정 전)는 MOCK 에 제한 검토가 없어 생기지 않는다 [시뮬]. */
  withdrawalBlockers(riderId: string): WithdrawalBlocker[] {
    const out = new Set<WithdrawalBlocker>();
    if (this.activeDeliveryCount(riderId) > 0) out.add('ACTIVE_DELIVERY');
    const confirmAfterSec = 5 * 3600; // 완료 5시간 뒤 수행료 확정(execution). 시계는 초
    for (const d of this.deliveries.values()) {
      if (d.x.riderId !== riderId) continue;
      if (d.x.state === 'COMPLETED' && d.x.completedAt !== undefined && this.clock.now - d.x.completedAt < confirmAfterSec) out.add('UNCONFIRMED_EARNING');
      // MOCK 에는 지원센터(처리함)가 없다 — 배송이 끝나면 그 도움요청도 닫힌 것으로 본다 [시뮬]
      if (d.x.helps.length > 0 && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(d.x.state)) out.add('OPEN_HELP_REQUEST');
      // 산정 불가 수행료가 지원센터 조정 대기(execution 0.13.0): 고객 사유가 아닌 전달 실패. MOCK 에는 지원센터 조정이 없어 계속 대기 [시뮬].
      // (자동 완료(픽업 5시간)도 산정 불가지만 MOCK 은 자동 완료를 만들지 않는다)
      if (d.x.state === 'FAILED' && d.x.failure && !CUSTOMER_REASONS.has(d.x.failure.reason)) out.add('EARNING_ADJUSTMENT_PENDING');
    }
    return [...out];
  }

  activeDeliveryCount(riderId: string): number {
    let n = 0;
    for (const d of this.deliveries.values()) {
      if (d.d.assignment?.riderId === riderId && (d.d.state === 'ASSIGNED' || d.d.state === 'PICKED_UP')) n++;
    }
    return n;
  }

  /** 제안을 받을 수 있는 상태인가 — 아니면 GET /offers pollAfterSec 30(dispatch 0.12.2) */
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
    this.involve(del.deliveryId, riderId);
    this.setDispatchState(del, 'ASSIGNED');
    for (const o of this.offers.values()) {
      if (o.deliveryId === del.deliveryId && o.state === 'SENT' && o.riderId !== riderId) o.state = 'SUPERSEDED';
    }
    this.emit('DeliveryAssigned', `${del.deliveryId} → ${riderId}`, { deliveryId: del.deliveryId, riderId });
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
      if (del.pickup) continue; // 회수·다시 배송은 배달리스트에 안 나온다(dispatch DD-2·0.4.2)
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

  /** 라이더·배송별 숫자 틀린 횟수(fulfillment 0.23.0 — 5번이면 잠김). */
  private readonly codeFailures = new Map<string, number>();

  /**
   * 라벨 숫자로 인계 허가(fulfillment 0.13.0 F-8, 0.23.0 R-26 흉내): 그 배송 출고에서 숫자가 같은 밀봉 포장을 찾아 QR 과 같은 허가로.
   * 이 센터 출고의 배송이 아니면 409 DELIVERY_MISMATCH, 같은 숫자 밀봉 포장이 없으면 409 HANDOVER_CODE_MISMATCH(details attemptsLeft),
   * 같은 라이더·배송이 5번 틀리면 409 HANDOVER_CODE_LOCKED(맞는 번호도 거절).
   */
  private authorizeByCode(riderId: string, body: HandoverCodeAuthorizationRequest): HandoverAuthorization {
    if (body.riderId !== riderId) fail(403, 'FORBIDDEN', '토큰 주체와 riderId 가 다름');
    if (!/^([0-9]{4}|[0-9]{6})$/.test(body.handoverCode)) fail(400, 'VALIDATION_FAILED', undefined, [{ field: 'handoverCode', reason: 'pattern' }]);
    const key = `${riderId}|${body.deliveryId}`;
    const failures = this.codeFailures.get(key) ?? 0;
    if (failures >= MAX_CODE_FAILURES) fail(409, 'HANDOVER_CODE_LOCKED');
    const ship = [...this.shipments.values()].find((s) => s.deliveryId === body.deliveryId);
    if (!ship) fail(409, 'DELIVERY_MISMATCH');
    const pk = ship.packages.find((p) => p.state === 'SEALED' && p.handoverCode === body.handoverCode);
    if (!pk) {
      const next = failures + 1;
      this.codeFailures.set(key, next);
      fail(409, 'HANDOVER_CODE_MISMATCH', undefined, [{ field: 'attemptsLeft', reason: String(MAX_CODE_FAILURES - next) }]);
    }
    return this.authorize(riderId, pk.packageId, { riderId, deliveryId: body.deliveryId, scannedCode: pk.qrCode });
  }

  /**
   * 센터 안 지금 쓰는(OPEN·SEALED) 포장과 겹치지 않는 4자리(앞자리 0 포함 — 0.23.0).
   * pending = 아직 출고에 넣기 전, 같은 주문에서 방금 만든 포장들(같은 출고 안에서도 겹치지 않게).
   */
  private newHandoverCode(pending: readonly MPackage[] = []): string {
    const used = new Set<string>(pending.map((p) => p.handoverCode));
    for (const s of this.shipments.values()) for (const p of s.packages) if (p.state === 'OPEN' || p.state === 'SEALED') used.add(p.handoverCode);
    for (;;) {
      const c = String(this.rng.int(0, 9999)).padStart(4, '0');
      if (!used.has(c)) return c;
    }
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
    this.emit('PackageHandedOver', `${pk.packageId} → ${riderId}`, { deliveryId: f.deliveryId ?? undefined, riderId });
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
        this.emit('PickupCompleted', `${del.deliveryId} 픽업 완료`, { deliveryId: del.deliveryId, riderId: del.x.riderId ?? undefined });
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
    // 픽업지: MFC 는 정확, 회수·다시 배송(잘못 둔 곳 — 고객이 있는 곳)은 약 1km 격자 반올림(dispatch 0.4.5)
    const from = del?.pickup?.at ?? this.mfcLocation;
    const fromMfc = !del?.pickup;
    const toPickupM = r?.location ? distanceM(r.location, from) : undefined;
    const dropM = del ? distanceM(from, del.customer) : undefined;
    const sum = del && del.purpose !== 'MISDELIVERY_RECOVERY' ? this.orderSummaries.get(del.orderId) : undefined;
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
      deliveryType: del?.type ?? 'FORWARD',
      purpose: del?.purpose ?? 'DELIVERY',
      summary: {
        mfcId: this.mfcId,
        dropAreaLabel: del?.purpose === 'MISDELIVERY_RECOVERY' ? '(MFC 반납)' : '(MOCK 동)',
        // 픽업지(회수·다시 배송은 잘못 둔 곳) → 도착지. 도로 거리 대신 직선 [시뮬] — MOCK 에는 길찾기가 없다
        distanceKm: dropM !== undefined ? round2(dropM / 1000) : undefined,
        pickupDistanceKm: toPickupM !== undefined ? round2(toPickupM / 1000) : undefined,
        pickupEtaSeconds: toPickupM !== undefined ? this.etaSec(toPickupM) : undefined,
        dropEtaSeconds: dropM !== undefined ? this.etaSec(dropM) : undefined,
        pickupPoint: fromMfc ? { lat: from.lat, lng: from.lng } : roundPoint(from),
        dropAreaPoint: del ? roundPoint(del.customer) : undefined,
        order: sum
          ? {
              orderId: del?.orderId,
              orderNumber: sum.orderNumber,
              mfcName: `(MOCK) ${this.mfcId}`,
              mfcAddress: null,
              items: sum.items.map((it) => ({ ...it })),
              itemAmount: sum.itemAmount,
              deliveryNote: null,
            }
          : undefined,
        estimatedFee: del?.feeZero ? 0 : undefined,
        bagCount: ship?.packages.length,
        containsAlcohol: false,
        deliveryMode: 'SINGLE',
      },
    };
  }

  /** showPickup: 회수지 좌표는 배정 라이더·직원만(제안만 받은 라이더에게는 비움 — dispatch DispatchViews.recovery) */
  /**
   * 화면용 번호(직원 배송 목록 orderNumber·deliveryNumber 흉내 — execution 0.26.0·0.36.0, ADR-0085):
   * 주문번호 8자리, 배송 번호 = D + 주문번호, 같은 주문의 두 번째 배송부터 -순번(생성 순) — D74939255·D74939255-2.
   */
  displayNumbers(del: MDelivery): { orderNumber: string | null; deliveryNumber: string | null } {
    const orderNumber = this.orderSummaries.get(del.orderId)?.orderNumber ?? null;
    if (!orderNumber) return { orderNumber: null, deliveryNumber: null };
    const same = [...this.deliveries.values()].filter((x) => x.orderId === del.orderId).sort((a, b) => a.createdAt - b.createdAt);
    const seq = same.indexOf(del) + 1;
    return { orderNumber, deliveryNumber: seq > 1 ? `D${orderNumber}-${seq}` : `D${orderNumber}` };
  }

  /** 화면 흐름·시간용(직원 관점) — 배차 관점 + 시도별 제안 시각 + 수행 기록. 없는 배송이면 null */
  timelineSource(deliveryId: string): { dispatch: Delivery; history: StatusHistoryEntry[] } | null {
    const del = this.deliveries.get(deliveryId);
    if (!del) return null;
    const dispatch = this.dispatchView(del, false);
    const offers = [...this.offers.values()].filter((o) => o.deliveryId === deliveryId);
    for (const at of dispatch.attempts ?? []) {
      at.offers = offers
        .filter((o) => o.attemptId === at.attemptId)
        .map((o) => ({ offerId: o.offerId, riderId: o.riderId, state: o.state, sentAt: this.clock.iso(o.sentAt) }));
    }
    return { dispatch, history: del.x.history };
  }

  private dispatchView(del: MDelivery, showPickup = true): Delivery {
    const a = del.d.assignment;
    return {
      deliveryId: del.deliveryId,
      version: del.d.version,
      type: del.type,
      orderId: del.orderId,
      shipmentId: del.shipmentId,
      mfcId: del.mfcId,
      state: del.d.state,
      purpose: del.purpose,
      caseId: del.purpose === 'MISDELIVERY_RESHIPMENT' ? del.caseId : undefined,
      claimId: del.claimId,
      recovery: del.pickup
        ? {
            caseId: del.caseId,
            originDeliveryId: del.originDeliveryId,
            pickup: showPickup ? { lat: del.pickup.at.lat, lng: del.pickup.at.lng, source: del.pickup.source } : undefined,
          }
        : undefined,
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
    const origin = del.originDeliveryId ? this.deliveries.get(del.originDeliveryId) : undefined;
    const sum = this.orderSummaries.get(del.orderId);
    return {
      orderSummary: sum
        ? { orderNumber: sum.orderNumber, items: sum.items.map((it) => ({ ...it })), itemAmount: sum.itemAmount, deliveryNote: null }
        : undefined,
      deliveryId: del.deliveryId,
      version: x.version,
      type: del.type,
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
      purpose: del.purpose,
      caseId: del.caseId,
      originDeliveryId: del.originDeliveryId,
      claimId: del.claimId ?? null,
      returnPickupRequired: del.type === 'RETURN' ? del.purpose !== 'FAILED_DELIVERY_RETURN' : null,
      // 원래 배송의 완료 증빙(놓은 곳·사진 참조) — 회수·다시 배송 라이더가 찾아갈 때
      recoveryOrigin:
        del.pickup && origin?.x.evidence
          ? {
              placement: origin.x.evidence.placement,
              photoRefs: [...origin.x.evidence.photoRefs],
              takenAt: origin.x.evidence.takenAt,
              completedAt: origin.x.completedAt !== undefined ? this.clock.iso(origin.x.completedAt) : undefined,
            }
          : undefined,
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
        handoverCode: pk.handoverCode,
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
            if (r.withdrawn) fail(409, 'RIDER_WITHDRAWN'); // 탈퇴한 ID 는 다시 가입 못 함(rider 0.6.0 — 백엔드 회신 RR-07)
            if (r.signedUp) fail(409, 'DUPLICATE_RIDER');
            if (!/^01[0-9]{8,9}$/.test(body.phone) || !body.deliveryAreas?.length) fail(400, 'VALIDATION_FAILED');
            // 탈퇴하면 전화번호를 지운다 — 같은 전화로 새 ID 가입은 된다(백엔드 회신 RR-07)
            for (const other of b.riders.values()) if (other.signedUp && other.phone === body.phone) fail(409, 'DUPLICATE_RIDER');
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
            b.emit('RiderStateChanged', `${me} ${body.status}${enable ? '·신규배차 ON' : ''}`, { riderId: me });
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
            // rider 0.6.0 막는 것(WithdrawalBlocker 5종) — withdrawalBlockers 참고. 이미 걸린 계정 제한은 막지 않는다(계약).
            const requestId = o.idempotencyKey;
            const blockers = b.withdrawalBlockers(me);
            if (blockers.length > 0) {
              b.withdrawals.set(requestId, { riderId: me, state: 'REJECTED', blockers });
              fail(409, 'INVALID_STATE', '탈퇴를 막는 것이 있음', blockers.map((reason) => ({ field: 'blockers', reason })));
            }
            b.withdrawals.set(requestId, { riderId: me, state: 'COMPLETED', blockers: [] });
            r.signedUp = false;
            r.withdrawn = true;
            r.operating = { ...r.operating, status: 'OFF_DUTY', newDispatchEnabled: false, version: r.operating.version + 1 };
            b.emit('RiderStateChanged', `${me} 탈퇴`, { riderId: me });
            r.phone = '';
            return b.cmd(requestId, { status: 'APPLIED', resultId: requestId, nextAction: 'LOGOUT' });
          },
          { key: o.idempotencyKey, body: body ?? {} },
          202,
        ),
      getWithdrawal: (requestId: string) =>
        b.call(me, 'GET', `/riders/me/withdrawals/${requestId}`, (): Withdrawal => {
          const w = b.withdrawals.get(requestId);
          if (!w || w.riderId !== me) fail(404, 'NOT_FOUND');
          return { requestId, state: w.state, blockers: [...w.blockers] };
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
            r.lastReceivedAt = now();
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
            pollAfterSec: b.offerEligible(r) ? CONTRACT.offersPollDefaultSec : CONTRACT.offersPollIneligibleSec,
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
          return b.dispatchView(del, mine);
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
              b.emit('DeliveryAssignmentChanged', `${deliveryId} ${me} 배차 취소 → 재배차`, { deliveryId, riderId: me });
            } else {
              b.setDispatchState(del, 'CANCELLED_BEFORE_PICKUP');
              b.emit('DeliveryCancelledBeforePickup', `${deliveryId} 픽업 전 취소`, { deliveryId, riderId: me });
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
            b.mfcPickupOnly(b.myExec(me, deliveryId));
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
            b.mfcPickupOnly(del);
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
          // 고객 반품 회수는 회수지 = 고객 집 — 배정·실패 등록 동안 연다(execution 0.10.0). 그 밖 회수는 원래 고객 정보를 열지 않는다
          const claim = del.purpose === 'CLAIM_RETURN';
          if (del.type === 'RETURN' && !claim) fail(409, 'NO_CUSTOMER_DROP');
          const open: ExecutionState[] = claim ? ['ASSIGNED', 'FAILURE_REPORTED'] : ['PICKED_UP', 'ARRIVED_AT_CUSTOMER', 'FAILURE_REPORTED'];
          if (!open.includes(del.x.state)) fail(409, 'DROP_INFO_CLOSED');
          if (del.purpose === 'MISDELIVERY_REDELIVERY') {
            // 다시 배송: 주소 = 상담원이 기록한 실제 집, 지도 핀 없음(execution DropInfoService — 6df1e842)
            return {
              deliveryId,
              roadAddress: del.homeAddress ?? '(MOCK 실제 집)',
              detailAddress: '(MOCK)',
              postalCode: null,
              receiverName: '(MOCK 고객)',
              receiverPhone: '01000000000',
              entranceMethod: 'FREE',
              entranceNote: null,
              deliveryNote: null,
              lat: null,
              lng: null,
            };
          }
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
            b.forwardOnly(b.myExec(me, deliveryId));
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
            if (!b.photoStates(del).includes(del.x.state)) fail(409, 'INVALID_STATE', '이 단계에서는 사진을 올릴 수 없음');
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
            b.forwardOnly(del);
            b.checkVersion(del.x.version, o.expectedVersion);
            if (del.x.state !== 'ARRIVED_AT_CUSTOMER') fail(409, 'INVALID_STATE');
            const refs = body.evidence?.photoRefs ?? [];
            if (!refs.length || refs.some((r) => b.photos.get(r)?.deliveryId !== deliveryId || b.photos.get(r)?.riderId !== me)) {
              fail(422, 'EVIDENCE_REQUIRED');
            }
            del.x.evidence = { method: body.method, photoRefs: [...refs], takenAt: body.evidence.takenAt, placement: body.evidence.placement };
            del.x.completedAt = now();
            const loc = b.riders.get(me)?.location;
            del.x.completedAtPos = loc ? { lat: loc.lat, lng: loc.lng } : undefined;
            b.xHistory(del, 'COMPLETED', 'RIDER');
            b.maybeMisdelivery(del);
            b.maybeClaimReturn(del);
            b.emit('DeliveryCompleted', `${deliveryId} 전달 완료(${body.method})`, { deliveryId, riderId: me });
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
            b.forwardOnly(del);
            b.checkVersion(del.x.version, o.expectedVersion);
            if (del.x.state !== 'PICKED_UP' && del.x.state !== 'ARRIVED_AT_CUSTOMER') fail(409, 'INVALID_STATE');
            const refs = body.evidenceRefs ?? [];
            if (!refs.length || refs.some((r) => b.photos.get(r)?.deliveryId !== deliveryId || b.photos.get(r)?.riderId !== me)) {
              fail(422, 'EVIDENCE_REQUIRED');
            }
            if (CUSTOMER_REASONS.has(body.reason) && (body.contactAttempts?.length ?? 0) < 2) fail(422, 'CONTACT_ATTEMPTS_REQUIRED');
            // 실패 등록 = 같은 ID 의 DELIVERY_FAILURE 도움요청(대화)도 열림 — 앱은 도움요청을 따로 보내지 않는다(execution 0.14.0)
            const helpRequestId = o.idempotencyKey;
            del.x.helps.push({ requestId: helpRequestId, category: 'DELIVERY_FAILURE', stage: del.x.state, detail: body.detail ?? null, evidenceRefs: [...refs], createdAt: now() });
            del.x.failure = {
              reason: body.reason,
              goodsLocation: body.goodsLocation,
              photoRefs: [...refs],
              contactAttempts: body.contactAttempts?.length ?? 0,
              reportedAt: b.clock.iso(),
              helpRequestId,
            };
            b.xHistory(del, 'FAILURE_REPORTED', 'RIDER'); // 실패 등록 자체는 사건 없음(계약 0.3.0 — 확정 때 DeliveryFailed)
            // 운영자 확정을 MOCK 이 대신(failureConfirmSec 뒤) — FAILED + DeliveryFailed, dispatch CLOSED(라이더 진행 중 수에서 빠짐)
            b.schedule(b.params.failureConfirmSec, () => b.confirmFailure(del, me));
            return b.cmd(o.idempotencyKey, { version: del.x.version, resultId: helpRequestId });
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
            // 실패 대화는 실패 등록으로만 열린다(execution 0.14.0)
            if (body.category === 'DELIVERY_FAILURE') fail(400, 'VALIDATION_FAILED', 'DELIVERY_FAILURE 는 실패 등록(/failures)으로만');
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
            b.emit('DeliveryIncidentRaised', `${deliveryId} 도움요청 ${body.category}`, { deliveryId, riderId: me });
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
      // 회수(RETURN)·다시 배송(MISDELIVERY_REDELIVERY)만 — 잘못 둔 곳에서 사진 → 받음. 회수는 RETURN_PICKED_UP, 다시 배송은 PICKED_UP
      reportReturnPickup: (deliveryId: string, body, o: WriteOptions) =>
        b.call(
          me,
          'POST',
          `/deliveries/${deliveryId}/returns/pickups`,
          () => {
            const del = b.myExec(me, deliveryId);
            const redelivery = del.purpose === 'MISDELIVERY_REDELIVERY';
            if (!redelivery && del.type !== 'RETURN') fail(409, 'INVALID_STATE', '회수 배송이 아님');
            if (del.purpose === 'FAILED_DELIVERY_RETURN') fail(409, 'INVALID_STATE', '실패 반납 — 받음 단계 없음(바로 store-deliveries)');
            b.checkVersion(del.x.version, o.expectedVersion);
            if (del.x.state !== 'ASSIGNED') fail(409, 'INVALID_STATE', `배정된 회수·다시 배송만 받을 수 있음(지금 ${del.x.state})`);
            const refs = body.evidenceRefs ?? [];
            if (!refs.length || refs.some((r) => b.photos.get(r)?.deliveryId !== deliveryId || b.photos.get(r)?.riderId !== me)) {
              fail(422, 'EVIDENCE_REQUIRED');
            }
            b.xHistory(del, redelivery ? 'PICKED_UP' : 'RETURN_PICKED_UP', 'RIDER');
            b.emit('ReturnPickedUp', `${deliveryId} ${redelivery ? '잘못 둔 곳에서 받음 → 실제 집으로' : '회수품 받음 → MFC 로'}`, { deliveryId, riderId: me });
            b.schedule(b.lag(), () => {
              if (del.d.assignment) {
                del.d.assignment.state = 'PICKED_UP';
                del.d.assignment.pickedUpAt = b.clock.now;
              }
              if (del.d.state === 'ASSIGNED') b.setDispatchState(del, 'PICKED_UP');
            });
            return b.cmd(o.idempotencyKey, { version: del.x.version });
          },
          { key: o.idempotencyKey, body },
        ),
      reportReturnStoreDelivery: (deliveryId: string, body, o: WriteOptions) =>
        b.call(
          me,
          'POST',
          `/deliveries/${deliveryId}/returns/store-deliveries`,
          () => {
            const del = b.myExec(me, deliveryId);
            if (del.type !== 'RETURN') fail(409, 'INVALID_STATE', '회수 배송이 아님');
            b.checkVersion(del.x.version, o.expectedVersion);
            // 실패 반납은 ASSIGNED 에서 바로(받음 단계 없음 — execution 0.15.0). 반납 인증번호(0.28.0)는 서버 설정 꺼짐이 기본이라 MOCK 은 검사하지 않는다
            const from: ExecutionState = del.purpose === 'FAILED_DELIVERY_RETURN' ? 'ASSIGNED' : 'RETURN_PICKED_UP';
            if (del.x.state !== from) fail(409, 'INVALID_STATE');
            b.checkReturnCode(del, body.handoverCode);
            del.x.completedAt = now();
            b.xHistory(del, 'RETURNED_TO_STORE', 'RIDER');
            b.emit('ReturnDelivered', `${deliveryId} ${del.purpose === 'FAILED_DELIVERY_RETURN' ? '실패 상품' : '회수품'} MFC 반납`, { deliveryId, riderId: me });
            b.schedule(b.lag(), () => {
              if (del.d.assignment) del.d.assignment.state = 'COMPLETED';
              b.setDispatchState(del, 'CLOSED');
            });
            return b.cmd(o.idempotencyKey, { version: del.x.version });
          },
          { key: o.idempotencyKey, body },
        ),

      // mfc-fulfillment 인계
      authorizeHandover: (packageId: string, body: HandoverAuthorizationRequest, o: WriteOptions) =>
        b.call(me, 'POST', `/packages/${packageId}/handover-authorizations`, () => b.authorize(me, packageId, body), {
          key: o.idempotencyKey,
          body: { ...body, scannedAt: undefined },
        }, 201),
      authorizeHandoverByCode: (body: HandoverCodeAuthorizationRequest, o: WriteOptions) =>
        b.call(me, 'POST', '/packages/handover-code-authorizations', () => b.authorizeByCode(me, body), { key: o.idempotencyKey, body }, 201),
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
      listMfcPickupPoints: () =>
        b.call(me, 'GET', '/mfc-pickup-points', (): PickupPointList => ({
          items: [
            {
              centerId: b.mfcId,
              name: `(MOCK) ${b.mfcId}`,
              address: null,
              phone: null,
              coordinates: { ...b.mfcLocation },
              handoverPoint: null,
            },
          ],
        })),
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
      // execution 0.28.0 — MFC 반납을 기다리는 회수·반납 배송(회수품 들고 오는 중 / 실패 반납 배정)과 번호. 번호가 없으면 이때 만든다
      listReturnHandovers: (mfcId: string) =>
        b.call(who, 'GET', `/return-handovers?mfcId=${mfcId}`, (): { items: ReturnHandover[] } => {
          const items = [...b.deliveries.values()]
            .filter((d) => d.mfcId === mfcId && d.type === 'RETURN' && d.x.exists && b.awaitingReturn(d))
            .map((d) => {
              d.returnCode ??= { code: returnCodeOf(d.deliveryId), failed: 0, locked: false, issuedAt: b.clock.now };
              const rc = d.returnCode;
              return { deliveryId: d.deliveryId, deliveryNumber: null, purpose: d.purpose ?? null, state: d.x.state, riderId: d.x.riderId, code: rc.code, failedAttempts: rc.failed, locked: rc.locked, issuedAt: b.clock.iso(rc.issuedAt) };
            });
          return { items };
        }),
      // rider 0.18.0 화면 표기 — MOCK 라이더는 번호·이름이 없다(짧은 ID 로 보임)
      getRiderDisplayNames: (riderIds: readonly string[]) =>
        b.call(who, 'GET', `/riders/display-names`, (): RiderDisplayNames => ({ items: riderIds.map((riderId) => ({ riderId, riderNumber: null, nameMasked: null })) })),
      getCenter: (centerId: string) =>
        b.call(who, 'GET', `/centers/${centerId}`, (): Center => {
          if (centerId !== b.mfcId) fail(404, 'NOT_FOUND');
          return { centerId, version: 1, type: 'MFC', name: `(MOCK) ${centerId}`, state: 'ACTIVE', coordinates: { ...b.mfcLocation }, accessPoints: null };
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

/** 약 1km 격자(소수 둘째 자리) — dispatch DispatchViews.rounded 와 같은 뜻 */
function roundPoint(p: LatLng): { lat: number; lng: number } {
  return { lat: round2(p.lat), lng: round2(p.lng) };
}
