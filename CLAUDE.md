# CLAUDE.md — PMart 배송·라이더 가상 현장 (rider simulation)

PMart 라스트마일(MFC → 고객) 배송을 **카카오 지도 위에서** 돌리는 가상 현장이다(지도는 평면, 라이더 마커만 입체처럼 그림 — 2026-11-16 결정). 백엔드(`../pmart-backend`)에 대해 **라이더 앱처럼** 계약 API 를 부른다.
MFC 쪽 시뮬레이터(`../pmart-mfc-simulation`)의 짝이다. MFC 에서 점원이 **배차 요청**을 하면(실제 PDA 또는 MFC 시뮬레이터 가상 작업자) 백엔드 delivery-dispatch 가 배송을 열고, 이 시뮬레이터의 가상 라이더가 제안을 받아 수락 → MFC 이동 → QR 인계 → 고객 이동 → 전달 완료까지 수행한다.
두 시뮬레이터는 서로 직접 부르지 않는다 — **백엔드 사건으로만 이어진다**(설계 `docs/design.md` §2).

스택: `../pmart-mfc-simulation` 과 같다(사용자 결정 2026-11-16) — Vite 6 + TypeScript 5 + React 19 + Vitest(react-three-fiber 는 지도 화면에 쓰지 않음 — 필요할 때만). 지도는 카카오맵 웹 JS SDK(JavaScript 키 `VITE_KAKAO_JS_KEY`, `.env.local` — Git 제외)로 띄우고, 라이더는 커스텀 오버레이로 그린다. 키가 없으면 좌표 평면 대체 화면으로 돈다(`docs/design.md` §6). 카카오 REST 키는 브라우저에 두지 않는다 — 도로 경로용 카카오모빌리티 REST 키는 `.env.local` `KAKAO_MOBILITY_REST_KEY`(**`VITE_` 금지**, 개발 서버 `/sim-route` 만 읽음, 시뮬레이터 전용 키 — 백엔드 키와 나눠 쓰지 않음, §6-3). 다시 배송 전달지 주소 → 좌표는 개발 서버 `/sim-geocode`(카카오 로컬 주소 검색 — 키 `KAKAO_LOCAL_REST_KEY`, 없으면 같은 모빌리티 키, 도로명 주소만·로그 안 남김, 사용자 2026-11-16 결정).
- **역할**: 배차는 백엔드가 한다. 실서버에서 라이더 API 를 부르는 것은 이 시뮬레이터뿐이고, MFC 시뮬레이터는 배차·수행 상태를 읽어 앞마당 인계만 그린다(`docs/design.md` §2-1, MFC 쪽에 넘길 내용 `docs/mfc-simulator-requests.md`).
- 시뮬레이션 엔진(`src/sim`)·백엔드 어댑터(`src/backend`)·도메인(`src/domain`)은 React 에 의존하지 않는다(테스트가 화면 없이 돈다).
- 매 프레임 바뀌는 값(라이더 위치)은 React 상태로 올리지 않고 지도 오버레이 객체를 직접 옮긴다. 패널은 약 4Hz 박자·선택 변경 때만 다시 그린다.

