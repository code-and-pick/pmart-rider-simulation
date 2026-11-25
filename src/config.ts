// 시뮬레이션 기본값과 그 근거. 업무 문서·계약에 없는 수치는 이 파일에만 둔다(CLAUDE.md).
// 근거 표기: [확정] = 계약·업무 문서·백엔드 회신의 값, [가정] = 확인 전 값(출처 적음), [시뮬] = 이 시뮬레이터가 정한 값.
// 계약 = pmart-backend contracts/openapi/ (버전은 src/domain/contract.ts 머리). MOCK 이 흉내 내며 정한 값은
// docs/backend-requests.md "시뮬레이터가 정한 값"에도 적는다.

export type BackendMode = 'mock' | 'http';

/** 계약·회신에서 온 값 — 시뮬레이터가 바꾸지 않는다. MOCK 은 이 값으로 흉내 낸다. */
export const CONTRACT = {
  /** 제안 응답 대기 1분 (expiresAt = sentAt + 1분) [확정] dispatch 0.4.0 Offer.expiresAt */
  offerResponseWindowSec: 60,
  /** 반경 단계 — MFC 중심 직선거리 [확정] dispatch 0.4.0 머리(원문은 외부 참고값) */
  radiusStepsKm: [1, 2, 3] as const,
  /** 배차 재시도 최대 2회·시도 10분 [확정] dispatch 0.4.0 머리(외부 참고값) */
  dispatchMaxRetries: 2,
  dispatchAttemptDeadlineSec: 600,
  /** 배차 가능 시각 08~24시 Asia/Seoul [확정] dispatch 0.4.0 머리 */
  dispatchHours: { startHour: 8, endHour: 24 },
  /** 제안 조회 권장 간격 — 응답 pollAfterSec 이 우선, 없을 때만 [확정] 계약 "잠정 기본 5초" */
  offersPollDefaultSec: 5,
  /** [확정] dispatch 0.12.2 — 제안을 못 받는 상태(운행 종료·신규배차 끔·하나씩 배달 중·제한)면 pollAfterSec 30(null 을 주지 않음) */
  offersPollIneligibleSec: 30,
  /** 알뜰배달 묶음·배달리스트 수락 최대 3건 [확정] dispatch 0.4.0 */
  bundleMax: 3,
  deliveryListAcceptMax: 3,
  /** 연속 거절 안내 5회 [확정] dispatch 0.4.0 respondToOffer */
  consecutiveRejectionNotice: 5,
  /** 위치 업로드 한 번에 1~200점 [확정] tracking 0.4.0 LocationBatch */
  locationBatchMax: 200,
  /** 배달 중 위치가 3분 끊기면 RiderLocationStale [확정] services/delivery-tracking-service/CLAUDE.md */
  locationStaleSec: 180,
  /** 끊김 확인 간격 30초 [확정] 같은 문서 stale-check-interval */
  locationStaleCheckSec: 30,
  /** 다시 배송: 잘못 둔 곳 ↔ 실제 집 직선 200m 미만이면 원래 기사 먼저·0원, 이상이면 9,000원 결제 대기 [확정] dispatch 0.4.2 */
  redeliveryFreeRadiusM: 200,
  /** 증빙 사진 JPEG·PNG·WEBP, 10MB 이하 [확정] execution 0.5.0 */
  evidencePhotoMaxBytes: 10 * 1024 * 1024,
  /** 시험 라이더 ID 접두어 [확정] RR-01 회신 조건 3 */
  simRiderPrefix: 'RD-sim-',
  /** 시험 라이더 토큰 유효 15분, 재사용·연장 없음 [확정] RR-01 회신 조건 4 */
  riderTokenTtlSec: 900,
} as const;

