// 백엔드 계약의 부분 사본 — 이 시뮬레이터(가상 라이더)가 부르거나 읽는 부분만.
// 이름·상태값·필드는 계약을 그대로 따른다. 계약이 바뀌면 여기를 먼저 맞추고 docs/design.md §3 표를 고친다.
//
// 기준: pmart-backend origin/main f43a1505 (2026-11-24 다시 읽음 — 527dff2b 뒤 dispatch·execution·tracking·rider 는 모두 선택 칸·직원용 조회 추가. 부르는 길·필수 칸 변화 없음, 단 rider 0.23.0 배달지역 변경이 운행 중이면 409 → prepare 가 먼저 OFF_DUTY).
//        이전: 527dff2b + PR #350(ADR-0085) 2026-11-22, 전체 읽기 3817f9bc 2026-11-20
//   contracts/openapi/delivery-dispatch-service.yaml   0.17.0 (0.15~0.17 운영 통계 /metrics/dispatch·자동 취소 내역·내부 진행 중 배송 수 — 안 부름. 0.14.0 배정 이력 deliveryNumber D+주문번호, 0.13.2 Offer.source FAILED_RETURN 이 계약 enum 에 들어감 — 이미 받고 있었음,0.6.0 purpose FAILED_DELIVERY_RETURN — 실패 확정 뒤 같은 라이더에게 제안 없이 반납 배송, 0.12.1 recovery.pickup.source RIDER_LOCATION,
//                                                              0.12.2 GET /offers pollAfterSec 은 더 이상 null 아님 — 못 받으면 30초, 0.5.2 order.mfcPhone, 0.13.1 Delivery.dropAreaLabel, 0.11.1 Assignment.vehicleType nullable)
//   contracts/openapi/delivery-execution-service.yaml  0.42.0 (0.41~0.42 오배송 차감·지급 이월 — 정산, 안 부름. 0.40.0 RiderDelivery.bundleId·stopSequence 선택 칸, 0.39.0 배송이 끝나면 열린 도움요청 자동 완료(resolvedBy system:delivery-ended), 0.37~0.38 직원용 mfcId 거르기·/delivery-metrics — 안 부름. 0.36.0 deliveryNumber D+주문번호·두 번째부터 -순번, 0.35.0 직원 도움요청 목록 state=ALL — 안 부름, 0.34.0 직원 배송 목록 firstAssignedAt·arrivedAtStoreAt·arrivedAtCustomerAt·promisedAt·completionMethod — 선택 칸, 시뮬레이터는 아직 안 읽음,
//                                                              DeliveryAssigned.promisedAt 선택 칸 추가,
//0.14.0 실패 등록 = DELIVERY_FAILURE 도움요청 대화도 같이 열림(따로 보내지 않음), 0.15.0 실패 확정(custody RIDER) → 반납 배송 ASSIGNED 에서 바로 returns/store-deliveries,
//                                                              0.20.0 고객 "받았어요"·픽업 5시간 자동 완료(CUSTOMER_CONFIRMED·AUTO_COMPLETED — 라이더 완료가 409 일 수 있음), 0.28.0 반납 인증번호 handoverCode(설정 꺼짐이면 선택),
//                                                              0.32.0 실패 확정 30분 안 되돌리기, 0.31.0 직원용 운행시간)
//   contracts/openapi/delivery-tracking-service.yaml   0.14.0 (0.14.0 관제 activeDeliveries 에 promisedAt·delayed·dropArea(대략 위치) 선택 칸 — 아직 화면에 안 씀. 0.13.0 설명만 — 번호 새 모양. 0.12.0: ControlRider.locationShared — 쉬는 라이더(신규배차 끔·배송 0건)는 location null·stale false, 백엔드 4c8748fd.0.10.0: ControlRider.riderNumber 화면 번호 — 백엔드 c902fb2f. 0.8.0: 라이더 관제 GET /rider-locations — RIDER_OPS·OPERATOR_ADMIN, 실서버 화면이 관제 계정으로 읽음 RR-08. 백엔드 aaa2ff8c)
//   contracts/openapi/rider-service.yaml               0.26.0 (0.23.0 PATCH /riders/me 배달지역은 쉴 때만(ON_DUTY·진행 중 배송이면 409 INVALID_STATE, 운영 MFC 아니면 422 MFC_NOT_AVAILABLE), 0.25.0 activeDeliveryCount nullable, 0.22·0.24·0.26 직원용 mfcId 거르기·목록 진행 중 수·구역 이름 — 안 부름. 0.21.0 riderNumber R+4자리·찾기 R4785=4785, 0.19.0 직원 탈퇴 신청 목록 GET /riders/withdrawals, 0.20.0 탈퇴 라이더 보기 withdrawn·includeWithdrawn·withdrawnAt — 직원용, 안 부름.0.17.0 가입 휴대폰 확인 phoneVerificationId — 설정 꺼짐이면 선택, 0.7.0 가입 주소·은행 코드 검사. 부르는 길 그대로) — 0.16.0 직원용 라이더 찾기 GET /riders?riderIds= 만 추가로 읽음(2026-11-19 백엔드 a767ad5f, 관제 계정 — 기본 화면 라이더 상세). (0.5.0: 수단 E_BIKE·KICKBOARD, 운전면허 licenseNumber — 오토바이·자동차·킥보드 가입은 면허 필수 422 LICENSE_REQUIRED. 가입은 RD-sim-01·02 끝나 지금 안 부름)
//   contracts/openapi/mfc-fulfillment-service.yaml     0.34.0 (출고 조회·포장 인계 부분만 — 0.13.0/0.23.0 번호로 인계, 0.24.0 Shipment.deliveryId 채움, 0.31.1 번호 인계에 이미 인계된 포장 숫자면 409 ALREADY_HANDED_OVER(틀린 횟수에 안 셈).
//                                                              0.27~0.34 는 MFC 작업 쪽(관리자 중지·부분 종료·결품 지표) — 인계 API 그대로)
//   contracts/openapi/rider-auth-service.yaml          0.2.0 (카카오·네이버 로그인 — 시뮬레이터는 안 부름)
//   contracts/openapi/center-master-service.yaml       0.2.0 (MFC 위치: 라이더용 GET /mfc-pickup-points 먼저, 실패하면 관찰 계정 GET /centers/{centerId})
//   contracts/openapi/order-service.yaml               0.13.1 (직원용 주문 상세 GET /orders/lookups/{id}·원문 열람 POST …/pii-reveals 만 — 주문 창 "주문" 탭, 관제 계정, 2026-11-19 백엔드 637abcb5 에서 읽음)
//   contracts/openapi/_common.yaml                     0.1.0
// 모든 경로는 게이트웨이 /api/v1 아래. POST·PUT 은 Idempotency-Key·X-Source-System 필수, 상태 전이는 X-Expected-Version(선택).
// 이름이 서비스 사이에서 겹치는 스키마만 이름을 바꿨다(주석에 계약 이름).

// ───────────────────────── _common.yaml ─────────────────────────

export type CommandStatus = 'ACCEPTED' | 'APPLIED' | 'REJECTED' | 'UNKNOWN_RESULT';

export interface CommandResponse {
  status: CommandStatus;
  requestId: string;
  resultId?: string;
  appliedQty?: number;
  version?: number;
  retryable?: boolean;
  nextAction?: string;
  occurredAt?: string;
}

/** RFC 9457 Problem Details + PMart 확장 (계약 이름 ErrorResponse). */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code: string;
  traceId: string;
  requestId?: string;
  retryable?: boolean;
  details?: { field?: string; reason?: string }[];
}

