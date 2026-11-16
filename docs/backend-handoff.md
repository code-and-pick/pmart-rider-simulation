# 백엔드에서 읽을 것 (backend → rider simulator)

> 정본은 백엔드 저장소(`../pmart-backend`, 읽기만)에 있다. 여기는 **어디를 읽으면 되는지와 한 줄 요약**만 둔다.
> 이 시뮬레이터 → 백엔드 요청은 `docs/backend-requests.md`(R-xx). 2026-11-16 기준(`aa46ce11`). 아직 이 시뮬레이터 앞으로 온 백엔드 공지는 없다.

## 계약 (정본)

| 무엇 | 위치 |
|---|---|
| 배차·제안·배달리스트·배차 취소 | `contracts/openapi/delivery-dispatch-service.yaml` (0.3.3) |
| 수행 상태·인계 확인·전달지·사진·완료·실패·도움요청 | `contracts/openapi/delivery-execution-service.yaml` (0.4.0) |
| 위치 업로드·ETA(501)·stream(501) | `contracts/openapi/delivery-tracking-service.yaml` (0.3.0) |
| 라이더 가입·운행 상태·배차 설정 | `contracts/openapi/rider-service.yaml` (0.4.0) |
| 라이더 로그인(Google 만) | `contracts/openapi/rider-auth-service.yaml` (0.1.0) |
| 포장 QR 인계(허가·확정)·배차 요청·출고 조회 | `contracts/openapi/mfc-fulfillment-service.yaml` (0.4.11) |
| 센터 좌표 | `contracts/openapi/center-master-service.yaml` (`coordinates`) |
| 공통(헤더·오류·CommandResponse) | `contracts/openapi/_common.yaml` |
| 사건 | `contracts/events/{DispatchRequested,ShipmentReady,DeliveryCreated,DispatchOfferSent,DeliveryAssigned,DeliveryAssignmentChanged,PackageHandedOver,DeliveryCompleted,DeliveryFailed,RiderLocationStale,RiderStateChanged}.v1.json` |

## 구현 상태·규칙

| 무엇 | 위치 |
|---|---|
| 서비스별 구현 상태("상태" 절 — 무엇이 501 인지, 구독 사건) | `services/{delivery-dispatch,delivery-execution,delivery-tracking,rider,rider-auth}-service/CLAUDE.md` |
| 서비스 책임 경계 | `docs/architecture/service-map.md` §7 |
| MFC ↔ 배송 약속(시험 라이더 토큰 결정 §6 포함) | `docs/architecture/service-requests/delivery-kickoff-from-mfc.md` |
| 사건 버전·순서 규칙 | `docs/architecture/events.md` §7 |
| 업무 문서 | `docs/business/Delivery-business-logic.md`, `docs/business/flows/order-checkout-saga.md`, `docs/business/flows/cancel-vs-handover.md` |
| 백엔드 작업 일지(배송) | `docs/worklog/` |

## 실서버 연결

| 무엇 | 위치 |
|---|---|
| **LAN 라이더 흐름 전례**(호출 순서·시험 라이더 토큰 서명 방식·QR 형식 `PKG:<id>:<버전>`) | `deploy/lan/checks/rider_e2e.py` (2026-11-16 첫 실행) |
| 직원 토큰 흐름(Keycloak → dev-token-exchange) — 관찰 계정용 | `deploy/lan/checks/staff_auth.py` (MFC 시뮬레이터 `server/simAuth.ts` 가 같은 흐름, 비밀번호 재설정 동작은 뺌) |
| LAN 시험 계정("라이더: 고정 시험 계정 없음") | `docs/operations/lan-test-accounts.md` |
| 비밀 파일(Git 아님) | `deploy/lan/.secrets/` — `rider-auth-signing-key.pem`, `rider-auth-signing-kid`, 직원 계정 비밀번호 파일 |
| 시뮬레이터 범위·MFC 시뮬레이터 연결 결정(SIM-1~11) | `docs/simulator/scope.md`, `docs/simulator/mfc/mfc-simulator-integration.md` |
| **백엔드 → 이 시뮬레이터 회신·공지** (RR 번호) | `docs/handoff/simulator/rider/` (2026-11-16 mfc·rider 폴더로 나뉨, 목록은 그 폴더 README) |
| 백엔드 쪽 라이더 시뮬레이터 결정 | `docs/simulator/rider/README.md` |
| 영역·PC 담당(이 시뮬레이터 = delivery 영역 PC 5, 토큰·인증 = platform PC 1) | `docs/operations/pc-split.md` 11·83행 |

## 짝 저장소 (읽기만)

| 무엇 | 위치 |
|---|---|
| MFC 시뮬레이터 구조·규칙·Mock/Http 포트 패턴 | `../pmart-mfc-simulation/CLAUDE.md`, `src/backend/`, `src/sim/simulation.ts` 머리 주석 |
| MFC 시뮬레이터 → 백엔드 요청(SIM-7 라이더) | `../pmart-mfc-simulation/docs/backend-requests.md` |
| 실제 PDA 앱의 배차 요청 호출 | `../pmart-clients/apps/mfc_app/lib/features/packing/data/packing_repository.dart` |
| 참고만(독자 계약) | `../PMart-Delivery-Test/` — `docs/design.md` §7 |
