# 배송·라이더 가상 현장(시뮬레이터) → pmart-backend 요청 목록

> 시뮬레이터는 `../pmart-backend` 를 **읽기만** 한다. 아래는 실서버 연동에 필요한 백엔드 쪽 변경·결정이다.
> 기준: 2026-11-16 최초 작성, 백엔드 `main` `aa46ce11`. 계약 버전: delivery-dispatch 0.3.3, delivery-execution 0.4.0, delivery-tracking 0.3.0, rider-service 0.4.0, rider-auth 0.1.0, mfc-fulfillment 0.4.11.
> 원칙(MFC 시뮬레이터와 같음): **백엔드 계약이 정본, 시뮬레이터와 안 맞는 부분은 시뮬레이터가 맞춘다.**
> 번호: **RR-xx**(rider 시뮬레이터 요청). MFC 시뮬레이터 요청(R-xx, `../pmart-mfc-simulation/docs/backend-requests.md`)과 번호가 겹치지 않게 2026-11-16 R → RR 로 바꿨다.
> 전달: 백엔드는 이 저장소를 읽기만 하고 회신은 백엔드 `docs/handoff/simulator/rider/` 에 RR 번호로 남긴다(목록 = 그 폴더 README). 백엔드 담당 = delivery 영역(PC 5), 토큰·인증 = platform(PC 1). 회신이 오면 위치·날짜를 적고 "해소"로 옮긴다.
> 기준 갱신: 백엔드 `cb2bf317` — delivery-dispatch 0.4.0, delivery-execution 0.5.0, delivery-tracking 0.4.0(DD-2 오배송 회수). 다시 `347ea90d` — dispatch 0.4.1, mfc-fulfillment 0.5.0.
> **전달 방식 바뀜(사용자 2026-11-16 "백엔드도 내가 하니까 PR 전달할 필요 없어")**: 백엔드도 사용자가 직접 맡는다. 이 목록은 사용자가 보는 기록이고, 백엔드 handoff·PR 로 따로 보내지 않는다. 결정은 사용자에게 바로 묻는다.

## 연결 방식 (백엔드가 알아야 할 전제)

- **역할**: 시뮬레이터 한 대가 라이더 앱 여러 대를 연기한다. MFC 쪽(실제 PDA·MFC 시뮬레이터)은 건드리지 않고, 점원 배차 요청 뒤 생긴 제안만 받는다.
- **경로**: 브라우저 → Vite 개발 서버 `/api` 프록시 → 게이트웨이(`PMART_GATEWAY`) → 공개 계약 API. `/internal/*` 업무 API 는 부르지 않는다.
- **원칙**: 계약에 있는 API 만. 응답이 없으면 결과 불명으로 보고 같은 `Idempotency-Key` 로 재전송. `X-Source-System: rider-simulator`.

## 열린 요청

### RR-10 시뮬레이터 라이더 새 가입이 휴대폰 번호 확인(OCTOMO)에 막힘 — 열림 2026-11-23 (사용자 결정 필요)
- 계기: 2호점 목포용 RD-sim-03·04 가입(사용자 2026-11-22 "RD-sim-03·04 새로 가입") — 2026-11-23 00:27 이 PC 실서버 화면 "가상 라이더 운행" → 두 라이더 모두 `POST /riders/signups` 422 **PHONE_NOT_VERIFIED** → 멈춤. 가입·운행 상태 변경 없음(만들어진 것 없음).
- 까닭: LAN rider-service 에 `pmart.rider.phone-verification.required` 가 켜져 있다(rider 0.17.0 — 켜지면 가입에 VERIFIED `phoneVerificationId` 필수). 확인은 OCTOMO MO 방식(그 번호 휴대폰에서 대표번호로 숫자 문자를 실제로 보내야 VERIFIED) — 시험 번호 010-0000-00NN 은 실제 휴대폰이 아니라 시뮬레이터가 통과할 수 없다. 시뮬레이터가 확인을 흉내 내거나 우회하지 않는다.
- 사용자가 고를 것(백엔드는 사용자 몫): ① LAN 에서 그 설정을 끔 ② 시뮬레이터 라이더(`RD-sim-` 주체·010-0000 대역)만 번호 확인을 건너뛰는 시험 설정 ③ 사용자가 관리자 경로로 03·04 를 만들어 줌 ④ 목포는 지금 있는 01·02 를 배달지역 바꿔 씀(가입 없음).