export interface Page {
  nextCursor?: string | null;
  size?: number;
}

/** KRW 정수, 음수 금지. */
export type Money = number;

export interface AsOf {
  asOf?: string;
  sourceVersion?: number;
  freshness?: 'CURRENT' | 'STALE' | 'UNAVAILABLE';
}

/** 백엔드가 Problem 으로 거절했다(서버가 확정한 결과). */
export class ApiProblem extends Error {
  constructor(
    readonly status: number,
    readonly problem: Partial<Problem>,
  ) {
    super(`${status} ${problem.code ?? ''} ${problem.title ?? ''}`.trim());
    this.name = 'ApiProblem';
  }
  get code(): string | undefined {
    return this.problem.code;
  }
}

/** 응답이 없거나 결과를 알 수 없다 — 실패로 단정하지 않고 같은 Idempotency-Key 로 재전송하거나 조회로 확인한다. */
export class ResultUnknown extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResultUnknown';
  }
}

// ───────────────────────── delivery-dispatch 0.13.1 ─────────────────────────

export type DeliveryType = 'FORWARD' | 'RETURN' | 'RESHIPMENT';

/** 배차 관점 상태 — execution 의 ExecutionState 와 다른 값이다(docs/design.md §4). */
export type DispatchState =
  | 'CREATED'
  | 'DISPATCHING'
  | 'ASSIGNED'
  | 'PICKED_UP'
  | 'CANCELLED_BEFORE_PICKUP'
  | 'DISPATCH_FAILED'
  | 'CLOSED'
  | 'BLOCKED';

/**
 * DELIVERY 일반, CLAIM_RETURN 고객 반품 회수(dispatch 0.5.0 — 고객 집 → MFC, 시뮬레이터는 아직 거절), MISDELIVERY_RECOVERY 오배송 회수(DD-2),
 * MISDELIVERY_RESHIPMENT 오배송 재발송(0.4.1 — type RESHIPMENT), MISDELIVERY_REDELIVERY 고객 잘못 다시 배송(0.4.2 — type RESHIPMENT, 잘못 둔 곳 → 실제 집),
 * FAILED_DELIVERY_RETURN 전달 실패 반납(0.6.0 — type RETURN, 실패 확정 custody RIDER 면 원래 라이더에게 제안 없이 바로 배정, 받음 단계 없이 ASSIGNED 에서 MFC 반납).
 */
export type DeliveryPurpose =
  | 'DELIVERY'
  | 'CLAIM_RETURN'
  | 'MISDELIVERY_RECOVERY'
  | 'MISDELIVERY_RESHIPMENT'
  | 'MISDELIVERY_REDELIVERY'
  | 'FAILED_DELIVERY_RETURN';

export type OfferState = 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'LATE' | 'SEND_FAILED' | 'SUPERSEDED';
/** FAILED_RETURN = 전달 실패 반납을 원래 라이더에게 바로 배정한 기록(dispatch 0.13.2 — 백엔드 PR #299, 2026-11-20 배포 대기. 그 전엔 이 값이 있는 배송의 배차 상세가 500) */
export type OfferSource = 'AI_RECOMMENDED' | 'DELIVERY_LIST' | 'FAILED_RETURN';
export type DeliveryMode = 'SINGLE' | 'BUNDLED' | 'SCHEDULED';
export type OfferResponseKind = 'ACCEPT' | 'REJECT';
export type RejectReason = 'TOO_FAR' | 'OVER_CAPACITY' | 'PERSONAL' | 'OTHER';
export type OfferOutcome = 'ASSIGNED' | 'REJECTED' | 'LATE';
export type LateReason = 'EXPIRED' | 'ALREADY_ASSIGNED' | 'ORDER_CANCELLED' | 'INELIGIBLE';

export interface PackageSpec {
  packagingMinutes?: number;
  weightG?: number;
  volumeL?: number;
  bagCount?: number;
  containsAlcohol?: boolean;
  coldChain?: boolean;
  packageIds?: string[];
}

export interface ArrivalWindow {
  date?: string;
  start?: string;
  end?: string;
}

/** dispatch LatLng */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/** 주문 요약 줄(dispatch OfferOrderInfo.items · execution orderSummary.items) */
export interface OrderSummaryItem {
  name?: string;
  optionLabel?: string | null;
  qty?: number;
  lineAmount?: number;
}

/** dispatch OfferOrderInfo (0.4.6 — 라이더 앱 요청 §1, 수락 전부터). deliveryNote 는 고객이 쓴 글이라 화면·로그에 옮기지 않는다. */
export interface OfferOrderInfo {
  orderId?: string;
  /** 화면용 주문번호(숫자 8자리) */
  orderNumber?: string | null;
  mfcName?: string | null;
  mfcAddress?: string | null;
  /** 가게 전화 — 0.5.2 */
  mfcPhone?: string | null;
  items?: OrderSummaryItem[];
  itemAmount?: number;
  deliveryNote?: string | null;
}

/** 라이더 표시용 요약. 회수 배송이면 distanceKm = 회수지 → MFC, pickup* = 라이더 → 회수지. */
export interface OfferSummary {
  mfcId?: string;
  /** 배송지 동 이름까지 */
  dropAreaLabel?: string;
  /** MFC → 고객 도로 거리 */
  distanceKm?: number;
  /** 라이더 → MFC 도로 거리 */
  pickupDistanceKm?: number;
  pickupEtaSeconds?: number;
  /** 픽업지 → 전달지 예상 소요(초, 도로) — 0.4.5 */
  dropEtaSeconds?: number;
  /** 픽업지 좌표 — MFC 는 정확, 회수·다시 배송은 약 1km 격자 반올림 — 0.4.5 */
  pickupPoint?: GeoPoint;
  /** 전달지 대략 좌표(소수 둘째 자리 반올림, 약 1km 격자) — 0.4.5 */
  dropAreaPoint?: GeoPoint;
  /** 주문 요약 — 0.4.6. 못 받았으면 없음, 회수 배송은 없음 */
  order?: OfferOrderInfo;
  weightG?: number;
  bagCount?: number;
  containsAlcohol?: boolean;
  deliveryMode?: DeliveryMode;
  estimatedFee?: Money;
}

export interface Offer {
  offerId?: string;
  attemptId?: string;
  deliveryId?: string;
  riderId?: string;
  radiusKm?: number;
  sentAt?: string;
  /** sentAt + 1분 */
  expiresAt?: string;
  /** 응답 생성 시점 서버 기준 남은 초. SENT 가 아니면 0 */
  remainingSec?: number;
  state?: OfferState;
  viewedAt?: string | null;
  source?: OfferSource;
  bundleId?: string | null;
  bundleSize?: number;
  stopSequence?: number;
  deliveryType?: DeliveryType;
  purpose?: DeliveryPurpose;
  summary?: OfferSummary;
}

/** GET /offers 응답. pollAfterSec — 받을 수 있으면 5초, 못 받는 상태(운행 종료·신규배차 끔·하나씩 배달 중·제한)면 30초(0.12.2 부터 null 을 주지 않음 — 타입만 호환으로 nullable). */
export interface OfferListResponse {
  items?: Offer[];
  page?: Page;
  serverTime?: string;
  pollAfterSec?: number | null;
}