## 절대 규칙
- `../pmart-backend`, `../pmart-clients`, `../pmart-mfc-simulation`, `../PMart-Delivery-Test` 는 **읽기만** 한다. 백엔드에 필요한 변경·결정은 `docs/backend-requests.md` 에 R 번호로 적고 사용자에게 보고한다.
- **계약이 정본이다.** `src/domain/contract.ts` 의 이름·상태값·필드는 `pmart-backend/contracts/openapi/` 의 `delivery-dispatch-service.yaml`·`delivery-execution-service.yaml`·`delivery-tracking-service.yaml`·`rider-service.yaml`·`mfc-fulfillment-service.yaml`(인계 부분)과 `contracts/events/*.v1.json` 을 그대로 따른다. 계약에 없는 엔드포인트를 HttpBackend 에서 추측해 부르지 않는다. 계약 머리에 버전을 적는다.
- **`../PMart-Delivery-Test` 는 참고만 한다**(사용자 결정 2026-11-16). 배송 기능이 가능한지 시험한 프로젝트이고, 실제 구현은 pmart-backend 서비스다. 그쪽은 독자 계약(`com.baropick`, `/api/rider/...`)이라 API 이름·상태값·필드를 가져오지 않는다. 가져올 수 있는 것은 아이디어(경로 재생·장애 주입·위치 판정·시험 시나리오)뿐이고, 가져오면 `docs/design.md` §7 표에 적는다.
- MockBackend 는 계약 의미를 흉내 낼 뿐 실서버 동작을 대신하지 않는다. 흉내 내면서 정한 값(제안 만료·반경 단계 시간 등)은 `src/config.ts` 와 `docs/backend-requests.md` "시뮬레이터가 정한 값"에 적는다.
- **서버가 확정한 결과만 확정으로 그린다.** 응답이 없으면 결과 불명으로 보고 같은 `Idempotency-Key` 로 재전송하거나 조회로 확인한다. 실패로 단정하지 않는다.
- **배송 상태를 시뮬레이터가 만들지 않는다.** 픽업 완료는 MFC 인계 확정(`PackageHandedOver`)으로만, 전달 완료는 사진 + 완료 요청으로만 된다. 경로 끝 도착·시간 경과·위치만으로 상태를 넘기지 않는다(execution 계약 머리).
- 배차 쪽 상태(`DispatchState`)와 수행 쪽 상태(`ExecutionState`)는 **다른 서비스의 다른 값**이다. 하나로 합치지 말고 화면에는 둘 다 출처를 붙여 보인다(`docs/design.md` §4).
- 업무 문서에 없는 수치는 `src/config.ts` 에 근거 태그(`[확정]`/`[가정]`/`[시뮬]`)와 함께 둔다. 다른 파일에 흩어 놓지 않는다.
- 토큰·서명키·비밀번호는 브라우저 저장소(localStorage·sessionStorage)에 두지 않는다. **시험 라이더 토큰은 RR-01 회신 조건(`docs/design.md` §6-5)을 지킨다**: Vite 개발 서버에서만 서명, 서명키는 `PMART_SECRETS_DIR` 에서 읽기만·다른 PC 로 복사 금지·LAN 전용, 주체는 `RD-sim-` 접두어만(서명 함수에서 거절), RS256·15분·재사용/연장 없음, 다른 기기에는 토큰 안 줌, 401 이면 새 토큰 + 정지 라이더는 운행 중지. 비밀 파일은 `PMART_SECRETS_DIR`(기본 `../pmart-backend/deploy/lan/.secrets`)에서 읽기만 한다. 로그·일지·화면에 토큰·주소·전화번호를 남기지 않는다. **예외(사용자 2026-11-18 "주소까지 보이게")**: 실서버 화면의 고른 배송 상세에 직원용 전달지(`GET /deliveries/{id}/drop-location` — 주소·좌표만, 백엔드가 열람 기록)를 보인다 — 이 PC·관제 계정만, 고를 때 한 번 읽어 화면 메모리에만(로그·일지·브라우저 저장소·다른 기기 금지). **예외 2(사용자 2026-11-19 "여기서 다 열람할 수 있게 해")**: 주문 창 "주문" 탭에 직원용 주문 상세(`GET /orders/lookups/{orderId}` — 품목·금액·결제, 배송지·요청사항은 가린 값)와, 사용자가 사유를 적고 누를 때만 원문 열람(`POST /orders/lookups/{orderId}/pii-reveals` — 수령인·전화·상세 주소·출입 메모·요청사항, 백엔드가 audit 열람 기록을 남긴 뒤에만 원문)을 보인다 — 이 PC·관제 계정만, 화면 메모리에만(다른 배송을 고르거나 창을 닫으면 지움, 로그·일지·브라우저 저장소·다른 기기 금지). Claude 가 시험으로 원문 열람을 누르지 않는다(실제 열람 기록이 남음).
- **실서버 가입·운행 잠금 `REAL_RIDER_GATE`(`src/config.ts`)는 사용자 결정 없이 바꾸지 않는다**(2026-11-16 사용자가 풂: 2명·전화 010-0000-00NN → 2026-11-22 "RD-sim-03·04 새로 가입"은 LAN 휴대폰 번호 확인에 막힘(RR-10) → 2026-11-23 사용자 "01·02를 목포로 돌려 쓰기": 2명 그대로, 지점(주소 `?mfc=`·머리줄 단추, `RIDER_SITES`)을 바꿔 운행을 켜면 배달지역을 그 MFC 하나로 바꿈). 인원을 늘리거나 새 ID 로 가입시키기 전에 묻는다 — 가입한 라이더는 지울 수 없다(탈퇴 501 — RR-07). 실서버 시험이 끝나면 화면 "운행 종료"로 OFF_DUTY 를 확인한다(ON_DUTY 로 남기면 실제 제안이 간다).
- 백엔드도 사용자가 맡는다(2026-11-16) — `docs/backend-requests.md` RR 은 기록용이고 백엔드 handoff·PR 로 보내지 않는다. 백엔드 저장소는 여전히 이 세션에서 읽기만.
- 실서버 모드의 가상 라이더는 **시뮬레이터 전용 라이더 ID**(`RD-sim-` 접두어 — RR-01, 인원·전화 대역은 사용자 결정 RR-02)만 쓴다. 실제 라이더 앱 사용자를 조종하지 않는다.
- 관제 계정(`claude-dev`, OPERATOR_ADMIN — 사용자 2026-11-18 "claude-dev 써")은 이 PC 개발 서버가 `GET /rider-locations`·`GET /deliveries/{id}/drop-location`·`GET /orders/lookups/{orderId}`·`POST /orders/lookups/{orderId}/pii-reveals`(사용자 2026-11-19 — 유일한 쓰기, 열람 기록)·`GET /rider-operating-time`·`GET /riders`(라이더 찾기 — 가린 이름·전화·가입일; 이 둘은 사용자 2026-11-19 "똑같이 해봐" — 기본 화면을 백오피스 라이더 관제처럼) 여섯에만 붙인다(`server/lanPolicy.ts` `isControlRequest`). 그 밖의 쓰기·다른 경로(주문 검색 목록 포함)·다른 기기 금지.
- LAN 다른 기기에는 토큰을 주지 않는다. 다른 기기 요청은 개발 서버가 GET·HEAD 허용 목록만 넘기고(직원 조회 = 관찰 계정, 라이더 본인 조회 = 시뮬레이터 라이더 ID 에 한해 서명), 쓰기·전달지(개인정보)는 막는다(`docs/design.md` §6-4).
- 실행하지 않은 테스트·빌드를 통과했다고 보고하지 않는다.
- 작업 일지를 `docs/worklog/YYYY-MM-DD.md` 에 남긴다(형식·규칙 `docs/worklog/README.md`, 백엔드 일지 형식을 따름). 일지 없이 커밋하지 않고, 백엔드에서 읽어 확인한 사실은 근거(파일·커밋)와 함께 적는다.