export interface SimParams {
  mode: BackendMode;
  /** 실서버 /api 경로 — 개발 서버가 PMART_GATEWAY 로 넘긴다(vite.config.ts) */
  apiBase: string;
  /** X-Source-System [시뮬] (docs/backend-requests.md 연결 방식) */
  sourceSystem: string;
  /** 대상 MFC — 백엔드 LAN 시험 센터(deploy/lan/seed/seed-data.json "[시험] 부산진구 MFC"). 지점을 고르면 RIDER_SITES 값(main.tsx) */
  mfcId: string;
  /** 화면 지점 이름(RIDER_SITES.name) */
  mfcName: string;
  /**
   * MOCK MFC 좌표 = 부산진구지점 실제 주소 "부산 부산진구 동천로 109 삼한골든게이트"(지번 부전동 112-3)
   * [확정 — 사용자 지점 목록 2026-11-16, 좌표는 카카오 주소 검색]. 실서버는 이 값을 쓰지 않고 center-master 에서 읽는다(RealWorld).
   * 백엔드 시험 좌표(35.1578, 129.0597 — "서면역 부근 시험 좌표")와 약 220m 차이 — 백엔드 seed 를 이 주소로 바꾸는 것은 사용자 백엔드 작업.
   */
  mfcLocation: { lat: number; lng: number };
  /** 가상 라이더 수 [시뮬] — 실서버 인원·전화번호 대역은 RR-02 회신 대기 */
  riderCount: number;
  /** 라이더 이동 속도 m/s [시뮬] (오토바이 시내 평균 약 25km/h) */
  riderSpeedMps: number;
  /** 위치 업로드 간격 [시뮬] — 끊김 기준(CONTRACT.locationStaleSec)보다 충분히 짧게 */
  locationUploadIntervalSec: number;
  /** 수락 직후 execution 에 배정이 보일 때까지 기다리는 최대 시간 [가정] rider_e2e.py 와 같게 30초 (docs/design.md §4) */
  assignmentReflectWaitSec: number;
  /** 제안을 받은 라이더가 수락할 확률 [시뮬] — 나머지는 거절 또는 무응답 만료(P4 시나리오에서 조정) */
  acceptProbability: number;
  /** 고객 부재 확률 [시뮬] — 고객 도착 뒤 이 확률로 연락 2번·사진 → 전달 실패 등록(MOCK 조절 바, 실서버는 늘 0) */
  customerAbsentRate: number;
  /** 라이더 배정 취소 확률 [시뮬] — 수락 뒤 가게로 가다가 이 확률로 픽업 전 취소(RIDER_UNABLE, 재배차). MOCK 조절 바, 실서버는 늘 0 */
  riderCancelRate: number;
  /** 위치 끊김 확률 [시뮬] — 고객에게 가는 중 이 확률로 locationOutageSec 동안 위치를 못 올림(앱 위치 전송 멈춤). MOCK 조절 바, 실서버는 늘 0 */
  locationOutageRate: number;
  /**
   * 번호로 인계 비율 [시뮬] — QR 대신 포장 라벨 숫자로 픽업 허가(fulfillment `POST /packages/handover-code-authorizations`, F-8·R-26).
   * 라이더 앱 "번호로 인계"(pmart-clients #268)와 같은 길. 실서버도 쓴다(맞는 번호만 — 다른 길로 같은 허가를 받는 것이지 실패를 만드는 게 아니다).
   */
  handoverByCodeRate: number;
  /** 번호로 인계할 때 먼저 틀린 번호를 한 번 넣을 확률 [시뮬] — 409 HANDOVER_CODE_MISMATCH·남은 횟수 확인. MOCK 만, 실서버는 늘 0 */
  handoverCodeTypoRate: number;
  /** 위치 끊김 길이(초) [시뮬] — 끊김 기준 3분 + 확인 간격 30초보다 길게 */
  locationOutageSec: number;
  /** 가게에서 포장을 이만큼(초) 넘게 기다리면 도움요청 STORE_WAITING 한 번 [시뮬]. null = 안 함. 실서버도 보낸다(실제 지원센터 사건이 열림 — 사용자 결정 2026-11-16) */
  storeWaitHelpSec: number | null;
  /** 제안을 보고 응답하기까지 걸리는 시간 범위(초) [시뮬] */
  offerResponseDelaySec: [number, number];
  /**
   * 제안의 예상 소요 합(pickupEtaSeconds + dropEtaSeconds — dispatch 0.4.5)이 이 초를 넘으면 TOO_FAR 로 거절 [시뮬].
   * 둘 중 하나라도 없으면 보지 않는다(수락 확률만). 실서버 가상 라이더도 같은 기준. null = 보지 않음.
   */
  maxTripEtaSec: number | null;
  /** 가게에서 출고 READY 를 기다리며 다시 볼 간격 [시뮬] */
  storeWaitPollSec: number;
  /** 시험 토큰을 만료 몇 초 전에 새로 만들지 [시뮬] — 연장이 아니라 새 토큰(RR-01 조건 4) */
  tokenRenewBeforeSec: number;
  /** LAN 다른 기기 화면이 라이더 위치·상태를 다시 읽는 간격 [시뮬] (docs/design.md §6-4 — 게이트웨이 처리율 제한은 라이더마다 따로) */
  lanObserverPollSec: number;
  /** 패널 다시 그리는 박자(Hz) [시뮬] — 라이더 위치는 React 상태가 아니라 지도 오버레이를 직접 옮긴다 */
  panelHz: number;
  /** MOCK 배속 [시뮬] — 실서버는 늘 1×(MFC 시뮬레이터 SIM-1 과 같게) */
  mockTimeScale: number;
  /** 라이더 시작 위치: MFC 에서 이 거리 범위(m) 안 아무 곳 [시뮬] — 반경 단계(1→2→3km)가 보이도록 3km 안팎으로 흩는다 */
  riderStartRadiusM: [number, number];
  /** 대기 중 MFC 쪽으로 천천히 돌아오는 비율(대기 이동 속도 / riderSpeedMps) [시뮬] */
  idleDriftFactor: number;
  /** MOCK 이 다른 서비스 대신 하는 일 — 실서버에는 없는 값 */
  mock: MockParams;
  seed: number;
}