### RR-08 실서버 화면에 라이더 앱 라이더 위치·정확한 전달지 — 해소 2026-11-18(위치·전달지 모두 반영)
- 계기: 사용자가 라이더 앱으로 배차 수락 → 가게로 이동했는데(배송 `DLV-665800db…`, 라이더 `RD-5c41a0e7…`, 2026-11-18 12:15:24 배정 → 12:18:56 배정 취소·픽업 전 취소) 시뮬레이터 실서버 화면에 라이더 위치·전달지가 안 떴다.
- 지금 못 하는 이유(백엔드 `aaa2ff8c` 계약 읽음):
  - 라이더 위치: 실서버 화면은 `RD-sim-` 라이더 본인 토큰 `GET /riders/me/locations/latest` 만 읽는다. 관제 `GET /rider-locations`(tracking 0.8.0, 운행 중 라이더 현재 위치)는 RIDER_OPS·OPERATOR_ADMIN 만 — 관찰 계정(`claude-mfc-wrk`, MFC 점원)으로 부르면 **403** "라이더 관제는 라이더 운영·관리자만"(2026-11-18 실측).
  - 전달지: 정확한 좌표를 주는 공개 API 는 `GET /deliveries/{id}/drop-info`(execution 0.22.2, **배정 라이더 본인·픽업 뒤**)뿐. 직원·운영자용은 없다. `GET /internal/deliveries/{id}/route-points`(dispatch, drop 좌표)는 서비스 간 전용·응답 저장 금지라 시뮬레이터는 부르지 않는다. 제안 요약 `dropAreaPoint`(약 1km 격자)는 제안 받은 라이더에게만.
- 필요한 것(사용자가 백엔드도 맡음 — 결정):
  1. 라이더 위치: 시뮬레이터 관찰용 **라이더 운영(RIDER_OPS) 읽기 계정**을 LAN 비밀 파일로(`deploy/lan/.secrets/`, 이름만 확인·내용 안 읽음). 있으면 개발 서버가 그 계정 토큰으로 `GET /rider-locations?mfcId=` 를 불러 지도에 운행 중 라이더 전원(라이더 앱 포함)을 그린다 — 다른 기기에는 지금처럼 개발 서버가 붙이는 조회만.
  2. 정확한 전달지: 운영자(RIDER_OPS·OPERATOR_ADMIN)가 진행 중 배송의 전달지 좌표를 읽는 공개 API 가 백엔드에 새로 있어야 한다(열람 사유·기록 여부는 백엔드 결정). 생기면 시뮬레이터는 좌표만 이 PC 화면 지도에 그리고 주소 글자·전화는 쓰지 않는다·저장·로그 안 함, 다른 기기로는 넘기지 않는다(`server/lanPolicy.ts` 개인정보 경로).
- 시뮬레이터 쪽: 계정·API 가 생기기 전에는 코드 변경 없음(계약에 없는 길을 추측해 부르지 않는다).
- **1번(라이더 위치) 반영 2026-11-18** — 사용자 "1번으로 해 … 라이더가 어딘지 알아야 MFC쪽도, 고객센터도 대응이 가능" → 새 계정 대신 있는 관리자 계정 `claude-dev`(OPERATOR_ADMIN, 비밀 파일 `keycloak-claude-dev-password` — 이름만 확인) 사용(사용자 "claude-dev 써").
  조건: 개발 서버가 **이 PC 의 `GET /api/v1/rider-locations` 에만** 그 토큰을 붙인다(`X-Sim-Actor: control`, 다른 경로는 403 CONTROL_READ_ONLY — `server/lanPolicy.ts` `isControlRead`), 다른 기기는 경로 자체가 막힘(백엔드가 라이더 위치를 운영·관리자에게만 보이므로), 비밀번호 거절(400·401)이면 개발 서버를 다시 켤 때까지 재시도 안 함(같이 쓰는 계정 잠금 방지). 실측: 200, 같은 헤더로 다른 경로 403.
  2번(정확한 전달지) **반영 2026-11-18** — 백엔드가 execution 0.24.0 직원용 전달지 `GET /deliveries/{id}/drop-location`(RIDER_OPS·OPERATOR_ADMIN, 주소·좌표만, 응답 전 개인정보 열람 기록, 배정 ~ 전달 전만)을 만듦(백엔드 `c902fb2f` 읽음). 사용자 "주소까지 보이게" → 실서버 화면 고른 배송 상세에 주소·좌표(지도 핀), 이 PC·관제 계정만, 고를 때 한 번(열람 기록이 박자마다 쌓이지 않게), 화면 메모리에만.

