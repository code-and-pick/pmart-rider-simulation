import type {
  AssignmentCancellationRequest,
  Center,
  CommandResponse,
  CompletionRequest,
  Delivery,
  DeliveryExecution,
  DeliveryListResponse,
  DispatchSettings,
  DomainEventType,
  DropInfo,
  EvidencePhoto,
  ExecutionState,
  FailureRequest,
  HandoverAuthorization,
  HandoverAuthorizationRequest,
  HandoverCodeAuthorizationRequest,
  HandoverCommitRequest,
  HandoverCommitResult,
  HandoverResolution,
  HelpRequest,
  HelpRequestCreate,
  LocationBatch,
  MyDeliveriesResponse,
  Offer,
  OfferListResponse,
  OfferResponseRequest,
  OfferResponseResult,
  OperatingState,
  OperatingStateRequest,
  OfferState,
  PickupPointList,
  PickupRequest,
  ReturnPickupRequest,
  ReturnStoreDeliveryRequest,
  RiderLocation,
  RiderProfile,
  RiderSignupRequest,
  ReturnHandover,
  RiderDisplayNames,
  Shipment,
  StaffDeliveryListResponse,
  TransitionRequest,
  Withdrawal,
  WithdrawalRequest,
} from '../domain/contract';

/**
 * 가상 라이더(시뮬레이터)가 백엔드에 대해 하는 일 (docs/design.md §5).
 * 메서드 하나가 계약의 API 하나에 대응한다. 구현은 MockBackend(계약 의미를 브라우저 안에서 흉내 — P1)와
 * HttpBackend(게이트웨이 /api/v1 실호출 — P2·P3) 두 가지다. 시뮬레이터 엔진(src/sim)은 이 인터페이스만 보고 움직인다.
 *
 * 규칙
 * - 라이더 API 는 토큰 주체가 곧 라이더다(`/riders/me`, `/offers` 에 riderId 가 없다). 그래서 라이더별 창구 `asRider(riderId)` 로 부른다.
 *   HttpBackend 는 그 라이더의 시험 토큰(RR-01 — 개발 서버가 서명, `RD-sim-` 만)을 붙인다.
 * - 쓰기는 호출자가 Idempotency-Key 를 정해 넘긴다. 응답이 없으면 ResultUnknown 을 던지고, 호출자는 같은 키로 다시 보내거나 조회로 확인한다.
 * - 백엔드 거절은 ApiProblem(상태 코드·code). 서버가 확정한 결과만 확정으로 그린다.
 * - 이 포트에는 계약에 있는 API 만 둔다. 추측한 엔드포인트를 더하지 않는다.
 */
export interface RiderPort {
  readonly mode: 'mock' | 'http';

  /** 라이더 한 명의 창구. riderId 는 `RD-sim-` 접두어여야 한다(RR-01 조건 3 — 실서버는 서명 함수가 거절). */
  asRider(riderId: string): RiderApi;

  /**
   * 관찰용 직원 계정 조회 — 라이더 토큰으로는 못 보는 것(출고·포장 QR 등).
   * 실서버 방식은 RR-03 회신 대기(관찰 계정 `claude-mfc-wrk` 로 읽기만 하는 안).
   */
  readonly observer: ObserverApi;

  onApiCall(listener: ApiListener): () => void;
  onEvent(listener: EventListener): () => void;
}

export interface WriteOptions {
  idempotencyKey: string;
  /** 낙관적 잠금 X-Expected-Version */
  expectedVersion?: number;
}

/** 라이더 본인 토큰으로 부르는 API. */
export interface RiderApi {
  readonly riderId: string;

  // ── rider-service 0.4.0 ──
  /** 404 = 미가입 */
  getMe(): Promise<RiderProfile>;
  signup(body: RiderSignupRequest, opts: WriteOptions): Promise<RiderProfile>;
  getOperatingState(): Promise<OperatingState>;
  setOperatingState(body: OperatingStateRequest, opts: WriteOptions): Promise<OperatingState>;
  getDispatchSettings(): Promise<DispatchSettings>;
  setDispatchSettings(body: DispatchSettings, opts: WriteOptions): Promise<DispatchSettings>;
  /** 탈퇴 신청 — 백엔드는 아직 501(RR-07). 진행 중 배송·미정산 수행료·제한 조사 중이면 409 */
  withdraw(body: WithdrawalRequest, opts: WriteOptions): Promise<CommandResponse>;
  getWithdrawal(requestId: string): Promise<Withdrawal>;

  // ── delivery-tracking 0.4.0 ──
  uploadLocations(body: LocationBatch, opts: WriteOptions): Promise<CommandResponse>;
  /** 404 = 아직 올린 위치 없음 */
  getLatestLocation(): Promise<RiderLocation>;

  // ── delivery-dispatch 0.4.0 ──
  /** state 생략 = SENT·미만료. pollAfterSec 을 따른다 */
  listOffers(query?: { state?: OfferState; size?: number; cursor?: string }): Promise<OfferListResponse>;
  /** 처음 조회 시각이 viewedAt 으로 남는다 */
  getOffer(offerId: string): Promise<Offer>;
  respondToOffer(offerId: string, body: OfferResponseRequest, opts: WriteOptions): Promise<OfferResponseResult>;
  listDeliveryList(): Promise<DeliveryListResponse>;
  /** 계약상 응답 스키마가 제안 응답과 같다(OfferResponseResult) */
  acceptFromDeliveryList(deliveryId: string, opts: WriteOptions): Promise<OfferResponseResult>;
  getDispatch(deliveryId: string): Promise<Delivery>;
  /** 픽업 전만. 뒤면 422 PICKED_UP_CASE_REQUIRED */
  cancelAssignment(deliveryId: string, body: AssignmentCancellationRequest, opts: WriteOptions): Promise<CommandResponse>;