/** MOCK 전용 [시뮬] 값. docs/backend-requests.md "시뮬레이터가 정한 값"에 같이 적는다. */
export interface MockParams {
  /** 시간당 주문(배송) 수 [시뮬] */
  ordersPerHour: number;
  /** 주문 → 점원 배차 요청(패킹 시작)까지 초 범위 [시뮬] — 실제는 PDA 가 패킹 시작 때 요청 */
  pickSec: [number, number];
  /** 배차 요청 → 출하 대기(포장 끝)까지 분 범위 [시뮬] — 요청 본문의 예상 포장 시간과 같게 쓴다 */
  packMinutes: [number, number];
  /** 출고당 포장 수 범위 [시뮬] */
  packagesPerShipment: [number, number];
  /** MFC → 고객 직선거리 범위(m) [시뮬] */
  customerDistanceM: [number, number];
  /** 반경 한 단계(1→2→3km) 머무는 시간 [시뮬] — 계약은 단계만 정하고 시간은 정하지 않음. 응답 대기 1분과 같게 */
  radiusStepSec: number;
  /** 인계 허가(fence) 유효시간 [시뮬] — 계약은 fenceExpiresAt 만 정의(센터 설정값) */
  fenceTtlSec: number;
  /** 사건이 다른 서비스 사본에 반영되는 지연 범위(초) [시뮬] — 예: DeliveryAssigned → execution ASSIGNED (docs/design.md §4) */
  eventLagSec: [number, number];
  /** 포장 시간 배율 [시뮬] — 조절 바(1 = packMinutes 그대로) */
  packTimeScale: number;
  /** 쓰기 요청 응답이 사라질 확률 [시뮬] — 절반은 처리 전, 절반은 처리 뒤 응답만 사라짐(ResultUnknown → 같은 키 재전송 확인) */
  networkDropRate: number;
  /** 전달 실패 등록 → 운영자 확정까지 초 [시뮬] — MOCK 이 운영자 대신(실서버는 사람이 확정) */
  failureConfirmSec: number;
  /** 반납 인증번호 필수(execution 설정 pmart.execution.return-handover.required) [확정] 서버 기본 false — MOCK 도 같게. 켜면 번호 없는 반납이 422 */
  returnHandoverRequired: boolean;
  /** 오배송 확률 [시뮬] — 전달 완료된 배송이 나중에 오배송으로 확인될 확률(조절 바). MOCK 이 case-service 대신 MisdeliveryConfirmed */
  misdeliveryRate: number;
  /** 전달 완료 → 오배송 확인까지 초 [시뮬](고객 문의·상담원 확인) */
  misdeliveryConfirmSec: number;
  /** 고객 반품 확률 [시뮬] — 전달 완료된 배송이 나중에 반품 회수(CLAIM_RETURN, 고객 집 → MFC)가 될 확률(조절 바). MOCK 이 claim·dispatch 대신 */
  claimReturnRate: number;
  /** 전달 완료 → 반품 회수 배송 생성까지 초 [시뮬](고객 반품 신청·승인) */
  claimReturnAfterSec: number;
  /** 오배송 중 고객 잘못(잘못 둔 곳 → 실제 집 다시 배송) 비율 [시뮬] — 나머지는 라이더·시스템 잘못(MFC 회수 + 재발송) */
  customerFaultShare: number;
  /** 고객 잘못일 때 잘못 둔 곳 ↔ 실제 집 직선 거리 범위(m) [시뮬] — 200m 미만이면 원래 기사 먼저(0원), 이상이면 결제 대기 [확정 기준값 200m — dispatch 0.4.2] */
  redeliveryDistanceM: [number, number];
  /** 결제 대기에서 고객이 결제할 확률 [시뮬] — 나머지는 회수 후 환불(다시 배송 취소 + MFC 회수 배송) */
  redeliveryPayProbability: number;
  /** 결제 대기 → 결제(또는 거절)까지 초 [시뮬](order-orchestration·고객 앱 대신) */
  redeliveryPaySec: number;
  /** 제안 예상 소요(pickupEtaSeconds·dropEtaSeconds) = 직선 km × 이 초 [시뮬] — 도로 배율 1.3 ÷ 라이더 속도 7m/s ≈ 186초/km. MOCK 에는 길찾기가 없다(실서버는 카카오모빌리티) */
  etaSecPerStraightKm: number;
  /** 주문 한 건의 품목 줄 수 범위 [시뮬] — 제안·수행 조회 주문 요약(order 대신) */
  orderLines: [number, number];
  /** 품목 한 줄 수량 범위 [시뮬] */
  lineQty: [number, number];
  /** 품목 단가 범위(원) [시뮬] */
  unitPriceWon: [number, number];
}

