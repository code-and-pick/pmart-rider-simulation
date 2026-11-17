# 세션 인수인계 — 배송·라이더 가상 현장

> 다른 세션(또는 다른 PC)에서 이어 작업할 때 **이 파일부터** 읽는다. 기준: 2026-11-17 09:35, 백엔드 기준 `c475ff94`(dispatch 0.4.7·execution 0.7.2·rider 0.5.0 — 2026-11-17 다시 읽음, 모두 추가뿐).
> 자세한 "왜·어떻게 검증했나"는 `docs/worklog/2026-11-16.md`, 설계·결정은 `docs/design.md`(§9 단계 계획·§10 결정 이력)에 있다. 이 파일은 그 요약과 지금 상태·다음 할 일이다.

## 0. 다음 세션이 맨 먼저 할 일
1. **실서버 라이더 상태 확인.** 2026-11-17 09:35 확인: `RD-sim-01`·`02` 모두 OFF_DUTY(일지 2026-11-17). 세션을 시작할 때마다 개발 서버를 거쳐 `GET /api/v1/riders/me/state`(`X-Sim-Rider: RD-sim-0N`) 또는 `?mode=http` 화면으로 다시 본다 — ON_DUTY 로 남아 있으면 실제 배차 제안이 그 라이더에게 간다.
2. 시작 점검: `npm run typecheck`·`npm test`·`npm run build`(마지막 실행 결과: 0·15파일 91건 통과·0).
3. 백엔드 `git pull`(읽기만) 뒤 커밋이 `c475ff94` 와 다르면 계약 버전(`contracts/openapi/delivery-*.yaml` `info.version`)과 `services/delivery-*/CLAUDE.md` "상태" 절을 다시 읽고 `docs/design.md` §3·`src/domain/contract.ts` 머리를 고친다.

## 1. 꼭 지킬 규칙 (CLAUDE.md·사용자 결정 요약)
- **사용자에게 보이는 글은 모두 한국어**(진행 중 안내 포함).
- `../pmart-backend`·`../pmart-clients`·`../pmart-mfc-simulation`·`../PMart-Delivery-Test` 는 **읽기만**. 백엔드 요청은 `docs/backend-requests.md` RR 번호로 기록만(백엔드도 사용자가 맡음 — PR·handoff 로 보내지 않음).
- 계약이 정본. 계약에 없는 엔드포인트를 추측해 부르지 않는다. 배송 상태를 시뮬레이터가 만들지 않는다(픽업 = 인계 확정, 완료 = 사진 + 완료 요청).
- 응답 없음 = 결과 불명 → **같은 `Idempotency-Key` + 처음과 똑같은 본문**으로 재전송(본문을 다시 만들면 409 IDEMPOTENCY_CONFLICT — 2026-11-16 고친 결함).
- 수치는 `src/config.ts` 에 근거 태그(`[확정]`/`[가정]`/`[시뮬]`)와 함께. MOCK 이 정한 값은 `docs/backend-requests.md` "시뮬레이터가 정한 값"에도.
- 토큰·키·비밀번호는 브라우저 저장소·로그·화면·일지에 두지 않는다. 고객 주소·전화번호도 로그·일지·화면에 남기지 않는다. 비밀 파일은 `../pmart-backend/deploy/lan/.secrets/` 에서 **이름만 확인, 내용 출력 금지**.
- REST 키에 `VITE_` 접두어 금지(붙이면 개발 서버가 시작을 거부).
- **`REAL_RIDER_GATE`(`src/config.ts`)는 사용자 결정 없이 바꾸지 않는다.** 지금 `{operationAllowed: true, signupAllowed: true, riderCount: 2}`. 인원을 늘리거나 새 ID 로 가입시키기 전에 묻는다(가입한 라이더는 지울 수 없음 — RR-07).
- 실서버는 `RD-sim-` 라이더만. 실서버 시험이 끝나면 "운행 종료"로 OFF_DUTY 확인.
- LAN 다른 기기에는 토큰을 주지 않고 GET·HEAD 허용 목록만.
- 실행하지 않은 시험·빌드를 통과했다고 보고하지 않는다.
- 커밋: **일지(`docs/worklog/YYYY-MM-DD.md`, 제목에 실제 시각) 없이 커밋하지 않는다**, `git add` 는 경로를 지정해서만(`git add -A` 금지 — 루트의 `env.download` 같은 키 파일이 걸리지 않음), **PR 없이 main 에 바로 푸시**. 커밋 SHA 는 다음 일지 항목에 추기.