## 다른 PC 에서 이어서 작업할 때
- **작업 PC 는 PC 5**(사용자 2026-11-16 — 백엔드 delivery 영역·라이더 앱과 같은 PC). 2026-11-16 설계 문서는 다른 PC(`ds603-13`)에서 썼고, P0 골격부터 PC 5 가 맡는다.
0. **세션 인수인계 `docs/session-handoff.md` 를 먼저 읽는다**(지금 상태·맨 먼저 할 일·남은 일 요약).
1. 이 파일 → `docs/design.md`(설계·계약 요약·단계 계획) → `docs/worklog/` 최신 일지 → `docs/backend-requests.md` 순서로 읽는다.
2. 형제 폴더가 같은 위치에 있어야 한다: `../pmart-backend`, `../pmart-mfc-simulation`, `../pmart-clients`, `../PMart-Delivery-Test`. 백엔드는 `git pull` 만 하고 고치지 않는다.
3. 일지의 "백엔드 확인" 커밋과 지금 백엔드 커밋이 다르면 계약 버전(`contracts/openapi/delivery-*.yaml` 의 `info.version`)과 `services/delivery-*/CLAUDE.md` "상태" 절을 다시 읽고 `docs/design.md` §3 표를 고친다.
4. 실서버 모드는 LAN 비밀 파일(`deploy/lan/.secrets/rider-auth-signing-key.pem`·`rider-auth-signing-kid`, 관찰 계정 비밀번호)이 그 PC 에 있어야 한다. Git 에 없다. **PC 5 에서 시작할 때 이 파일들이 `../pmart-backend/deploy/lan/.secrets/` 에 있는지 먼저 확인**한다(PC 1 에서 사용자가 같은 경로로 복사 — RR-06 사용자 결정). 없으면 MOCK 으로만 작업한다. 저장소·다른 폴더로는 옮기지 않는다.