### RR-03 포장 QR 값을 라이더 쪽에서 얻는 방법 — 해소 2026-11-18
- 회신: 백엔드 `docs/handoff/simulator/rider/2026-11-18-backend-reply-rr03-rr05-rr07.md`(보낸 영역 delivery, 사용자 2026-11-18 "응 전부 진행해") — **그 방식으로 괜찮다**. 관찰용 직원 계정(읽기만)으로 `GET /shipments/{shipmentId}` 의 qrCode = "라벨을 본다". 백엔드 변경 없음, 쓰기(인계 허가·확정)는 라이더 토큰으로만. 시뮬레이터는 이미 이 방식(`HttpBackend.getShipment`·`server/lanPolicy.ts` OBSERVER) — 바꿀 것 없음.
인계 허가에는 포장 `qrCode`(`PKG:<id>:<버전>`)가 필요하다. 실제로는 포장 라벨을 찍지만, 라이더 토큰으로는 출고·포장을 조회할 수 없다(`GET /shipments/{id}` 는 OPERATOR, execution 응답 `packageIds` 는 인계된 것만 — `rider_e2e.py` 주석). `rider_e2e.py` 는 execution DB 를 읽어 대신한다.
- 계획: 관찰용 직원 계정(MFC 시뮬레이터와 같은 `claude-mfc-wrk`, 읽기만)으로 `GET /shipments/{shipmentId}` 를 읽어 qrCode 를 얻는다 = "라벨을 본다"는 시뮬레이터 가정.
- 질문: 이 방식이 괜찮은지, 아니면 시뮬레이터용으로 다른 길을 권하는지.

### RR-07 시뮬레이터 라이더 정리 방법(라이더 탈퇴 구현 포함) — 해소 2026-11-18 (작성 2026-11-16)
- 회신: 백엔드 `docs/handoff/simulator/rider/2026-11-18-backend-reply-rr03-rr05-rr07.md`(보낸 영역 delivery, 사용자 2026-11-18 "응 전부 진행해").
  - 탈퇴 **구현·LAN 배포**(rider 0.6.0): `POST /riders/me/withdrawals` → 막는 것이 없으면 202 APPLIED·nextAction LOGOUT(이름·전화·계좌·거주지·면허 지움, 세션 끊음), `GET …/{requestId}`.
  - 막는 것(409 INVALID_STATE, details `blockers`): 진행 중 배송·확정 전 수행료(완료 5시간 안)·산정 불가 조정 대기·열린 도움요청·제한 검토 중. **이미 걸린 계정 제한은 막지 않는다.** → 배송한 시뮬레이터 라이더도 마지막 완료 5시간 뒤면 탈퇴 가능.
  - 같은 라이더 ID 로 다시 가입 **안 됨**(409 RIDER_WITHDRAWN). 새 ID 로는 같은 전화번호 가입 가능. `RD-sim-01` 을 다시 쓰려면 탈퇴하지 말고 두거나 새 번호(`RD-sim-03` …).
  - `RD-sim-` 전용 즉시 정리 경로는 **만들지 않음**(사용자 결정). 막아 두려면 운영자 TERMINATED 또는 탈퇴.
