# 배송·라이더 가상 현장(시뮬레이터) → pmart-backend 요청 목록

> 시뮬레이터는 `../pmart-backend` 를 **읽기만** 한다. 아래는 실서버 연동에 필요한 백엔드 쪽 변경·결정이다.
> 기준: 2026-11-16 최초 작성, 백엔드 `main` `aa46ce11`. 계약 버전: delivery-dispatch 0.3.3, delivery-execution 0.4.0, delivery-tracking 0.3.0, rider-service 0.4.0, rider-auth 0.1.0, mfc-fulfillment 0.4.11.
> 원칙(MFC 시뮬레이터와 같음): **백엔드 계약이 정본, 시뮬레이터와 안 맞는 부분은 시뮬레이터가 맞춘다.**
> 번호: **RR-xx**(rider 시뮬레이터 요청). MFC 시뮬레이터 요청(R-xx, `../pmart-mfc-simulation/docs/backend-requests.md`)과 번호가 겹치지 않게 2026-11-16 R → RR 로 바꿨다.
> 전달: 백엔드는 시뮬레이터 저장소를 읽기만 하고 회신은 백엔드 `docs/handoff/` 에 번호를 그대로 써서 남긴다(백엔드 `docs/handoff/simulator/README.md` 방식). **RR-01·RR-02 는 2026-11-16 사용자 경유로 백엔드에 전달 요청**(이 문서를 `origin/main` 에 푸시). 나머지는 아직 전달 전. 회신이 오면 위치·날짜를 적고 "해소"로 옮긴다.

## 연결 방식 (백엔드가 알아야 할 전제)

- **역할**: 시뮬레이터 한 대가 라이더 앱 여러 대를 연기한다. MFC 쪽(실제 PDA·MFC 시뮬레이터)은 건드리지 않고, 점원 배차 요청 뒤 생긴 제안만 받는다.
- **경로**: 브라우저 → Vite 개발 서버 `/api` 프록시 → 게이트웨이(`PMART_GATEWAY`) → 공개 계약 API. `/internal/*` 업무 API 는 부르지 않는다.
- **원칙**: 계약에 있는 API 만. 응답이 없으면 결과 불명으로 보고 같은 `Idempotency-Key` 로 재전송. `X-Source-System: rider-simulator`.

## 열린 요청

### RR-01 시뮬레이터 라이더 토큰 — 높음 (전달 2026-11-16, 회신 대기)
라이더 로그인은 Google ID 토큰뿐이고 고정 시험 계정이 없다(`docs/operations/lan-test-accounts.md`). `deploy/lan/checks/rider_e2e.py` 는 LAN rider-auth 서명키로 시험 라이더 토큰(typ=RIDER, 15분)을 직접 만든다(kickoff §6 — LAN 전용).
- 계획: 같은 방식을 Vite 개발 서버(이 PC 루프백만)에서 하고 브라우저에는 토큰만 준다. 서명키는 `deploy/lan/.secrets/` 에서 읽기만.
- 질문: 시뮬레이터가 이 서명키로 토큰을 만들어도 되는지. 안 되면 시뮬레이터용 대안(시험 라이더 토큰 발급 경로 등)을 정해 달라.
- 용도 두 가지(2026-11-16 추가): (1) 이 PC 브라우저의 가상 라이더 운행(읽기·쓰기), (2) **LAN 다른 기기의 조회** — 개발 서버가 시뮬레이터 라이더 ID 에 한해 GET 요청(`/riders/me/locations/latest`·`/riders/me/state`·`/riders/me/deliveries`·`/offers` 등)에만 토큰을 붙여 넘긴다. 다른 기기에는 토큰을 주지 않고, 쓰기·전달지(개인정보)는 넘기지 않는다(`docs/design.md` §6-4). 공개 API 로 라이더 위치를 직원이 읽을 길이 없어서 필요하다 — 대안으로 직원(운영자)용 라이더 위치 조회 API 가 생기면 (2)는 그것으로 바꾼다.

### RR-02 시뮬레이터 라이더 ID·가입 데이터 — 중간 (전달 2026-11-16, 회신 대기)
가상 라이더는 실제로 `POST /riders/signups` 로 가입한다(전화번호 고유). `rider_e2e.py` 는 `RD-claude-…` 를 쓴다.
- 계획: `RD-sim-01`~ 처럼 고정 ID 를 다시 쓰고, 전화번호는 시험 대역으로.
- 질문: 시뮬레이터 라이더 ID 접두어·수(예: 20명)·전화번호 대역을 정해 달라. 실제 라이더 목록·백오피스에서 구분할 표시가 필요한지(MFC SIM-8 "시뮬 계정으로 구분"과 같게 할지).

### RR-03 포장 QR 값을 라이더 쪽에서 얻는 방법 — 중간
인계 허가에는 포장 `qrCode`(`PKG:<id>:<버전>`)가 필요하다. 실제로는 포장 라벨을 찍지만, 라이더 토큰으로는 출고·포장을 조회할 수 없다(`GET /shipments/{id}` 는 OPERATOR, execution 응답 `packageIds` 는 인계된 것만 — `rider_e2e.py` 주석). `rider_e2e.py` 는 execution DB 를 읽어 대신한다.
- 계획: 관찰용 직원 계정(MFC 시뮬레이터와 같은 `claude-mfc-wrk`, 읽기만)으로 `GET /shipments/{shipmentId}` 를 읽어 qrCode 를 얻는다 = "라벨을 본다"는 시뮬레이터 가정.
- 질문: 이 방식이 괜찮은지, 아니면 시뮬레이터용으로 다른 길을 권하는지.

### RR-04 실서버 모드 이동 경로(도로) — 낮음
가상 라이더 이동을 도로 위로 그리려면 경로가 필요한데 tracking 거리 행렬은 `/internal` 이고 거리·시간만 준다.
- 질문: 시뮬레이터가 카카오모빌리티 길찾기를 직접 불러도 되는지(키·비용 정책). 안 되면 직선/고정 경로로 그리고 "도로 아님"을 표시한다.

### RR-05 ETA·실시간 stream — 낮음, 지금은 요청 아님
tracking `GET /deliveries/{id}/eta`·`/stream` 은 501(TR-1, 사용자 "필요 없음/선택"). 고객 화면 ETA 는 그리지 않는다. 기록만 남긴다.

## 시뮬레이터가 정한 값 (MOCK 흉내 — 서버 값이 아님)

아직 없음. MOCK 구현 때 `src/config.ts` 와 함께 적는다(예: MOCK 제안 만료 60초는 계약 값, 라이더 응답 지연 분포는 [시뮬]).

## 해소된 요청

없음.