export interface DeliveryListItem {
  deliveryId?: string;
  mfcId?: string;
  dropAreaLabel?: string;
  deliveryMode?: DeliveryMode;
  /** 내 위치 → MFC 직선거리 */
  straightDistanceKm?: number;
  /** MFC → 고객 도로 거리 */
  distanceKm?: number;
  estimatedFee?: Money;
  weightG?: number;
  bagCount?: number;
  containsAlcohol?: boolean;
  readyAt?: string;
}

export interface DeliveryListResponse {
  items?: DeliveryListItem[];
  serverTime?: string;
  pollAfterSec?: number | null;
}

/** POST /offers/{offerId}/responses 본문 (계약에서는 이름 없는 인라인 스키마). */
export interface OfferResponseRequest {
  response: OfferResponseKind;
  rejectReason?: RejectReason;
  respondedAt?: string;
}

export interface OfferResponseResult {
  offerId: string;
  outcome: OfferOutcome;
  lateReason?: LateReason;
  deliveryId?: string;
  assignmentId?: string;
  consecutiveRejections?: number;
  rejectionNotice?: boolean;
  decidedAt?: string;
}

export interface DispatchAttempt {
  attemptId?: string;
  requestId?: string;
  deliveryId?: string;
  trigger?: 'AUTO' | 'STORE_STAFF' | 'REASSIGN' | 'RETRY';
  state?: 'SEARCHING' | 'OFFERING' | 'ASSIGNED' | 'FAILED' | 'CANCELLED';
  currentRadiusKm?: number;
  retryCount?: number;
  startedAt?: string;
  deadlineAt?: string;
  failureReason?: 'NO_RIDER' | 'REPEATED_REJECTION' | 'EXPIRED' | 'SYSTEM_FAILURE';
  splitCount?: number;
  offers?: Offer[];
}

export interface Assignment {
  assignmentId?: string;
  deliveryId?: string;
  riderId?: string;
  /** 수락한 제안의 수단 — 제안 없이 배정(실패 반납 등)이면 null (0.11.1) */
  vehicleType?: string | null;
  state?: 'ASSIGNED' | 'PICKED_UP' | 'CANCELLED' | 'COMPLETED';
  assignedAt?: string;
  bundleId?: string | null;
  stopSequence?: number | null;
  pickedUpAt?: string;
  handoverIds?: string[];
  cancelledAt?: string;
  version?: number;
}

/** 오배송 회수(DD-2)·고객 반품 회수(claimId). pickup 은 배정된 라이더·운영자에게만 — 제안만 받은 라이더에게는 비어 있다. */
export interface RecoveryInfo {
  caseId?: string;
  /** 고객 반품 회수(CLAIM_RETURN) — 0.5.0 */
  claimId?: string;
  originDeliveryId?: string;
  /** 운영자에게만 */
  originRiderId?: string;
  pickup?: {
    lat?: number;
    lng?: number;
    /** RIDER_LOCATION — 다른 라이더 반납 때 원래 라이더 마지막 위치(0.12.1) */
    source?: 'RIDER_COMPLETION_LOCATION' | 'DROP_ADDRESS' | 'RIDER_LOCATION';
    recordedAt?: string;
  };
}

/** GET /deliveries/{id}/dispatch — 배차 관점 배송. */
export interface Delivery {
  deliveryId?: string;
  version?: number;
  type?: DeliveryType;
  orderId?: string;
  shipmentId?: string;
  claimId?: string;
  mfcId?: string;
  state?: DispatchState;
  packageSpec?: PackageSpec;
  arrivalWindow?: ArrivalWindow;
  assignment?: Assignment;
  attempts?: DispatchAttempt[];
  delayAlertedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  purpose?: DeliveryPurpose;
  recovery?: RecoveryInfo;
  /** 0.4.1 — 재발송(MISDELIVERY_RESHIPMENT)이면 오배송 확인 사건 */
  caseId?: string;
  /** 배송지 동 이름 — 0.13.1 */
  dropAreaLabel?: string | null;
}

/** POST /deliveries/{id}/assignment-cancellations 본문. 픽업 뒤면 422 PICKED_UP_CASE_REQUIRED. */
export interface AssignmentCancellationRequest {
  requestedBy: 'RIDER' | 'STORE_STAFF' | 'OPERATOR' | 'ORCHESTRATION';
  reason: 'RIDER_UNABLE' | 'STORE_REQUEST' | 'ORDER_CANCELLED' | 'NO_SHOW' | 'OPERATOR';
  reasonDetail?: string;
  /** 기본 true */
  reassign?: boolean;
  approvalRef?: string;
}

// ───────────────────────── delivery-execution 0.33.0 ─────────────────────────

/** 수행 관점 상태 — dispatch 의 DispatchState 와 다른 값이다(docs/design.md §4). */
export type ExecutionState =
  | 'UNASSIGNED'
  | 'ASSIGNED'
  | 'ARRIVED_AT_STORE'
  | 'PICKED_UP'
  | 'ARRIVED_AT_CUSTOMER'
  | 'FAILURE_REPORTED'
  | 'COMPLETED'
  | 'FAILED'
  | 'SUSPENDED'
  | 'RETURN_IN_PROGRESS'
  | 'RETURN_PICKED_UP'
  | 'RETURNED_TO_STORE'
  | 'CANCELLED';

export type SettlementState =
  | 'ESTIMATED'
  | 'PENDING_CONFIRMATION'
  | 'CONFIRMED'
  | 'PAYING'
  | 'PAID'
  | 'PAYMENT_FAILED'
  | 'ADJUSTED';

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** 상태 전이 공통 본문. location 은 참고용 — 상태 확정 근거가 아니다. */
export interface TransitionRequest {
  occurredAt?: string;
  location?: { lat?: number; lng?: number; accuracyM?: number };
  note?: string;
}

export interface PickupRequest extends TransitionRequest {
  handoverIds: string[];
}

export type CompletionMethod = 'FACE' | 'CONTACTLESS';
export type Placement = 'HANDED_TO_CUSTOMER' | 'FRONT_DOOR' | 'SECURITY_OFFICE' | 'DELIVERY_BOX' | 'OTHER';

export interface CompletionRequest extends TransitionRequest {
  method: CompletionMethod;
  evidence: {
    photoRefs: string[];
    takenAt: string;
    placement?: Placement;
    placementDetail?: string;
    substituteEvidenceCaseId?: string;
  };
}

export type FailureReason =
  | 'CUSTOMER_ABSENT'
  | 'ADDRESS_ERROR'
  | 'UNREACHABLE'
  | 'REFUSED'
  | 'DAMAGED'
  | 'RIDER_INCIDENT'
  | 'OTHER';
export type GoodsLocation = 'WITH_RIDER' | 'RETURNED_TO_STORE' | 'LEFT_AT_DOOR' | 'UNKNOWN';

export interface ContactAttempt {
  attemptedAt: string;
  /** PHONE_CALL·SMS — 0.11.0 안심번호 없앤 뒤 앱이 보내는 값 */
  method?: 'SAFE_NUMBER_CALL' | 'APP_MESSAGE' | 'PHONE_CALL' | 'SMS';
  result: 'ANSWERED' | 'NO_ANSWER' | 'FAILED';
}

/** 고객 사유(CUSTOMER_ABSENT·UNREACHABLE·ADDRESS_ERROR·REFUSED)는 contactAttempts 2회 이상 필수. */
export interface FailureRequest extends TransitionRequest {
  reason: FailureReason;
  detail?: string;
  evidenceRefs: string[];
  goodsLocation?: GoodsLocation;
  contactAttempts?: ContactAttempt[];
}