- 반영(2026-11-18): MOCK 탈퇴를 계약대로(막는 것 목록·계정 제한은 안 막음·APPLIED·LOGOUT·같은 ID 재가입 RIDER_WITHDRAWN·전화번호 지움), 주석 갱신. 실서버 라이더를 탈퇴시키는 화면 버튼은 만들지 않았다(되돌릴 수 없는 쓰기 — 필요하면 사용자 결정).
- 아래는 원래 요청(기록):
- **2026-11-16 실서버에 가입된 시뮬레이터 라이더(정리 대상)**: `RD-sim-01`(010-0000-0001), `RD-sim-02`(010-0000-0002) — 지금 OFF_DUTY.
실서버에서 가상 라이더를 돌리려면(P3) `POST /riders/signups` 로 실제 가입해야 하는데, **가입한 라이더를 지울 길이 없다**. 그래서 사용자 결정으로 P3 실제 가입·운행을 잠가 두었다(`src/config.ts` `REAL_RIDER_GATE`).
- 지금 상태(rider-service 0.4.0, `services/rider-service/CLAUDE.md` 24행): 탈퇴 `POST /riders/me/withdrawals`·`GET …/{requestId}` 는 **501**.
- 계약상 탈퇴도 삭제가 아니다: "진행 중 배송·미정산 수행료·제한 조사 중"이면 409. 수행료는 완료 5시간 뒤 확정·3영업일 뒤 지급 예정이라, **배송을 한 시뮬레이터 라이더는 며칠 동안 탈퇴할 수 없을 수 있다**.
- 지금 있는 대안: 운영자 계정 제한 `TERMINATED`(`POST /riders/{riderId}/restrictions`, OPERATOR_ADMIN·RIDER_OPS) — 운행 시작·신규배차를 막는다. 행·전화번호는 남는다. 시뮬레이터는 직원 쓰기를 하지 않으므로(관찰 계정은 읽기만) 운영자가 한다.
- 요청·질문:
  1. 라이더 탈퇴 구현 일정(계약 0.4.0 그대로).
  2. `RD-sim-` 라이더에 한해 미정산 수행료가 있어도 정리할 길(시험 데이터 정리 경로 또는 탈퇴 예외)을 둘지, 아니면 `TERMINATED` 로 충분한지.
  3. 탈퇴 뒤 같은 라이더 ID·같은 전화번호로 다시 가입할 수 있는지(계약에 없음 — MOCK 은 둘 다 409 로 흉내 [시뮬]).
- 시뮬레이터 쪽 준비(2026-11-16): `RiderPort.withdraw`·`getWithdrawal`(계약 경로 그대로), MockBackend 흉내.

### RR-05 ETA·실시간 stream — 해소 2026-11-18 (요청 아님이었음)
- 회신: 백엔드 `docs/handoff/simulator/rider/2026-11-18-backend-reply-rr03-rr05-rr07.md`(보낸 영역 delivery, 사용자 2026-11-18 "응 전부 진행해") — tracking `GET /deliveries/{id}/eta`·`/stream`(SSE) **구현·배포됨**(라이더 본인도 자기 배송 조회 가능). 다만 ETA 계산(카카오 길찾기)은 꺼져 있어 값은 `ETA_PENDING` — 단계·라이더 위치는 온다. 시뮬레이터는 쓰지 않는다(값이 ETA_PENDING 이라 볼 것이 없음 — 켜지면 다시 본다).
tracking `GET /deliveries/{id}/eta`·`/stream` 은 501(TR-1, 사용자 "필요 없음/선택"). 고객 화면 ETA 는 그리지 않는다. 기록만 남긴다.