export const DEFAULT_PARAMS: SimParams = {
  mode: 'mock',
  apiBase: '/api/v1',
  sourceSystem: 'rider-simulator',
  mfcId: 'MFC-BJG-01',
  mfcName: '부산진구 MFC',
  mfcLocation: { lat: 35.158501, lng: 129.062021 },
  riderCount: 5,
  riderSpeedMps: 7,
  locationUploadIntervalSec: 5,
  assignmentReflectWaitSec: 30,
  acceptProbability: 0.9,
  customerAbsentRate: 0,
  riderCancelRate: 0,
  locationOutageRate: 0,
  handoverByCodeRate: 0.3,
  handoverCodeTypoRate: 0.3,
  locationOutageSec: 240,
  storeWaitHelpSec: 600,
  offerResponseDelaySec: [3, 15],
  maxTripEtaSec: 2400,
  storeWaitPollSec: 5,
  tokenRenewBeforeSec: 60,
  lanObserverPollSec: 5,
  panelHz: 4,
  mockTimeScale: 1,
  riderStartRadiusM: [300, 3200],
  idleDriftFactor: 0.5,
  mock: {
    ordersPerHour: 12,
    pickSec: [60, 240],
    packMinutes: [3, 6],
    packagesPerShipment: [1, 2],
    customerDistanceM: [600, 3000],
    radiusStepSec: 60,
    fenceTtlSec: 120,
    eventLagSec: [0.5, 3],
    packTimeScale: 1,
    networkDropRate: 0,
    failureConfirmSec: 60,
    returnHandoverRequired: false,
    misdeliveryRate: 0,
    misdeliveryConfirmSec: 300,
    claimReturnRate: 0,
    claimReturnAfterSec: 600,
    customerFaultShare: 0.5,
    redeliveryDistanceM: [60, 450],
    redeliveryPayProbability: 0.7,
    redeliveryPaySec: 180,
    etaSecPerStraightKm: 186,
    orderLines: [1, 4],
    lineQty: [1, 3],
    unitPriceWon: [1500, 15000],
  },
  seed: 1,
};

