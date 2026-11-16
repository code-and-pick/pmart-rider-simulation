// 백엔드 계약의 부분 사본 — 이 시뮬레이터(가상 라이더)가 부르거나 읽는 부분만.
// 이름·상태값·필드는 계약을 그대로 따른다. 계약이 바뀌면 여기를 먼저 맞추고 docs/design.md §3 표를 고친다.
//
// 기준: pmart-backend origin/main 516e7cf5 (2026-11-16 읽음 — 아래 계약은 cb2bf317 과 같은 버전)
//   contracts/openapi/delivery-dispatch-service.yaml   0.4.0
//   contracts/openapi/delivery-execution-service.yaml  0.5.0
//   contracts/openapi/delivery-tracking-service.yaml   0.4.0
//   contracts/openapi/rider-service.yaml               0.4.0
//   contracts/openapi/mfc-fulfillment-service.yaml     0.4.11 (출고 조회·포장 인계 부분만)
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

// ───────────────────────── delivery-dispatch 0.4.0 ─────────────────────────

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

/** DELIVERY 일반, CLAIM_RETURN 고객 반품 회수(아직 없음), MISDELIVERY_RECOVERY 오배송 회수(DD-2). */
export type DeliveryPurpose = 'DELIVERY' | 'CLAIM_RETURN' | 'MISDELIVERY_RECOVERY';

export type OfferState = 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'LATE' | 'SEND_FAILED' | 'SUPERSEDED';
export type OfferSource = 'AI_RECOMMENDED' | 'DELIVERY_LIST';
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

/** GET /offers 응답. pollAfterSec null = 지금은 제안을 받을 수 없음 → 상태가 바뀔 때까지 조회를 멈춘다. */
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
  vehicleType?: string;
  state?: 'ASSIGNED' | 'PICKED_UP' | 'CANCELLED' | 'COMPLETED';
  assignedAt?: string;
  bundleId?: string | null;
  stopSequence?: number | null;
  pickedUpAt?: string;
  handoverIds?: string[];
  cancelledAt?: string;
  version?: number;
}

/** 오배송 회수 배송(DD-2). pickup 은 배정된 라이더·운영자에게만 — 제안만 받은 라이더에게는 비어 있다. */
export interface RecoveryInfo {
  caseId?: string;
  originDeliveryId?: string;
  /** 운영자에게만 */
  originRiderId?: string;
  pickup?: {
    lat?: number;
    lng?: number;
    source?: 'RIDER_COMPLETION_LOCATION' | 'DROP_ADDRESS';
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

// ───────────────────────── delivery-execution 0.5.0 ─────────────────────────

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
  method?: 'SAFE_NUMBER_CALL' | 'APP_MESSAGE';
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
  | 'OTHER';

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

/** POST …/returns/store-deliveries */
export interface ReturnStoreDeliveryRequest extends TransitionRequest {
  evidenceRefs?: string[];
  receivedByStaffRef?: string;
}

export interface EvidencePhoto {
  photoRef: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  sizeBytes: number;
  uploadedAt: string;
}

export interface Evidence {
  evidenceRef?: string;
  method?: string;
  photoRefs?: string[];
  takenAt?: string;
  placement?: string;
  substituteEvidenceCaseId?: string;
}

export interface StatusHistoryEntry {
  state?: ExecutionState;
  occurredAt?: string;
  recordedAt?: string;
  actor?: 'RIDER' | 'SYSTEM_EVENT' | 'OPERATOR';
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
  deliveryId?: string;
  version?: number;
  type?: DeliveryType;
  orderId?: string;
  riderId?: string;
  mfcId?: string;
  state?: ExecutionState;
  handoverIds?: string[];
  /** 인계된 포장만 들어 있다(rider_e2e.py 주석) — 포장 목록·QR 은 RR-03 */
  packageIds?: string[];
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
  lat?: number | null;
  lng?: number | null;
}

export interface MyDeliveriesResponse {
  items?: DeliveryExecution[];
  page?: Page;
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
}

export interface StaffDeliveryListResponse {
  items?: StaffDeliverySummary[];
  page?: Page;
}

// ───────────────────────── delivery-tracking 0.4.0 ─────────────────────────

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

// ───────────────────────── rider-service 0.4.0 ─────────────────────────

export type VehicleType = 'MOTORCYCLE' | 'BICYCLE' | 'CAR' | 'WALK';
export type OperatingStatus = 'OFF_DUTY' | 'ON_DUTY';
export type AccountRestriction = 'NORMAL' | 'DISPATCH_RESTRICTED' | 'SUSPENDED' | 'TERMINATED';
export type DispatchMode = 'NORMAL' | 'AI_RECOMMENDED';

export interface DeliveryArea {
  mfcId?: string;
  zoneId?: string;
}

/** POST /riders/signups — riderId 는 토큰 주체(본문에 없음). 전화번호는 중복만 확인(같은 번호 409 DUPLICATE_RIDER). */
export interface RiderSignupRequest {
  /** ^01[0-9]{8,9}$ — 시뮬레이터 대역은 RR-02 회신 대기 */
  phone: string;
  name?: string;
  vehicleType: VehicleType;
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
  activeDeliveryCount?: number;
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

// ───────────────────────── mfc-fulfillment 0.4.11 (출고 조회·인계) ─────────────────────────

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

/** GET /shipments/{id} — OPERATOR 전용(라이더 토큰 불가). 관찰 계정으로 읽는 방식은 RR-03 회신 대기. */
export interface Shipment {
  shipmentId?: string;
  fulfillmentId?: string;
  orderId?: string;
  /** 인계 뒤에도 null 이었던 사례가 있다(MFC 시뮬레이터 R-19 — docs/design.md §5) */
  deliveryId?: string | null;
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
  | 'PickupCompleted'
  | 'DeliveryCompleted'
  | 'DeliveryFailed'
  | 'DeliveryIncidentRaised'
  | 'ReturnPickedUp'
  | 'ReturnDelivered'
  // delivery.tracking.v1
  | 'RiderLocationStale'
  // delivery.rider.v1
  | 'RiderStateChanged'
  | 'RiderRestricted';