export type HelpCategory =
  | 'CUSTOMER_UNREACHABLE'
  | 'ADDRESS_ISSUE'
  | 'GOODS_ISSUE'
  | 'PHOTO_UPLOAD_FAILED'
  | 'ACCIDENT'
  | 'APP_ERROR'
  | 'STORE_WAITING'
  | 'STATUS_CORRECTION'
  | 'OTHER'
  /** 0.14.0 — 실패 등록이 같이 여는 대화. 조회용 — 이 값으로 직접 만들면 400 */
  | 'DELIVERY_FAILURE';

/** POST /deliveries/{id}/help-requests 본문. */
export interface HelpRequestCreate {
  category: HelpCategory;
  detail?: string;
  evidenceRefs?: string[];
}

export interface HelpRequest {
  requestId?: string;
  deliveryId?: string;
  incidentId?: string;
  caseId?: string | null;
  state?: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
  category?: string;
  stage?: ExecutionState;
  detail?: string | null;
  evidenceRefs?: string[];
  createdAt?: string;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  resolutionNote?: string | null;
}

/** POST …/returns/pickups — 오배송 회수는 items 빈 배열, evidenceRefs 1장 이상. */
export interface ReturnPickupRequest extends TransitionRequest {
  items: { claimLineId?: string; qty?: number }[];
  evidenceRefs: string[];
}

/**
 * POST …/returns/store-deliveries. 실패 반납(FAILED_DELIVERY_RETURN)은 ASSIGNED 에서 바로(0.15.0).
 * handoverCode(0.28.0) = MFC 직원 화면의 반납 인증번호 4자리 — 서버 설정 pmart.execution.return-handover.required 가 켜졌을 때만 필수(기본 꺼짐).
 * 틀리면 422 RETURN_HANDOVER_CODE_MISMATCH(남은 횟수), 5번 틀리면 422 RETURN_HANDOVER_LOCKED, 필수인데 없으면 422 RETURN_HANDOVER_CODE_REQUIRED.
 */
export interface ReturnStoreDeliveryRequest extends TransitionRequest {
  evidenceRefs?: string[];
  receivedByStaffRef?: string;
  handoverCode?: string;
}

/**
 * (execution 0.28.0) GET /return-handovers?mfcId= 한 줄 — MFC 반납을 기다리는 회수·반납 배송과 반납 인증번호.
 * 그 센터 직원(작업자 포함)·OPERATOR_ADMIN·RIDER_OPS·CS_AGENT. 대상 = RETURN_PICKED_UP(회수품 들고 오는 중) 또는 실패 반납(ASSIGNED). 번호가 없으면 이때 만든다.
 * 시뮬레이터는 관찰 계정(MFC 작업자)으로 읽는다 = "직원 화면의 번호를 라이더에게 불러 준다"(RR-09, 사용자 2026-11-20 "반납 인증번호를 받게 해").
 */
export interface ReturnHandover {
  deliveryId: string;
  deliveryNumber?: string | null;
  /** CLAIM_RETURN · MISDELIVERY_RECOVERY · FAILED_DELIVERY_RETURN */
  purpose?: string | null;
  state: string;
  riderId?: string | null;
  /** 4자리 */
  code: string;
  failedAttempts: number;
  /** 5번 틀려 잠김 — 직원이 새로 내야 풀림 */
  locked: boolean;
  issuedAt: string;
}

/**
 * (rider 0.18.0) GET /riders/display-names?riderIds= — 화면 표기 묶음 조회. 화면은 번호만 "R4785"(ADR-0085, rider 0.21.0).
 * OPERATOR_ADMIN·RIDER_OPS·CS_AGENT·MFC_SUPERVISOR·MFC_WORKER — 시뮬레이터는 관찰 계정(MFC 작업자)으로 읽는다.
 * 없는 ID 는 빠진다(순서 보장 없음), 탈퇴하면 nameMasked null. 50개까지.
 */
export interface RiderDisplayNames {
  items: {
    riderId: string;
    /** 화면용 라이더 번호 R4785(ADR-0085, rider 0.21.0 — 드물게 5자리) */
    riderNumber?: string | null;
    /** 가린 이름(첫·끝 글자) */
    nameMasked?: string | null;
  }[];
}

export interface EvidencePhoto {
  photoRef: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  sizeBytes: number;
  uploadedAt: string;
}

export interface Evidence {
  evidenceRef?: string;
  /** CUSTOMER_CONFIRMED 고객 "받았어요", AUTO_COMPLETED 픽업 5시간 뒤 서버 자동 완료(0.20.0) */
  method?: 'FACE' | 'CONTACTLESS' | 'CUSTOMER_CONFIRMED' | 'AUTO_COMPLETED';
  photoRefs?: string[];
  takenAt?: string;
  placement?: string;
  substituteEvidenceCaseId?: string;
}

export interface StatusHistoryEntry {
  state?: ExecutionState;
  occurredAt?: string;
  recordedAt?: string;
  actor?: 'RIDER' | 'SYSTEM_EVENT' | 'OPERATOR' | 'CUSTOMER';
  sourceRef?: string;
}

export interface Earning {
  earningId?: string;
  deliveryId?: string;
  riderId?: string;
  calculable?: boolean;
  rateTableVersion?: number;
  basis?: { vehicleType?: string; distanceBandKm?: string; cancelStage?: string };
  baseFee?: Money;
  surcharge?: Money;
  compensation?: Money;
  deduction?: Money;
  total?: Money;
  settlementState?: SettlementState;
  adjustmentRef?: string;
  recordedAt?: string;
  confirmAt?: string;
  payoutDate?: string;
  note?: string;
}

/** GET /deliveries/{id} — 수행 관점 배송. */
export interface DeliveryExecution {
  /** 라이더에게 보일 주문 요약 — execution 0.7.x, order 에서 조회 때 읽음(못 읽으면 없음). deliveryNote 는 화면·로그에 옮기지 않는다 */
  orderSummary?: {
    orderNumber?: string | null;
    items?: OrderSummaryItem[];
    itemAmount?: number;
    deliveryNote?: string | null;
  };
  deliveryId?: string;
  /** 화면 배송 번호(주문번호-순번) */
  deliveryNumber?: string | null;
  orderNumber?: string | null;
  mfcName?: string | null;
  mfcPhone?: string | null;
  /** (0.40.0) 알뜰 묶음 ID·묶음 안 전달 순서 — 배정 사건 값 그대로, 묶음 아니면 null. 시뮬레이터는 하나씩 배달이라 안 씀 */
  bundleId?: string | null;
  stopSequence?: number | null;
  version?: number;
  type?: DeliveryType;
  orderId?: string;
  riderId?: string;
  mfcId?: string;
  state?: ExecutionState;
  handoverIds?: string[];
  /** 출고 포장 ∪ 인계 기록(c95f1b17 — 첫 인계 전에도 채워짐). 포장 QR 은 RR-03 */
  packageIds?: string[];
  /** 고객 반품 회수 */
  claimId?: string | null;
  /** false 면 받음(returns/pickups) 단계 없이 ASSIGNED 에서 바로 MFC 반납(실패 반납) — 0.15.0 */
  returnPickupRequired?: boolean | null;
  evidence?: Evidence;
  failure?: {
    reason?: string;
    detail?: string;
    goodsLocation?: string;
    caseId?: string;
    photoRefs?: string[];
    contactAttempts?: number;
    reportedAt?: string;
    decision?: 'CONFIRM' | 'REJECT';
    decidedBy?: string;
    decidedAt?: string;
    custody?: 'RIDER' | 'STORE';
    /** 실패 등록이 연 DELIVERY_FAILURE 대화 — 0.14.0 */
    helpRequestId?: string | null;
    resumeRequestedAt?: string | null;
    /** 실패 확정(custody RIDER) 뒤 만들어진 반납 배송 — 0.15.0 */
    returnDeliveryId?: string | null;
    /** 반납을 누가 하나 — OTHER_RIDER 면 원래 라이더는 그 배송을 못 연다(404) */
    returnBy?: 'SAME_RIDER' | 'OTHER_RIDER' | null;
  };
  incidents?: { incidentId?: string; category?: string; raisedAt?: string }[];
  history?: StatusHistoryEntry[];
  earning?: Earning;
  assignedAt?: string;
  completedAt?: string;
  purpose?: DeliveryPurpose;
  caseId?: string;
  originDeliveryId?: string;
  recoveryOrigin?: {
    placement?: string;
    placementDetail?: string;
    photoRefs?: string[];
    takenAt?: string;
    completedAt?: string;
  };
}