/**
 * 실서버 가상 라이더 운행 잠금. 가입·운행은 백엔드에 데이터를 남긴다. 탈퇴(rider 0.6.0)는 있으나 같은 ID 로 다시 가입할 수 없고,
 * 마지막 완료 5시간 뒤에야 된다(RR-07 회신 2026-11-18) — 새 라이더는 새 번호(RD-sim-03 …)로.
 * 2026-11-16 사용자 "시험 번호로 시작"(RR-02 를 사용자가 정함): 운행·가입 허용, 2명, 전화 010-0000-00NN.
 * - operationAllowed: 실서버 화면에서 가상 라이더를 움직일 수 있나(운행 ON·위치·수락·인계·완료 = 쓰기)
 * - signupAllowed: 미가입 라이더를 가입시킬 수 있나(false 면 미가입 라이더는 멈춘다)
 * - riderCount: 실서버에서 움직이는 시뮬레이터 라이더 수(RD-sim-01 부터)
 * 사용자 결정 없이 늘리거나 풀지 않는다(CLAUDE.md).
 */
export const REAL_RIDER_GATE: { operationAllowed: boolean; signupAllowed: boolean; riderCount: number } = {
  operationAllowed: true,
  signupAllowed: true,
  // 2026-11-22 사용자 "RD-sim-03·04 새로 가입"(4명)은 LAN 가입 휴대폰 번호 확인(422 PHONE_NOT_VERIFIED, RR-10)에 막힘 →
  // 2026-11-23 사용자 "01·02를 목포로 돌려 쓰기" — 2명 그대로, 지점을 바꾸면 배달지역을 그 MFC 로(PATCH /riders/me)
  riderCount: 2,
};

/**
 * 실서버 운행 지킴이(개발 서버 `server/operationWatch.ts`, 사용자 2026-11-24 "진행해").
 * 운행은 브라우저 페이지가 돌린다 — 창이 닫히거나(2026-11-24 두 번) 가려져 멈추면(10:11~12:05) 라이더가 ON_DUTY 로 남아 실제 제안이 간다.
 * 페이지가 운행 중 맥박을 보내고, 맥박이 끊기거나 페이지가 떠나면 개발 서버가 그 라이더를 OFF_DUTY(진행 중 배송이 있어 409 면 신규배차만 끔).
 */
export const OPERATION_WATCH = {
  /** 맥박 간격 [시뮬] — 가려진 탭은 Chrome 이 화면 타이머를 분당 1회까지 늦추지만 박자는 Worker 라 덜 늦다 */
  beatSec: 15,
  /** 이만큼 맥박이 없으면 멈춘 페이지로 본다 [시뮬] — 분당 1회로 늦춰져도 두 번은 놓쳐야 넘는 값 */
  timeoutSec: 150,
  /** 개발 서버가 끊김을 살피는 간격 [시뮬] */
  checkSec: 10,
} as const;

/**
 * 라이더 시뮬레이터 지점(MFC) — 1호점 부산·2호점 목포(사용자 2026-11-22, mfc 시뮬레이터 R-39 와 같은 센터 ID)·3호점 세종·4호점 춘천·5호점 부산남구(2026-11-24, PC1 백엔드 세션이 사용자 요청 전달).
 * 주소 `?mfc=MFC-MOKPO-01` 로 고르고, 머리줄 단추로 바꾼다(바꾸면 페이지를 새로 연다 — 브라우저 저장소에 두지 않음).
 * 배차 규칙은 지점마다 같다(운행 중·신규배차 켬·NORMAL·배달지역에 그 mfcId — 백엔드 변경 없음).
 */