## 명령 (P0 골격 2026-11-16 PC 5)
```bash
npm run dev        # http://localhost:5181, LAN http://<이 PC IP>:5181 (/api 는 PMART_GATEWAY 로 프록시, 기본 192.168.0.40:8080)
npm test           # vitest — 화면 없이
npm run typecheck  # src·test(tsconfig.json) + vite.config·server(tsconfig.node.json)
npm run build
```
- 구조: `src/domain/contract.ts`(계약 사본, 머리에 버전) · `src/backend/port.ts`(`RiderPort`) · `src/backend/mock/MockBackend.ts`(계약 의미 흉내 + MOCK 에서 다른 서비스 대신) · `src/sim/rider.ts`(가상 라이더 상태기계 — 포트만 봄) · `src/sim/simulation.ts`(시계·로그·지표) · `src/render/`(`MapSurface` — 카카오 / 좌표 평면, 공용 HTML 마커) · `src/app/controller.ts`(진행 타이머·rAF 그리기·4Hz 패널) · `src/backend/http/HttpBackend.ts`(실서버 — 토큰 없이 `X-Sim-Rider`/`X-Sim-Actor` 만) · `src/sim/realWorld.ts`(실서버 읽기 화면, `?mode=http`) · `src/config.ts`(근거 태그 수치) · `server/`(Vite 개발 서버 플러그인 — Node 전용: 다른 기기 가드 `lanPolicy.ts`, 시험 라이더 토큰 `riderToken.ts`, 관찰 계정 `staffToken.ts`, 비밀 파일 `secrets.ts`, 실서버 운행 지킴이 `operationWatch.ts`(맥박 끊김·페이지 떠남 → 라이더 OFF_DUTY), 붙이기 `devServer.ts`. **서명키·비밀번호를 읽는 코드는 `server/` 에만, 토큰은 브라우저로 보내지 않는다**). 시험: `test/server/*`(tsconfig.node.json) · 나머지 `test/*`.
- 저장소 루트의 `env.download` 같은 키 파일은 `.gitignore` 에 걸리지 않는다 — 커밋은 경로를 지정해서만 올린다(`git add -A` 금지).

## 참고 문서 (읽기 전용)
- 배송 업무: `../pmart-backend/docs/business/Delivery-business-logic.md`, 주문 사가 `docs/business/flows/order-checkout-saga.md`, 취소·인계 경합 `docs/business/flows/cancel-vs-handover.md`
- 서비스 책임: `../pmart-backend/docs/architecture/service-map.md` §7, MFC 와의 약속 `docs/architecture/service-requests/delivery-kickoff-from-mfc.md`
- 구현 상태: `../pmart-backend/services/{delivery-dispatch,delivery-execution,delivery-tracking,rider,rider-auth}-service/CLAUDE.md` "상태" 절
- 실제 흐름 전례: `../pmart-backend/deploy/lan/checks/rider_e2e.py`(LAN 라이더 처음부터 끝까지, 2026-11-16 첫 실행)
- 백엔드 → 이 시뮬레이터 회신·공지: `../pmart-backend/docs/handoff/simulator/rider/`(2026-11-16 mfc·rider 폴더로 나뉨), 백엔드 쪽 결정 `docs/simulator/rider/README.md`, 시뮬레이터 범위 `docs/simulator/scope.md`. 백엔드에서 이 시뮬레이터 담당은 delivery 영역(PC 5), 토큰·인증 회신은 platform(PC 1) — `docs/operations/pc-split.md`
- 짝 시뮬레이터: `../pmart-mfc-simulation/CLAUDE.md`, `docs/backend-requests.md`(SIM-7: 라이더는 배송 구현 뒤)
- 어디를 읽나 전체 목록: `docs/backend-handoff.md`