  // ── delivery-execution 0.5.0 ──
  getExecution(deliveryId: string): Promise<DeliveryExecution>;
  listMyDeliveries(query?: { date?: string; state?: ExecutionState; size?: number; cursor?: string }): Promise<MyDeliveriesResponse>;
  reportStoreArrival(deliveryId: string, body: TransitionRequest, opts: WriteOptions): Promise<CommandResponse>;
  /** 상태는 PackageHandedOver 로 바뀐다 — 이 호출은 확인만(docs/design.md §5-6) */
  reportPickup(deliveryId: string, body: PickupRequest, opts: WriteOptions): Promise<CommandResponse>;
  /** 개인정보 — lat·lng 만 쓰고 저장·로그·화면에 남기지 않는다 */
  getDropInfo(deliveryId: string): Promise<DropInfo>;
  reportCustomerArrival(deliveryId: string, body: TransitionRequest, opts: WriteOptions): Promise<CommandResponse>;
  /** multipart file — JPEG·PNG·WEBP, 10MB 이하 */
  uploadEvidencePhoto(deliveryId: string, file: Blob, opts: WriteOptions): Promise<EvidencePhoto>;
  reportCompletion(deliveryId: string, body: CompletionRequest, opts: WriteOptions): Promise<CommandResponse>;
  reportFailure(deliveryId: string, body: FailureRequest, opts: WriteOptions): Promise<CommandResponse>;
  createHelpRequest(deliveryId: string, body: HelpRequestCreate, opts: WriteOptions): Promise<CommandResponse>;
  getHelpRequest(deliveryId: string, requestId: string): Promise<HelpRequest>;
  /** 오배송 회수(MISDELIVERY_RECOVERY)만 — docs/design.md §3-1 */
  reportReturnPickup(deliveryId: string, body: ReturnPickupRequest, opts: WriteOptions): Promise<CommandResponse>;
  reportReturnStoreDelivery(deliveryId: string, body: ReturnStoreDeliveryRequest, opts: WriteOptions): Promise<CommandResponse>;

  // ── center-master 0.2.0 ──
  /** 라이더용 MFC 픽업지 목록(ACTIVE 만, 인계 위치 포함) — MFC 위치를 라이더 앱과 같은 길로 */
  listMfcPickupPoints(): Promise<PickupPointList>;

  // ── mfc-fulfillment 0.4.11 (인계) ──
  authorizeHandover(packageId: string, body: HandoverAuthorizationRequest, opts: WriteOptions): Promise<HandoverAuthorization>;
  /** 라벨 숫자로 인계 허가(QR 이 안 찍힐 때) — 응답은 QR 허가와 같다(packageId 포함). */
  authorizeHandoverByCode(body: HandoverCodeAuthorizationRequest, opts: WriteOptions): Promise<HandoverAuthorization>;
  commitHandover(packageId: string, body: HandoverCommitRequest, opts: WriteOptions): Promise<HandoverCommitResult>;
  getHandoverResolution(packageId: string): Promise<HandoverResolution>;
}

/** 관찰 직원 계정으로 읽기만 하는 API. 쓰기는 없다. */
export interface ObserverApi {
  /** execution 직원 배송 찾기 (mfcId 를 주어야 한다 — 그 센터 권한) */
  searchDeliveries(query: {
    mfcId: string;
    orderId?: string;
    riderId?: string;
    state?: ExecutionState;
    sort?: 'NEWEST' | 'OLDEST';
    size?: number;
    cursor?: string;
  }): Promise<StaffDeliveryListResponse>;
  getExecution(deliveryId: string): Promise<DeliveryExecution>;
  getDispatch(deliveryId: string): Promise<Delivery>;
  /** 포장 qrCode 를 얻는 길(RR-03) */
  getShipment(shipmentId: string): Promise<Shipment>;
  /** 반납 인증번호(execution 0.28.0) — MFC 직원 화면 목록. 반납 때 라이더가 넣는다(RR-09) */
  listReturnHandovers(mfcId: string): Promise<{ items: ReturnHandover[] }>;
  /** rider 0.18.0 라이더 화면 표기(번호·가린 이름) 묶음 — 50개까지(ADR-0070) */
  getRiderDisplayNames(riderIds: readonly string[]): Promise<RiderDisplayNames>;
  /** center-master 센터 조회 — MFC 위치의 정본(배차 반경 기준) */
  getCenter(centerId: string): Promise<Center>;
}

/** API 호출 기록 — 화면 "API 로그". 토큰·주소·전화번호는 넣지 않는다(RR-01 조건 6: 라이더 ID·경로·상태 코드만). */
export interface ApiCallRecord {
  /** 시뮬레이션 시각(초) */
  at: number;
  /** 'observer' = 관찰 계정 */
  actor: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  path: string;
  status: number | 'ERR';
  code?: string;
  ms: number;
  note?: string;
}

/** 계약 사건 이름 그대로의 기록. 실서버는 사건을 구독하지 못하므로 조회 결과로 추정한 것은 inferred 로 밝힌다. */
export interface DomainEventRecord {
  at: number;
  type: DomainEventType;
  summary: string;
  /** true = 사건을 받은 것이 아니라 REST 조회 결과로 추정 */
  inferred?: boolean;
  /** 화면에서 라이더·배송별로 거르려고(계약 사건 본문이 아니다) */
  riderId?: string;
  deliveryId?: string;
}

export type ApiListener = (rec: ApiCallRecord) => void;
export type EventListener = (rec: DomainEventRecord) => void;