export interface RiderSite {
  id: string;
  /** 화면 이름 */
  name: string;
  /** 단추 글 */
  short: string;
  /** MOCK MFC 좌표·실서버 센터를 읽기 전 지도 자리. 실서버는 center-master 값이 정본 */
  mfcLocation: { lat: number; lng: number };
  /** MOCK 고객·라이더 출발 자리를 고를 방향(북쪽 0°, 시계 방향, [시작, 끝] — 0° 를 넘어가도 됨). 없으면 사방. 바다 쪽을 빼려고 [시뮬] */
  landBearingDeg?: readonly [number, number];
  /** MOCK 주문 배송지(가린 값)의 동네·우편번호 앞자리 [시뮬] */
  mockAddress: { area: string; postalCode: string };
  /** 실서버에서 이 지점에 쓰는 시뮬레이터 라이더 번호(0 부터 — simRiderId·simRiderPhone). REAL_RIDER_GATE.riderCount 안에서만. 모든 지점이 같은 01·02 를 돌려 씀(운행을 켤 때 배달지역을 그 지점으로) */
  realRiderIndexes: readonly number[];
}
export const RIDER_SITES: readonly RiderSite[] = [
  // 부산진구지점 '부산 부산진구 동천로 109' [확정 — 사용자 지점 목록 2026-11-16, 카카오 주소 검색] · 센터 ID 2026-11-24 R-46 MFC-SEED-01 → MFC-BJG-01 [확정 — 백엔드 3871061b, 기록은 DB 에서 옮겨짐·옛 ID 별칭 없음]
  { id: 'MFC-BJG-01', name: '부산진구 MFC', short: '1호점 부산', mfcLocation: { lat: 35.158501, lng: 129.062021 }, mockAddress: { area: '부산 부산진구', postalCode: '47000' }, realRiderIndexes: [0, 1] },
  // 목포 MFC "백년대로 352" 센터 좌표 [확정 — center-master MFC-MOKPO-01 등록값, 라이더 백엔드 세션 2026-11-23]. 실서버는 center-master 라이더용 픽업지(인계 위치)를 읽음
  { id: 'MFC-MOKPO-01', name: '목포 MFC', short: '2호점 목포', mfcLocation: { lat: 34.7985, lng: 126.4334 }, mockAddress: { area: '전남 목포시', postalCode: '58700' },
    // 센터 남쪽·동남쪽 3km 안은 영산강 하구(바다) — 서쪽 260°에서 북쪽을 돌아 동쪽 80°까지만(카카오 지도로 확인 2026-11-23)
    landBearingDeg: [260, 80], realRiderIndexes: [0, 1] },
  // 세종 MFC "다솜1로 36 엠브릿지 3층" 센터 좌표 [확정 — center-master MFC-SEJ-01 등록값, PC1 백엔드 세션 2026-11-24]. 내륙이라 방향 제한 없음
  { id: 'MFC-SEJ-01', name: '세종 MFC', short: '3호점 세종', mfcLocation: { lat: 36.5017504, lng: 127.2573522 }, mockAddress: { area: '세종특별자치시', postalCode: '30100' }, realRiderIndexes: [0, 1] },
  // 춘천 MFC "춘천로 236 2층" 센터 좌표 [확정 — center-master MFC-CHC-01 등록값, PC1 백엔드 세션 2026-11-24]
  { id: 'MFC-CHC-01', name: '춘천 MFC', short: '4호점 춘천', mfcLocation: { lat: 37.8782993, lng: 127.7400726 }, mockAddress: { area: '강원 춘천시', postalCode: '24300' },
    // 센터 서북쪽·북쪽 2km 밖은 소양강·의암호 — 북북동 20°에서 동·남을 돌아 서남서 240°까지만(카카오 지도로 확인 2026-11-24)
    landBearingDeg: [20, 240], realRiderIndexes: [0, 1] },
  // 부산남구 MFC "수영로 305 스파크타워 지하 1층" 센터 좌표 [확정 — center-master MFC-BNG-01 등록값, PC1 백엔드 세션 2026-11-24]
  { id: 'MFC-BNG-01', name: '부산남구 MFC', short: '5호점 부산남구', mfcLocation: { lat: 35.1373386, lng: 129.0992709 }, mockAddress: { area: '부산 남구', postalCode: '48400' },
    // 센터 동북동~동쪽 2km 밖은 수영만(광안리 바다) — 남동 130°에서 남·서를 돌아 북북동 30°까지만(카카오 지도로 확인 2026-11-24)
    landBearingDeg: [130, 30], realRiderIndexes: [0, 1] },
];

/** 주소 ?mfc= 의 지점(모르면 1호점) */
export function riderSite(id: string | null | undefined): RiderSite {
  return RIDER_SITES.find((s) => s.id === id) ?? (RIDER_SITES[0] as RiderSite);
}

/** MOCK 자리 방향 — 0~1 난수 하나를 지점의 땅 쪽 방향(landBearingDeg)으로. 없으면 0~360° */
export function siteBearing(site: RiderSite, r01: number): number {
  if (!site.landBearingDeg) return r01 * 360;
  const [from, to] = site.landBearingDeg;
  const span = (((to - from) % 360) + 360) % 360 || 360;
  return (from + r01 * span) % 360;
}

/** 이 지점의 실서버 시뮬레이터 라이더 번호 — 사용자가 정한 인원(REAL_RIDER_GATE.riderCount) 밖은 뺀다 */
export function siteRealRiderIndexes(site: RiderSite, riderCount: number): number[] {
  return site.realRiderIndexes.filter((i) => i >= 0 && i < riderCount);
}