### RR-09 실패 반납 인증번호를 시뮬레이터가 얻는 길 — 해소 2026-11-20 (사용자 결정 "반납 인증번호를 받게 해")
- 배경: execution 0.28.0 `POST /deliveries/{id}/returns/store-deliveries` 본문 `handoverCode`(MFC 직원 화면의 반납 인증번호 4자리). 서버 설정 `pmart.execution.return-handover.required` 가 **꺼짐(기본)이면 선택**, 켜지면 없을 때 422 RETURN_HANDOVER_CODE_REQUIRED. 번호는 MFC 직원 화면(`GET /return-handovers?mfcId=`)에만 나온다(백엔드 3817f9bc 계약).
- 시뮬레이터 지금: 번호를 보내지 않는다. 설정이 켜져 422 가 오면 그 반납을 멈춘 것으로 두고(라이더는 대기로, 같은 반납을 다시 집지 않음) 메모만 남긴다 — 계약에 없는 길로 번호를 얻지 않는다.
- **결정·반영(2026-11-20 11:30)**: ①번 — 관찰 계정(MFC 작업자, 계약상 "그 센터 운영자(작업자 포함)" 읽기 가능)으로 `GET /return-handovers?mfcId=` 를 읽어 그 배송 번호를 `handoverCode` 로 넣는다 = "직원이 화면 번호를 불러 준다". 설정이 꺼져 있어도 늘 넣는다(실서버 실측: 관찰 계정 200). 목록을 못 읽으면 번호 없이 보내 본다, 잠겼으면 보내지 않고 메모만. 번호 자체는 인증용 값이라 메모·로그·일지에 남기지 않는다. 백엔드 변경 없음.
- (원래 질문) 필요할 때(사용자 결정): 설정을 켤 계획이면 ① 관찰 계정(`claude-mfc-wrk`, 읽기만)으로 `GET /return-handovers?mfcId=` 를 읽는 것을 허용할지(RR-03 "라벨을 본다"와 같은 가정 = "직원 화면을 본다"), ② MFC 시뮬레이터 가상 직원이 번호를 불러 주는 것으로 할지.

## 시뮬레이터가 정한 값 (MOCK 흉내 — 서버 값이 아님)

P1(2026-11-16) MOCK 이 정한 값. 정본은 `src/config.ts`(`MockParams`·`SimParams`) — 계약 값(`CONTRACT`: 응답 대기 60초·반경 1→2→3km·재시도 2회/10분 등)은 여기 적지 않는다.