/**
 * GET /deliveries/{id}/drop-info — 고객 개인정보.
 * 시뮬레이터는 lat·lng 만 쓰고 나머지는 저장·로그·화면에 남기지 않는다(CLAUDE.md). 다른 기기로도 넘기지 않는다(server/lanPolicy.ts).
 */
export interface DropInfo {
  deliveryId: string;
  roadAddress: string;
  detailAddress: string;
  postalCode?: string | null;
  receiverName: string;
  receiverPhone: string;
  entranceMethod?: 'FREE' | 'PASSWORD' | 'CALL' | 'OTHER' | null;
  entranceNote?: string | null;
  deliveryNote?: string | null;
  /** 주문 핀이 없으면 주소 지오코딩 좌표로 채움 — coordinateSource 로 구분 */
  lat?: number | null;
  lng?: number | null;
  coordinateSource?: 'ORDER_PIN' | 'ADDRESS_GEOCODE' | null;
}

export interface MyDeliveriesResponse {
  items?: DeliveryExecution[];
  page?: Page;
}

/**
 * (execution 0.24.0) 직원용 전달지 GET /deliveries/{id}/drop-location — RIDER_OPS·OPERATOR_ADMIN, 배정 ~ 전달 전만(그 밖 409 DROP_LOCATION_CLOSED).
 * 주소·좌표만(수령인·전화·출입 메모 없음). 응답 전에 백엔드가 개인정보 열람 기록을 남긴다(같은 직원·배송 10분 안 한 번). no-store, 로그 금지.
 */
export interface StaffDropLocation {
  deliveryId: string;
  kind: 'DELIVERY_DROP' | 'RETURN_PICKUP' | 'REDELIVERY_DROP';
  roadAddress: string;
  detailAddress: string;
  postalCode?: string | null;
  lat?: number | null;
  lng?: number | null;
  coordinateSource?: 'ORDER_PIN' | 'ADDRESS_GEOCODE' | null;
  piiAccessLogId: string;
}

/**
 * (execution 0.31.0) 직원용 라이더 운행시간 GET /rider-operating-time?riderId=&from=&to= — RIDER_OPS·OPERATOR_ADMIN·CS_AGENT.
 * 관제 계정, 이 PC 만(사용자 2026-11-19 "똑같이 해봐" — 기본 화면 라이더 상세 칸).
 */
export interface OperatingTime {
  from: string;
  to: string;
  /** 운행시간 = 배차 수락 ~ 전달 완료(겹치면 한 번) */
  totalSeconds: number;
  /** 접속 시간 = 운행(ON_DUTY) 켜 둔 시간 — rider 를 못 부르면 null */
  connectedSeconds?: number | null;
  /** 대기 시간 = 운행 중 + 신규배차 켬 + 맡은 배송 0건 — 못 부르면 null */
  waitingSeconds?: number | null;
  /** 날짜별(Asia/Seoul) — 계약 필수, 화면은 아직 안 씀 */
  days?: { date: string; seconds: number; connectedSeconds?: number | null; waitingSeconds?: number | null }[];
}

/**
 * (rider-service 0.16.0) 직원용 라이더 찾기 GET /riders?riderIds=(쉼표, 50개까지) 한 줄 — 이름·전화는 가린 값. 관제 계정, 이 PC 만.
 * 운행을 끈 라이더도 이름·번호가 나온다(관제 목록은 운행 중만).
 */
export interface StaffRiderSummary {
  riderId?: string;
  riderNumber?: string | null;
  nameMasked?: string | null;
  /** 예 010****5678 */
  phoneMasked?: string;
  vehicleType?: string;
  operatingStatus?: string;
  newDispatchEnabled?: boolean;
  restriction?: string;
  joinedAt?: string;
  /** (rider 0.17~0.18) */
  version?: number;
  operatingMfcId?: string | null;
  restrictionUntil?: string | null;
  stateChangedAt?: string;
  signupStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
}

export interface StaffRiderSearchResult {
  items?: StaffRiderSummary[];
  page?: number;
  size?: number;
  hasNext?: boolean;
}

/** GET /deliveries (직원 배송 찾기) 목록 한 줄 — 개인정보 없음. */
export interface StaffDeliverySummary {
  deliveryId?: string;
  version?: number;
  type?: DeliveryType;
  orderId?: string | null;
  mfcId?: string | null;
  riderId?: string | null;
  state?: ExecutionState;
  assignedAt?: string | null;
  pickedUpAt?: string | null;
  completedAt?: string | null;
  createdAt?: string;
  /** (2026-11-18) 화면용 주문번호 8자리 — 배정 사건이 실어 준 값(배정 전 null). 백엔드 9c5fdddc execution 0.26.0 */
  orderNumber?: string | null;
  /** (ADR-0085, execution 0.36.0) 화면 배송 번호 = D + 주문번호, 같은 주문 두 번째부터 -순번(D74939255·D74939255-2). 모르면 null */
  deliveryNumber?: string | null;
  purpose?: DeliveryPurpose | null;
  resumeRequestedAt?: string | null;
}

export interface StaffDeliveryListResponse {
  items?: StaffDeliverySummary[];
  page?: Page;
}

// ───────────────────────── delivery-tracking 0.14.0 ─────────────────────────

export interface LocationPoint {
  lat: number;
  lng: number;
  accuracyM?: number;
  speedMps?: number;
  headingDeg?: number;
  /** 단말 시각 */
  recordedAt: string;
  /** 진행 중 배송 연결(선택) */
  deliveryId?: string;
}

/** POST /riders/me/locations 본문 — 점 1~200개. */
export interface LocationBatch {
  deviceId?: string;
  points: LocationPoint[];
}

export type GpsQuality = 'GOOD' | 'LOW_ACCURACY' | 'OUT_OF_ZONE' | 'TIME_SKEW' | 'STALE' | 'UNKNOWN';

export interface RiderLocation {
  riderId?: string;
  lat?: number;
  lng?: number;
  accuracyM?: number;
  recordedAt?: string;
  receivedAt?: string;
  quality?: GpsQuality;
  inServiceZone?: boolean;
  staleSinceSeconds?: number;
}