/** 이 거리(m) 안이면 길찾기 없이 곧장 간다 [시뮬] — 카카오모빌리티는 출발·도착이 같거나 아주 가까우면 경로를 주지 않는다(NO_ROUTE, 2026-11-23 목포 D27932024) */
export const ROUTE_NEAR_SKIP_M = 50;

/** 시뮬레이터 라이더 시험 전화번호 `010-0000-00NN` [확정 — 사용자 2026-11-16 "시험 번호로", RR-02]. 실제 배정 번호인지는 확인 안 함. */
export function simRiderPhone(index: number): string {
  return `0100000${String(index + 1).padStart(4, '0')}`;
}

/** 시뮬레이터 라이더 ID — `RD-sim-01` 형식 [시뮬] (접두어는 [확정] RR-01, 번호 규칙은 RR-02 회신 전 임시). */
export function simRiderId(index: number): string {
  return `${CONTRACT.simRiderPrefix}${String(index + 1).padStart(2, '0')}`;
}

export function isSimRiderId(riderId: string): boolean {
  return riderId.startsWith(CONTRACT.simRiderPrefix) && riderId.length > CONTRACT.simRiderPrefix.length;
}


/**
 * 운영 화면(라이더 백오피스) 주소 — 시뮬레이터 "운영 화면" 탭이 새 탭으로 연다(사용자 2026-11-17 "백오피스에 만들고 시뮬에 탭").
 * [확정] 개발 = pmart-clients `web/rider-backoffice` 목 모드 포트 5176, LAN = PC 4 nginx 8446(`docs/apps/rider-backoffice-web.md`).
 */
export const OPS_BACKOFFICE = {
  dev: 'http://localhost:5176',
  lan: 'https://192.168.0.40:8446',
} as const;
/**
 * 관제 화면 지연·이상 기준(화면 알림만 — 배송 상태를 바꾸지 않는다). 업무 문서에 정한 값이 없어 모두 [가정](2026-11-18 관제 화면 개선).
 * 시간은 실서버 = 실제 초, MOCK = 시뮬레이션 초.
 */
/**
 * MOCK 주문 창 "주문" 탭의 가상 주문(실서버 order-service 직원용 주문 상세 흉내, 2026-11-19) — 금액·배송지·요청사항 모두 가짜.
 */
/** MOCK 가상 라이더 운송수단 — 라이더 번호 순서로 돌아가며(지도 그림이 여러 가지로 보이게) [시뮬]. 이동 속도는 수단과 상관없이 같다 */
export const MOCK_RIDER_VEHICLES = ['MOTORCYCLE', 'BICYCLE', 'E_BIKE', 'KICKBOARD', 'CAR', 'WALK'] as const;

export const MOCK_ORDER = {
  /** 기본 배달팁(원) [시뮬] */
  deliveryTipWon: 3000,
  /** 상품 금액이 이 값 이상이면 배달팁 0(사유 OVER_30000) [가정 — 계약 deliveryTipReason 이름에서] */
  freeTipOverWon: 30000,
  /** 요청사항이 있는 주문 비율 [시뮬] */
  noteRate: 0.5,
} as const;

export const OPS_THRESHOLDS = {
  /** 배차 요청 뒤 라이더를 못 찾은 채 이만큼 지나면 주의 [가정] — 반경 1→2→3km 단계가 도는 시간쯤 */
  searchWarnSec: 5 * 60,
  /** …이만큼이면 심각 [가정] */
  searchBadSec: 10 * 60,
  /** 가게 도착 뒤 픽업(인계)까지 이만큼 넘으면 주의 [가정] — 라이더 도움요청 STORE_WAITING(10분)과 같게 */
  storeWaitWarnSec: 10 * 60,
  /** 배송 생성부터 끝나지 않은 채 이만큼 넘으면 지연 [가정] — 가상 라이더가 받는 제안 상한(maxTripEtaSec 40분)과 같게 */
  lateTotalSec: 40 * 60,
  /** 최근 이 시간 안 요청 실패가 failBurstCount 이상이면 알림 [가정] */
  failBurstWindowSec: 60,
  failBurstCount: 3,
} as const;