| 값 | MOCK | 실서버에서는 |
|---|---|---|
| 반경 한 단계 머무는 시간 | 60초 | dispatch 설정(계약은 단계만 정함) |
| AI 추천 제안 대상 | 그 단계 반경 안 적격 라이더 **모두**에게 한 번에 | OR-Tools / AI 서버가 고름 |
| 인계 허가(fence) 유효시간 | 120초 | 센터 설정값 |
| 사건 반영 지연(배정 → execution 등) | 0.5~3초 | 실측(P2) |
| 주문 → 점원 배차 요청 / 배차 요청 → 출하 대기 | 60~240초 / 3~6분 | 실제 MFC 작업 |
| 출고당 포장 수, 고객 거리 | 1~2개, MFC 에서 0.6~3km | 실제 주문 |
| 제안 거리(`pickupDistanceKm`) | 직선거리 | 카카오모빌리티 도로 거리 |
| 전달지(drop-info) | 가짜 값(좌표만 의미) | 실제 개인정보 — 좌표만 쓰고 버림 |
| 가상 라이더 수락률·응답 지연 | 90%·3~15초(나머지 반은 거절, 반은 무응답) | 같은 엔진 값 |
| **시나리오 조절 바**(화면 "⚙ 시나리오", 2026-11-16) | 주문량 0~60/시간, 수락률 0~100%, 포장 시간 ×0.5~5, 고객 부재 0~100%, 응답 끊김 0~50%(절반은 처리 전·절반은 처리 뒤) — 기본값은 위 표 | 실서버는 조절 안 함(실제 결과만), 실서버 라이더 고객 부재는 늘 0 |
| 전달 실패 → 운영자 확정 | 60초 뒤 MOCK 이 대신 확정(FAILED, DeliveryFailed, 배차 CLOSED). 상품이 라이더에게 있으면(custody RIDER) 실패 반납(type RETURN, purpose FAILED_DELIVERY_RETURN)을 **늘 같은 라이더**에게 제안 없이 바로 배정(2026-11-20, dispatch 0.6.0·execution 0.15.0). 반려·되돌리기·다른 라이더 반납(OTHER_RIDER)은 흉내 내지 않음 | 운영자가 `failure-decisions` 로(반려·30분 안 되돌리기·반납 라이더 선택 포함) |
| 전달 실패 때 라이더 | 연락 2번(30초, PHONE_CALL·SMS)·문 앞 사진 → `failures`(CUSTOMER_ABSENT, WITH_RIDER — 실패 대화 DELIVERY_FAILURE 가 같이 열려 도움요청은 따로 안 보냄) → 확정 대기(최대 30분) → 상품 들고 MFC → 대기 중 내 배송에서 실패 반납을 찾아(30초마다 [시뮬]) ASSIGNED 에서 바로 `returns/store-deliveries`. 반려·되돌림이면 전달을 이어감 | 같은 엔진 값(조절 바로만 켜짐) |
| 라이더 배정 취소(조절 바) | 수락 뒤 가게로 가다가 30~90초 뒤 `assignment-cancellations`(RIDER, RIDER_UNABLE, reassign true) | 실서버는 안 함 |
| 위치 끊김(조절 바) | 고객에게 가는 중 4분 위치 안 올림(점은 모았다가 풀리면 최근 200점). MOCK tracking 은 30초마다 보고 3분(서비스 문서 값) 넘으면 RiderLocationStale 한 번 | 실서버는 안 함 — tracking 이 실제로 낸다 |
| 주문 창 "주문" 탭(2026-11-19) | 가상 주문 상세 — 배달팁 3,000원(상품 3만 원 이상 0원), 요청사항 있는 주문 50%, 배송지·수령인·전화·요청사항 모두 "(MOCK)" 가짜, 원문 열람은 바로 가짜 원문(열람 기록 없음). `src/config.ts` `MOCK_ORDER` | order-service 직원용 주문 상세·원문 열람(관제 계정, audit 기록) |
| 포장 대기 도움요청 | 가게에서 10분 넘게 READY 를 기다리면 `help-requests` STORE_WAITING 한 번 | **실서버도 보냄**(사용자 2026-11-16 "진행해" — 실제 지원센터 사건이 열림) |
| 오배송(조절 바) | 전달 완료의 n% 가 5분 뒤 MOCK 이 case 대신 MisdeliveryConfirmed. 귀책 반반(고객 잘못 / 라이더·시스템 잘못) | 상담원·지원센터가 case 에 기록 |
| 다시 배송 실제 집 | 잘못 둔 곳에서 60~450m(200m 기준은 [확정] dispatch 0.4.2). 결제 대기는 3분 뒤 결제 70% / 거절 30% | order-orchestration·고객 앱 |
| 다시 배송 전달지 좌표 | 백엔드는 주소 글자만(핀 없음). MOCK 라이더는 MOCK 주소록, **실서버 라이더는 개발 서버 카카오 로컬 주소 검색**(도로명 주소만, 하루 200번 [시뮬], 키 거절·사용량이면 그날 다시 배송 거절) | 사용자 결정 2026-11-16 "그렇게 해" |
| 회수 현장 시간 | 잘못 둔 곳에서 상품 찾기 30초 | 같은 엔진 값 |
| 고객 반품 회수(조절 바 "반품 회수", 2026-11-20) | 전달 완료의 n% 가 10분 뒤 MOCK 이 claim 대신 CLAIM_RETURN 배송(고객 집 → MFC, MFC 중심 일반 반경) 생성. 고객 집에서 받기 30초. 받기 전 고객 부재 실패는 흉내 내지 않음 | 고객 반품 신청·승인(claim) |
| 반납 인증번호(MOCK) | 직원 화면 목록을 처음 볼 때 배송 ID 로 정한 4자리, 5번 틀리면 잠김. 필수 여부 `returnHandoverRequired` 기본 false(서버 기본과 같음) | execution 설정·MFC 직원 화면 |
| 제안 예상 소요(`pickupEtaSeconds`·`dropEtaSeconds`, 2026-11-17) | 직선 km × 186초(도로 배율 1.3 ÷ 7m/s) | 카카오모빌리티 도로 시간 |
| 제안 주문 요약(`order`)·수행 `orderSummary`(2026-11-17) | 가짜 품목 1~4줄 × 수량 1~3 × 단가 1,500~15,000원, 주문번호 8자리 난수, 요청사항 없음. 회수 배송 제안에는 없음 | order `rider-summary` |
| 가상 라이더 거절 기준(2026-11-17) | 예상 소요 합(라이더 → 픽업지 + 픽업지 → 전달지) 40분 넘으면 TOO_FAR | **실서버 가상 라이더도 같은 기준** |

## 해소된 요청