/** 0.8.0 라이더 관제 GET /rider-locations?mfcId= 한 줄(ControlRider) — RIDER_OPS·OPERATOR_ADMIN 만. 운행 중 라이더의 현재 위치만(이력 없음). */
export interface ControlRider {
  riderId: string;
  nameMasked?: string | null;
  /** (0.10.0) 화면용 라이더 번호(ADR-0085 — R + 4자리, 드물게 5자리, 예 R4785. 2026-11-22 기존 라이더도 바뀜). 화면은 번호만 */
  riderNumber?: string | null;
  vehicleType?: string | null;
  /** (0.9.0) 지금 운행 구간 시작 — 신규배차 켜고 끄기로는 안 바뀜 */
  onDutySince?: string | null;
  /** (0.11.0) 진행 중 배송 없이 기다리기 시작한 때(배송 중이면 null) */
  waitingSince?: string | null;
  newDispatchEnabled?: boolean;
  /** (0.12.0) 위치 공유 중 — 진행 중 배송이 있거나 신규배차 켬. false 면 쉬는 중이라 location 을 주지 않는다(서버에 점이 있어도) */
  locationShared?: boolean;
  restriction?: string | null;
  location?: {
    lat?: number;
    lng?: number;
    accuracyM?: number | null;
    recordedAt?: string;
    receivedAt?: string;
    quality?: GpsQuality;
  } | null;
  staleSinceSeconds?: number | null;
  /** 위치 없음 또는 끊김 기준(3분)보다 오래됨 */
  stale: boolean;
  activeDeliveries: {
    deliveryId: string;
    /** 화면 배송 번호 — 0.11.0 */
    deliveryNumber?: string | null;
    stage?: 'UNASSIGNED' | 'TO_STORE' | 'AT_STORE' | 'TO_CUSTOMER' | 'AT_CUSTOMER' | 'DONE' | null;
    pickedUp?: boolean;
    etaPickup?: string | null;
    etaDrop?: string | null;
    /** (0.14.0) 배송 약속 시각(배정 사건 사본 — 이 배포 전 배정은 null) */
    promisedAt?: string | null;
    /** (0.14.0) 예상 도착(없거나 지났으면 지금)이 약속 + 20분을 넘음. 약속을 모르면 false */
    delayed?: boolean;
    /** (0.14.0) 배송지 대략 위치 — 소수 둘째 자리 반올림(약 1km). 정확한 곳은 전달지(열람 기록) */
    dropArea?: { lat: number; lng: number } | null;
  }[];
}

export interface ControlRiderList {
  items: ControlRider[];
  asOf: string;
}

// ───────────────────────── rider-service 0.26.0 ─────────────────────────

export type VehicleType = 'MOTORCYCLE' | 'BICYCLE' | 'E_BIKE' | 'KICKBOARD' | 'CAR' | 'WALK';
export type OperatingStatus = 'OFF_DUTY' | 'ON_DUTY';
export type AccountRestriction = 'NORMAL' | 'DISPATCH_RESTRICTED' | 'SUSPENDED' | 'TERMINATED';
export type DispatchMode = 'NORMAL' | 'AI_RECOMMENDED';

export interface DeliveryArea {
  mfcId?: string;
  zoneId?: string;
}

/**
 * POST /riders/signups — riderId 는 토큰 주체(본문에 없음). 같은 번호 409 DUPLICATE_RIDER·IDENTITY_ALREADY_REGISTERED, 탈퇴 30일 안 409 RIDER_REJOIN_BLOCKED.
 * 0.7.0: residence.roadAddress 는 주소 검색과 정확히 일치(422 INVALID_ADDRESS), bankCode ^[0-9]{3}$·accountNumber ^[0-9]{10,14}$, 같은 계좌 409 DUPLICATE_ACCOUNT.
 * 0.17.0: 서버 설정 phone-verification.required 가 켜지면 phoneVerificationId 필수(422 PHONE_NOT_VERIFIED — 실제 문자 확인이라 시뮬레이터는 가입 못 함). 기본 꺼짐.
 * 지금 RD-sim-01·02 는 가입이 끝나 이 길을 다시 부르지 않는다.
 */
/** rider PATCH /riders/me 본문(RiderProfileUpdate) 중 시뮬레이터가 쓰는 칸 — 지점을 바꾸면 배달지역을 그 MFC 로(2026-11-23) */
export interface RiderProfileUpdate {
  vehicleType?: VehicleType;
  deliveryAreas?: DeliveryArea[];
}

export interface RiderSignupRequest {
  /** ^01[0-9]{8,9}$ — 시뮬레이터 대역 010-0000-00NN(RR-02) */
  phone: string;
  name?: string;
  vehicleType: VehicleType;
  /** 0.5.0 — 오토바이·자동차·킥보드는 필수(422 LICENSE_REQUIRED) */
  licenseNumber?: string;
  phoneVerificationId?: string;
  bankAccount?: { bankCode: string; accountNumber: string; holderName: string };
  residence?: { roadAddress?: string; detail?: string };
  deliveryAreas: DeliveryArea[];
  consents: { consentType?: string; version?: string }[];
}

export interface OperatingStateRequest {
  status: OperatingStatus;
  /** ON_DUTY 일 때만 의미. OFF_DUTY 면 false 강제 */
  newDispatchEnabled: boolean;
  mfcId?: string;
}

export interface OperatingState {
  status?: OperatingStatus;
  newDispatchEnabled?: boolean;
  mfcId?: string;
  /** (0.25.0) dispatch 의 배정됐고 안 끝난 배송 수(ASSIGNED·PICKED_UP). 못 읽으면 null — 0 으로 보지 말 것 */
  activeDeliveryCount?: number | null;
  changedAt?: string;
  version?: number;
}

export interface DispatchSettings {
  /** 하나씩 배달하기 */
  oneAtATime?: boolean;
  dispatchMode?: DispatchMode;
  version?: number;
}

export interface RiderProfile {
  riderId?: string;
  /** 화면 라이더 번호 R4785(ADR-0085) */
  riderNumber?: string | null;
  version?: number;
  name?: string;
  phoneMasked?: string;
  licenseNumberMasked?: string;
  vehicleType?: VehicleType;
  bankAccountMasked?: string;
  residence?: { roadAddress?: string; detail?: string };
  deliveryAreas?: DeliveryArea[];
  operating?: OperatingState;
  settings?: DispatchSettings;
  restriction?: {
    state?: AccountRestriction;
    reason?: string;
    evidenceRef?: string;
    approvalRef?: string;
    until?: string;
  };
  lastHeartbeatAt?: string;
  joinedAt?: string;
}

/** POST /riders/me/withdrawals 본문(선택) — rider 0.6.0 구현·LAN 배포(RR-07 회신 2026-11-18). 막는 것(WithdrawalBlocker)이 있으면 409 INVALID_STATE(details field blockers), 없으면 202 APPLIED·nextAction LOGOUT. 같은 ID 재가입은 409 RIDER_WITHDRAWN. */
export interface WithdrawalRequest {
  reason?: string;
}

/** rider 0.6.0 WithdrawalBlocker — 진행 중 배송·확정 전 수행료(완료 5시간 안)·산정 불가 조정 대기·열린 도움요청·제한 검토 중 */
export type WithdrawalBlocker = 'ACTIVE_DELIVERY' | 'UNCONFIRMED_EARNING' | 'EARNING_ADJUSTMENT_PENDING' | 'OPEN_HELP_REQUEST' | 'RESTRICTION_REVIEW';

/** GET /riders/me/withdrawals/{requestId} — 실제로는 COMPLETED·REJECTED 만 온다. 탈퇴 뒤 GET /riders/me 404, 그 토큰은 게이트웨이 401. */
export interface Withdrawal {
  requestId?: string;
  state?: 'PENDING' | 'COMPLETED' | 'REJECTED';
  blockers?: WithdrawalBlocker[];
}