## 2. 실행 환경
- 작업 PC = PC 5. 형제 폴더 `../pmart-backend`·`../pmart-mfc-simulation`·`../pmart-clients`·`../PMart-Delivery-Test` 가 같은 위치에 있어야 한다.
- `.env.local`(Git 제외, 이름은 `.env.example` 참고):
  - `VITE_KAKAO_JS_KEY` — 카카오맵 JS SDK(없으면 좌표 평면 대체 화면).
  - `KAKAO_MOBILITY_REST_KEY` — 도로 경로 `/sim-route`(시뮬레이터 전용 키, 없으면 직선).
  - `KAKAO_LOCAL_REST_KEY` — 선택. 다시 배송 주소 검색 `/sim-geocode`. 없으면 모빌리티 키를 쓴다(같은 카카오 앱 REST 키로 로컬 API 가 열려 있음 — 2026-11-16 실제 한 번 확인).
  - `PMART_GATEWAY`(기본 `http://192.168.0.40:8080`), `PMART_SECRETS_DIR`(기본 `../pmart-backend/deploy/lan/.secrets`).
- 실서버 모드에 필요한 비밀 파일(Git 에 없음): `rider-auth-signing-key.pem`·`rider-auth-signing-kid`, 관찰 계정(`claude-mfc-wrk`) 비밀번호. 없으면 MOCK 으로만.
- 명령: `npm run dev`(http://localhost:5181, LAN `http://<IP>:5181`), `npm test`, `npm run typecheck`, `npm run build`. 실서버 화면 = `?mode=http`(배속 잠금, 벽시계 1×).
- 개발 서버 코드(`server/*`, `vite.config.ts`)는 시작할 때만 읽는다 — 고치면 다시 켠다. `vite.config.ts` 를 고치면 vite 가 스스로 다시 떠 포트를 잡고 있을 수 있다(그 프로세스를 끄고 새로 띄움).
- 개발 서버 하루 상한(메모리에만, 다시 켜면 0): 도로 경로 1000번, 주소 검색 200번.

## 3. 지금까지 한 일 (2026-11-16, 커밋 순)
| 단계 | 커밋 | 내용 |
|---|---|---|
| 설계 | `941a3d2`~`9044569` | 설계·인수인계 문서, RR-01 회신(시험 라이더 토큰 조건 7개) 반영, 작업 PC = PC 5, RR-06 해소 |
| P0 | `e42f365`·`08045ed`·`c1da8ca` | Vite·TS·계약 사본·`RiderPort`·설정·LAN 다른 기기 가드. Vitest 3.x 유지, PR 대신 main 푸시(사용자) |
| P1 | `2f6303c`·`226708e` | MOCK 백엔드 + 가상 라이더 상태기계 + 카카오 지도 / 좌표 평면 화면 |
| P2 | `74cedfc` | 실서버 읽기: 시험 라이더 토큰(개발 서버 서명), 관찰 계정, `HttpBackend`, 실서버 화면 |
| P3 | `60ec52a`·`45ef395` | 실서버 운행 잠금 → 사용자가 풂(2명, 전화 `010-0000-00NN`). `RD-sim-01`·`02` 실제 가입 → ON_DUTY → 위치·제안 조회 → 운행 종료 OFF_DUTY 확인. Origin 머리 제거(게이트웨이 CORS 403) |
| 경로 | `01f30f3` | 도로 경로 = 카카오모빌리티(`/sim-route`), 못 받으면 직선 |
| 화면 | `d21dcd3`·`825b757`·`a472ef5` | 라이더별 보기(탭 거르기), 배송 단계 막대·라이더 카드·따라가기, 지표 다시 정의(같은 완료 n 건의 구간 평균) |
| MFC 위치 | `0789dc6`·`aa1efb6` | 실서버는 center-master 에서 읽음, MOCK 은 부산진구지점 실제 주소. 백엔드 시험 MFC 위치 PR #56(사용자 지시로 이때만 백엔드 수정, 병합됨) |
| 점검 | `428d20d` | 다른 기기·서명키 없는 PC 에서 운행 버튼 막음 |
| P4 | `110b569`·`186b0ea` | ⚙ 시나리오 조절 바(주문량·수락률·포장 시간·고객 부재·응답 끊김), **재전송 본문 고정 결함 수정** |
| P4 | `262f88c` | 계약 `6df1e842` 반영, 재발송(MISDELIVERY_RESHIPMENT) 받기, 라이더 취소 → 재배차, 위치 끊김 → RiderLocationStale(30초 감시·3분), 포장 10분 넘으면 도움요청 STORE_WAITING |
| P4 | `92dcc38` | 실서버도 포장 대기 도움요청 보냄(사용자 "진행해"). 오배송 → 회수·재발송·다시 배송(MOCK 이 case·주문 사가 대신) |
| P4 | `590225d`·`55a4fa1` | 실서버 다시 배송 — 전달지 주소 → 좌표를 개발 서버 `/sim-geocode`(카카오 로컬 주소 검색)로(사용자 "그렇게 해") |

## 4. 지금 동작 요약
- **가상 라이더**(`src/sim/rider.ts`): 제안 판단 `decideOffer` — 받는 목적 DELIVERY·MISDELIVERY_RESHIPMENT·MISDELIVERY_RECOVERY, 다시 배송(MISDELIVERY_REDELIVERY)은 주소 찾기 수단(`AddressLocator.ready`)이 있을 때만, 반품은 거절. 단계: 대기 → 가게 이동 → 도착 → 인계 → 고객 이동 → 사진·완료. 추가 단계 FAILING·RETURNING(전달 실패 → MFC 복귀), TO_PICKUP·AT_PICKUP(잘못 둔 곳에서 받기).
- **오배송 흐름**(계약 DD-2, 호출 순서 정본 = 백엔드 `deploy/lan/checks/misdelivery_e2e.py`):
  - 회수(type RETURN): ASSIGNED 에서 사진 → `returns/pickups` → RETURN_PICKED_UP → MFC → `returns/store-deliveries` → RETURNED_TO_STORE, 배차 CLOSED.
  - 다시 배송(type RESHIPMENT, 고객 잘못): 사진 → `returns/pickups` → PICKED_UP → 전달지에 핀이 없어 도로명 주소로 좌표 찾기 → 일반 완료. 못 찾으면 도움요청 ADDRESS_ISSUE → 실패 ADDRESS_ERROR → 상품 들고 복귀. 200m 미만 원래 기사 먼저 0원, 이상이면 결제 대기.
  - 재발송: 일반 배송과 같이 수행.
- **MOCK 전용**(`src/backend/mock/MockBackend.ts`): 조절 바 knob(주문량·수락률·포장 배율·고객 부재·응답 끊김·라이더 취소·위치 끊김·오배송), MOCK 운영자 실패 확정 60초, 오배송 확인 5분 뒤 귀책 반반, 결제 70%·3분 [시뮬]. 실서버(`src/sim/realWorld.ts`)는 조절 안 함, 가짜 실패(부재·취소·위치 끊김)를 만들지 않음.
- **개발 서버**(`server/`): `/sim-auth`(시험 라이더 토큰 — 브라우저로 안 보내고 개발 서버가 붙임, `X-Sim-Rider`/`X-Sim-Actor` 머리만), 관찰 계정, `/sim-route`, `/sim-geocode`(POST 본문 `{address}`, 도로명 주소만, 주소·좌표 로그·보관 안 함, 401·403·429 면 그날 막음), 다른 기기 가드 `lanPolicy.ts`(`/sim-*` 는 이 PC 만).

## 5. 실서버 상태 (2026-11-17 아침)
- 가입된 시뮬레이터 라이더: `RD-sim-01`·`RD-sim-02`(지울 수 없음 — 탈퇴 501, RR-07). 2026-11-17 09:35 둘 다 OFF_DUTY 확인(마지막 변경 2026-11-16T09:09Z).
- 실서버에 이미 켜진 것: 재발송·회수·다시 배송 받기, 포장 10분 넘으면 도움요청(실제 지원센터 사건이 열림).
- 실서버에서 **아직 실제로 겪어 보지 못한 것**: 새 배차 요청이 화면에 뜨는 것(P2), 실제 주문 1건 DeliveryCompleted(P3 완료 기준), 회수·재발송·다시 배송·도움요청, 응답 끊김 뒤 같은 키 재전송. 오배송 사건은 운영자·상담원 화면이 있어야 생긴다.

## 6. 남은 일 (우선순위 순)
1. (끝 — 2026-11-17 09:35 OFF_DUTY 확인) 제안 `order`·`dropAreaPoint`·`dropEtaSeconds`·수행 `orderSummary` 는 2026-11-17 10:09 반영(MOCK·라이더 카드·40분 넘으면 TOO_FAR). 도움요청 대화·가입 면허는 라이더 앱에서 확인할 일이라 시뮬레이터에서는 안 함(사용자 2026-11-17). MFC 위치는 라이더용 픽업지 목록 `GET /mfc-pickup-points` 먼저, 못 읽으면 관찰 계정 센터 조회(2026-11-17 10:15 — LAN 서버는 아직 404 라 센터 조회로 돌아감. 배포되면 자동으로 새 길). 라이더를 늘리면 가입 본문에 면허(rider 0.5.0 — MOTORCYCLE 은 필수)를 같이 정해야 한다.
2. (끝 — 2026-11-17 09:56) 실서버 화면 진단 줄 "오배송 다시 배송: 받음 — …" 브라우저에서 확인. Chrome 확장이 여러 개 연결돼 있으면 PC 5 Chrome("PC5")을 골라야 localhost 가 열린다.
3. **P3 완료 기준**: 실제 PDA(또는 MFC 시뮬레이터) 주문 1건을 가상 라이더가 수락 → 인계 → 완료(DeliveryCompleted)까지. 진행 중 주문이 생길 때 사용자와 맞춰서.
4. 실서버 P4 장면 확인: 오배송 사건(운영자·상담원 화면)으로 회수·재발송·다시 배송, 포장 대기 도움요청.
5. 열린 백엔드 요청(기록만): RR-03(포장 QR 을 라이더 쪽에서 얻는 길 — 지금 계획은 관찰 계정으로 `GET /shipments/{id}`), RR-07(시뮬레이터 라이더 정리·탈퇴), RR-05(ETA·stream — 요청 아님).
6. 범위 밖(지금): 고객 반품 회수(백엔드 아직 없음), 가려진 탭에서 Worker 박자 실측(`[미검증]`).

## 7. 겪은 함정 (다시 밟지 않게)
- **Bash 에서 `node -e "..."` 안의 백틱이 명령 치환돼 문서 글자가 빈칸이 됨**(`186b0ea` 로 복구). 문서를 스크립트로 고칠 때는 Write 도구로 작업 폴더에 `.cjs` 를 만들어 실행하거나 Edit 도구를 쓴다. 따옴표 섞인 heredoc 도 깨지기 쉽다.
- MOCK `apiLog` 는 고리 버퍼라 오래 돌리는 시험에서 앞 기록이 밀려난다 → 시험은 `onApiCall` 듣개로 센다.
- 실행 기록의 시도 원인 값은 계약에 있는 값만(`'SYSTEM'` 없음 → `'AUTO'`).
- 결제 뒤 배차를 풀 때 `DeliveryAssignmentChanged` 를 내면 안 됨(계약상 그 사건이 아님).
- `RealWorld` 생성자의 네 번째 인자는 옵션 객체(`{fetch?, locator?}`).
- 브라우저가 POST 에 붙이는 Origin 을 게이트웨이가 본문 없는 403 으로 막음 → 개발 서버가 `/api` 요청의 Origin·Referer 를 지운다.
- 일지 제목 시각은 실제 시각으로(여러 번 바로잡음 — 커밋 전에 시계를 본다).
- 백그라운드 개발 서버는 PC 메모리가 부족하면 Claude Code 가 끌 수 있다(2026-11-17 발생). 끈 뒤 같은 포트를 다른 vite 프로세스가 잡고 있으면 그 프로세스를 끄고 띄운다.