### RR-04 실서버 모드 이동 경로(도로) — 해소 2026-11-16 (사용자 결정)
- 원래 질문: 시뮬레이터가 카카오모빌리티 길찾기를 직접 불러도 되는지(키·비용). tracking 거리 행렬은 `/internal` 이고 거리·시간만 준다.
- **결정(사용자 "시뮬레이터용 REST 키 따로 받았어")**: 시뮬레이터 전용 REST 키로 Vite 개발 서버가 직접 부른다. 키는 `.env.local` `KAKAO_MOBILITY_REST_KEY`(브라우저로 안 감), 백엔드 키와 나눠 쓰지 않음. 구현 `docs/design.md` §6-3.

### RR-02 시뮬레이터 라이더 ID·가입 데이터 — 해소 2026-11-16 (사용자 결정)
- 원래 질문: 시뮬레이터 라이더 ID 접두어·인원·전화번호 대역, 백오피스 구분 표시.
- **결정(사용자 "시험 번호로 시작")**: `RD-sim-01`~(접두어는 RR-01), 지금 **2명**, 전화 `010-0000-00NN`(`src/config.ts` `simRiderPhone`, `REAL_RIDER_GATE.riderCount`). 늘리려면 사용자에게 묻는다. 백오피스 구분 표시는 정하지 않음(라이더 ID 접두어로 구분).
- 2026-11-16 17:44 실서버 가입: RD-sim-01·02 (201) — 지울 수 없다(RR-07).

### RR-01 시뮬레이터 라이더 토큰 — 해소 2026-11-16
- 회신: 백엔드 `docs/handoff/simulator/rider/2026-11-16-simulator-reply-rider-token-rr01.md`(커밋 `1f3653ed`, 보낸 영역 platform, 사용자 "A번"). 결정 기록 백엔드 `docs/simulator/rider/README.md`.
- 결정: rider-auth 에 발급 경로는 만들지 않고, **시뮬레이터 Vite 개발 서버가 LAN 서명키로 직접 서명**. 다른 기기 조회(용도 2)도 승인.
- 조건 7개(요약 — 정본은 회신 문서, 구현 대응은 `docs/design.md` §6-5): ① 개발 서버에서만 서명·브라우저엔 토큰만 ② 키는 `PMART_SECRETS_DIR` 읽기만·다른 PC/폴더 복사 금지·운영 키 금지 ③ 주체는 `RD-sim-` 만(서명 함수에서 거절) ④ RS256·`rider_e2e.py` 와 같은 클레임·`sid` = `sim-…`·15분·재사용/연장 없음 ⑤ 다른 기기는 토큰 없이 GET·HEAD 허용 목록만·시뮬레이터 라이더 한정·쓰기/drop-info 금지 ⑥ 토큰·키·주소·전화는 로그 금지(라이더 ID·경로·상태 코드만) ⑦ 401 이면 새 토큰, 정지 라이더는 운행 안 함.
- 이어진 것: PC 5 에 서명키 두기 → **RR-06**(사용자 결정으로 해소).

### RR-06 PC 5 에 시험 라이더 서명키 두기 — 해소 2026-11-16 (사용자 결정, 백엔드에 묻지 않음)
- 배경: 이 시뮬레이터 작업 PC 는 PC 5(백엔드 delivery 영역·라이더 앱과 같은 PC)인데 서명키(`rider-auth-signing-key.pem`·`rider-auth-signing-kid`)는 PC 1 `deploy/lan/.secrets/` 에만 있다. RR-01 조건 ② "다른 PC·다른 폴더로 복사하지 않는다" ↔ 백엔드 `docs/operations/dev-on-other-pcs.md` §2 "필요한 파일만 같은 경로로 사용자가 복사"가 엇갈렸다.
- **결정(사용자 2026-11-16 "응 어쩔 수 없어")**: 두 파일을 **PC 5 의 같은 경로**(`../pmart-backend/deploy/lan/.secrets/`)에 사용자가 복사하고, 이 시뮬레이터는 그 PC 에서 읽기만 한다. 저장소·다른 폴더로는 옮기지 않는다. RR-01 의 나머지 조건(①③~⑦)은 그대로.
- 처음엔 백엔드 질문으로 올렸다가(커밋 `c17b12b`) 사용자가 직접 정해 해소로 옮겼다.