// ───────────────────────── mfc-fulfillment 0.26.0 (출고 조회·인계) ─────────────────────────

export type ShipmentState = 'PREPARING' | 'READY' | 'PARTIALLY_HANDED_OVER' | 'HANDED_OVER' | 'CANCELLED' | 'CLOSED_PARTIAL';
export type PackageState = 'OPEN' | 'SEALED' | 'HANDED_OVER' | 'INVALIDATED' | 'VOIDED';
export type FenceState = 'NONE' | 'HANDOVER_IN_PROGRESS' | 'COMMITTED' | 'EXPIRED';

export interface PackageContentLine {
  orderLineId: string;
  sku: string;
  qty: number;
  lotId?: string;
}

export interface Package {
  packageId?: string;
  /** 재포장마다 증가. QR 에 포함 */
  packageVersion?: number;
  shipmentId?: string;
  orderId?: string;
  version?: number;
  state?: PackageState;
  /** `PKG:<packageId>:<packageVersion>` — 인계 허가 scannedCode */
  qrCode?: string;
  /** 라벨 숫자(fulfillment 0.13.0 F-8) — 새 포장 4자리(0.23.0), 그 전 6자리. QR 이 안 찍힐 때 라이더가 입력 */
  handoverCode?: string | null;
  orderNumber?: string | null;
  packingLocation?: string | null;
  stagingLocation?: string | null;
  icePackCount?: number | null;
  contents?: PackageContentLine[];
  bagCount?: number;
  containsAlcohol?: boolean;
  temperatureZone?: string;
  weightG?: number;
  fence?: {
    state?: FenceState;
    handoverAuthorizationId?: string | null;
    fenceVersion?: number;
    riderId?: string | null;
    expiresAt?: string | null;
  };
  sealedAt?: string | null;
  handedOverAt?: string | null;
  invalidatedReason?: string | null;
}

/** Shipment.dispatchRequest (계약 이름 DispatchRequest — mfc-fulfillment 쪽). */
export interface ShipmentDispatchRequest {
  shipmentId: string;
  trigger: 'MANUAL' | 'AUTO_ON_READY';
  estimatedPackMinutes?: number | null;
  estimatedReadyAt: string;
  requestedAt: string;
  requestedBy?: string | null;
}

/** GET /shipments/{id} — OPERATOR 전용(라이더 토큰 불가). 관찰 계정(읽기만)으로 읽어 qrCode 를 얻는다 = "라벨을 본다" — 백엔드 RR-03 회신 2026-11-18 "그 방식으로 괜찮다". */
export interface Shipment {
  shipmentId?: string;
  fulfillmentId?: string;
  orderId?: string;
  /** 0.24.0 부터 채움(인계 사실의 배송, 없으면 취소 안 된 최근 배송). 배송이 아직 없으면 null — 예전 R-19 null 사례는 고쳐짐 */
  deliveryId?: string | null;
  orderNumber?: string | null;
  version?: number;
  state?: ShipmentState;
  holdReason?: string | null;
  packages?: Package[];
  packingDurationSec?: number;
  bagCount?: number;
  containsAlcohol?: boolean;
  weightG?: number;
  volumeCm3?: number;
  readyAt?: string | null;
  dispatchRequest?: ShipmentDispatchRequest | null;
  riderEta?: { eta?: string; asOf?: AsOf };
}

/** POST /packages/{id}/handover-authorizations 본문. 토큰 주체 = riderId 여야 한다. */
export interface HandoverAuthorizationRequest {
  riderId: string;
  deliveryId: string;
  /** 포장 qrCode 원문 */
  scannedCode: string;
  scannedAt?: string;
}

export interface HandoverAuthorization {
  handoverAuthorizationId?: string;
  packageId?: string;
  packageVersion?: number;
  fenceVersion?: number;
  riderId?: string;
  deliveryId?: string;
  fenceExpiresAt?: string;
  authorizedAt?: string;
}

/**
 * POST /packages/handover-code-authorizations 본문(fulfillment 0.13.0 F-8, 0.23.0 R-26) — 라벨 숫자로 QR 과 같은 허가.
 * 201 HandoverAuthorization. 틀리면 409 HANDOVER_CODE_MISMATCH(details attemptsLeft), 같은 라이더·배송 5번 틀리면 409 HANDOVER_CODE_LOCKED(맞는 번호도 거절),
 * 다른 배송 포장 409 DELIVERY_MISMATCH, 옛 6자리 번호가 겹치면 409 HANDOVER_CODE_AMBIGUOUS,
 * 이미 인계된 포장의 숫자면 409 ALREADY_HANDED_OVER(0.31.1 — 틀린 횟수에 넣지 않음).
 */
export interface HandoverCodeAuthorizationRequest {
  riderId: string;
  deliveryId: string;
  /** `^([0-9]{4}|[0-9]{6})$` */
  handoverCode: string;
}

/** POST /packages/{id}/handover-commits 본문. */
export interface HandoverCommitRequest {
  handoverAuthorizationId: string;
  fenceVersion: number;
  riderId: string;
  handedOverAt?: string;
}

/** 201 APPLIED = 인계 확정, 202 UNKNOWN_RESULT·REJECTED = 본문 status·nextAction 을 따른다. */
export interface HandoverCommitResult {
  status: CommandStatus;
  requestId?: string;
  handoverId: string;
  inventoryCommitId?: string | null;
  packageState?: PackageState;
  shipmentState?: ShipmentState;
  handedOverAt?: string;
  nextAction?: string;
  /** `코드: 상세` — INSUFFICIENT_STOCK·HANDOVER_QTY_EXCEEDED·INVALID_STATE·FENCE_VERSION_MISMATCH·VERSION_CONFLICT·VALIDATION_FAILED */
  rejectReason?: string | null;
}

/** GET /packages/{id}/handover-resolution — 확정 결과가 UNKNOWN_RESULT 일 때 해소용. */
export interface HandoverResolution {
  packageId?: string;
  packageVersion?: number;
  packageState?: PackageState;
  verdict?: 'READY' | 'STOPPED' | 'HANDOVER_IN_PROGRESS' | 'HANDED_OVER' | 'UNKNOWN';
  fence?: {
    state?: FenceState;
    handoverAuthorizationId?: string | null;
    fenceVersion?: number;
    expiresAt?: string | null;
  };
  handoverId?: string | null;
  handoverCode?: string | null;
  orderNumber?: string | null;
  inventoryCommitId?: string | null;
  inventoryApplyStatus?: 'NOT_REQUESTED' | 'PROCESSING' | 'APPLIED' | 'REJECTED' | 'UNKNOWN_RESULT';
  stopRequestId?: string | null;
  checkRequired?: boolean;
  shipmentId?: string;
  orderId?: string;
  packingLocation?: string | null;
  riderId?: string | null;
  lastCheck?: { result?: 'AT_STATION' | 'TAKEN_BY_RIDER'; checkedBy?: string; checkedAt?: string } | null;
  asOf?: AsOf;
}

// ───────────────────────── center-master 0.2.0 (센터 조회·라이더용 픽업지 목록) ─────────────────────────

export type CenterAccessKind = 'VEHICLE_ENTRY' | 'UNLOADING_BAY' | 'HANDOVER_POINT' | 'STAFF_ENTRY';

/** GET /centers/{centerId} — MFC 위치의 정본. 배차 반경(1→2→3km)도 이 좌표 기준. 필요한 필드만. */
export interface Center {
  centerId?: string;
  version?: number;
  type?: 'CDC' | 'MFC' | string;
  name?: string;
  state?: string;
  address?: string;
  coordinates?: { lat?: number; lng?: number };
  /** 진입·하차·인계 위치 — HANDOVER_POINT 가 있으면 라이더는 그리로 간다 */
  accessPoints?: { kind?: CenterAccessKind; label?: string; coordinates?: { lat?: number; lng?: number }; note?: string }[] | null;
  floors?: number;
}

/** GET /mfc-pickup-points 항목(center-master 0.2.0 — 라이더용, ACTIVE MFC 만). 인계 위치 = accessPoints 의 HANDOVER_POINT 첫 항목 */
export interface PickupPoint {
  centerId: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  coordinates?: { lat?: number; lng?: number } | null;
  handoverPoint?: { label?: string; note?: string | null; coordinates?: { lat?: number; lng?: number } | null } | null;
}

export interface PickupPointList {
  items: PickupPoint[];
}

// ───────────────────────── 사건 이름 (contracts/events/*.v1.json) ─────────────────────────
// 시뮬레이터는 사건을 직접 구독하지 못한다 — REST 조회로 결과를 본다. MOCK 사건 로그에 이 이름을 그대로 쓴다.

export type DomainEventType =
  // mfc.fulfillment.v1
  | 'DispatchRequested'
  | 'ShipmentReady'
  | 'PackingFinished'
  | 'PackageHandedOver'
  // delivery.delivery.v1
  | 'DeliveryCreated'
  | 'DispatchOfferSent'
  | 'DeliveryAssigned'
  | 'DeliveryAssignmentChanged'
  | 'DeliveryCancelledBeforePickup'
  | 'DispatchFailed'
  | 'PickupCompleted'
  | 'DeliveryCompleted'
  | 'DeliveryFailed'
  | 'DeliveryIncidentRaised'
  | 'ReturnPickedUp'
  | 'ReturnDelivered'
  | 'DeliveryFailureReverted'
  | 'DeliveryHeadingToCustomer'
  // delivery.tracking.v1
  | 'RiderLocationStale'
  | 'RiderApproachingCustomer'
  // platform.case.v1 — 오배송 확인(case-service, 상담원·지원센터가 기록). 회수·재발송·다시 배송의 시작
  | 'MisdeliveryConfirmed'
  // 다시 배송 결제 필요(dispatch 발행, 200m 이상 — 9,000원)
  | 'RedeliveryPaymentRequired'
  // delivery.rider.v1
  | 'RiderStateChanged'
  | 'RiderRestricted';

// ───────────────────────── order-service.yaml 0.13.1 (직원용 주문 찾기 — 주문 창 "주문" 탭) ─────────────────────────
// 사용자 2026-11-19 "여기서 다 열람할 수 있게 해": 관제 계정(OPERATOR_ADMIN)으로 이 PC 에서만
//   GET  /orders/lookups/{orderId}             직원용 주문 상세 — 배송지·요청사항은 가린 값, 조회 자체는 기록 안 함
//   POST /orders/lookups/{orderId}/pii-reveals 원문 열람 — 사유 필수, audit 열람 기록이 남은 뒤에만 원문(못 남기면 503, 원문 없음)
// 응답(특히 원문)은 화면 메모리에만 — 로그·일지·브라우저 저장소·다른 기기 금지.

export type OrderStatus =
  | 'DRAFT'
  | 'RESOURCE_PENDING'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_UNKNOWN'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'PARTIALLY_HANDED_OVER'
  | 'IN_DELIVERY'
  | 'PARTIALLY_DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED';

/** 계약 이름 ShippingAddress — 주문 당시 배송지·수령 연락처 사본. 직원 상세에서는 가린 값 */
export interface OrderShippingAddress {
  roadAddress?: string;
  detailAddress?: string;
  postalCode?: string | null;
  receiverName?: string;
  receiverPhone?: string;
  entranceMethod?: 'FREE' | 'PASSWORD' | 'CALL' | 'OTHER' | null;
  entranceNote?: string | null;
  geo?: { lat?: number; lng?: number } | null;
  capturedAt?: string;
}

/** 계약 이름 OrderLine — 화면에 쓰는 필드만 */
export interface StaffOrderLine {
  orderLineId?: string;
  sku?: string;
  productName?: string | null;
  optionLabel?: string | null;
  lineAmount?: number;
  unitPrice?: number;
  discountShare?: number;
  originalQty?: number;
  unfulfilledQty?: number;
  handedOverQty?: number;
  cancelledBeforeShipQty?: number;
  deliveredQty?: number;
  returnedQty?: number;
}

export interface StaffOrderAmounts {
  itemAmount: number;
  deliveryTipBase: number;
  deliveryTip: number;
  /** STANDARD·OVER_30000·FIRST_PURCHASE·NONE */
  deliveryTipReason: string;
  bagFee: number;
  totalAmount: number;
  /** PG 승인액 */
  approvedAmount: number;
  firstPurchaseApplied: boolean;
}

/** 계약 이름 FulfillmentIssue — 이행 확인 필요 기록 */
export interface OrderFulfillmentIssue {
  issueId?: string;
  sku?: string;
  blockedQty?: number;
  /** QUALITY_HOLD·COUNT_LOSS·SHORT·DAMAGED·BLOCKED·UNKNOWN(목록 밖이면 코드 그대로) */
  reason?: string;
  state?: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  blockedAt?: string;
}

export interface StaffOrderDetail {
  orderNumber?: string | null;
  orderId: string;
  customerId: string;
  status: OrderStatus;
  version: number;
  mfcId: string;
  deliveryMode: 'SINGLE' | 'BUNDLED' | 'SCHEDULED';
  arrivalWindow?: { date: string; start: string; end: string } | null;
  confirmedAt: string;
  outOfStockPreference?: 'CANCEL_OOS_ONLY' | 'CANCEL_ALL';
  /** 0.5.0 부터 직원 상세에서는 null(가림) — 원문은 ENTRANCE 열람 */
  deliveryNote?: string | null;
  deliveryNoteMasked?: boolean;
  amounts: StaffOrderAmounts;
  payment: { paymentAttemptId: string; pgTransactionId?: string };
  /** 가린 값(0.4.0) — 사본 없는 옛 주문은 null */
  shippingAddress?: OrderShippingAddress | null;
  shippingAddressMasked: boolean;
  lines: StaffOrderLine[];
  fulfillmentIssues: OrderFulfillmentIssue[];
}

/** 원문으로 볼 항목 — NAME 수령인 · PHONE 연락처 · ADDRESS 상세 주소 + 핀 · ENTRANCE 출입 메모 + 배송 요청사항 */
export type StaffPiiField = 'NAME' | 'PHONE' | 'ADDRESS' | 'ENTRANCE';

export interface StaffPiiRevealRequest {
  /** 2~200자, audit 에 그대로 남는다 */
  reason: string;
  /** 없으면 네 항목 모두 */
  fields?: StaffPiiField[];
}

export interface StaffPiiReveal {
  orderId: string;
  piiAccessLogId: string;
  recordedAt: string;
  fields: StaffPiiField[];
  shippingAddress: OrderShippingAddress | null;
  /** ENTRANCE 를 열었을 때만 배송 요청사항 원문 */
  deliveryNote?: string | null;
}
