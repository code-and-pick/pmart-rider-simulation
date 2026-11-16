# PMart 배송·라이더 가상 현장 (카카오 지도 시뮬레이터)

MFC 에서 점원이 배차를 요청하면, 가상 라이더 여러 명이 백엔드 배송 서비스를 라이더 앱처럼 불러 **제안 수락 → MFC 이동 → QR 인계 → 고객 이동 → 전달 완료**를 수행하고, 그 모습을 카카오 지도 위에 그린다(라이더 마커는 입체처럼 꾸밈).
짝 프로젝트 `../pmart-mfc-simulation`(MFC 안 3D)과는 직접 연결하지 않고 백엔드 사건으로 이어진다.

> 상태(2026-11-16): **P1** — MOCK 백엔드·가상 라이더·지도 화면(카카오 / 좌표 평면 대체)까지. 실서버 모드는 P2. 다음 작업은 `docs/worklog/` 최신 일지의 "다음에 할 일".

## 문서

| 문서 | 내용 |
|---|---|
| [CLAUDE.md](CLAUDE.md) | 작업 규칙, 다른 PC 에서 시작하는 순서 |
| [docs/design.md](docs/design.md) | 설계 정본 — 연결 구조, 백엔드 계약 요약, 배차·수행 두 상태, 가상 라이더 순서, 화면, 단계 계획, 결정 이력 |
| [docs/backend-handoff.md](docs/backend-handoff.md) | 백엔드에서 무엇을 어디서 읽는지 |
| [docs/backend-requests.md](docs/backend-requests.md) | 백엔드에 요청·질문할 것(R-xx) |
| [docs/mfc-simulator-requests.md](docs/mfc-simulator-requests.md) | MFC 시뮬레이터에 넘길 것(M-xx) — 실서버 배차 상태·앞마당 인계 표시 |
| [docs/worklog/](docs/worklog/README.md) | 작업 일지(인수인계) |

## 스택

Vite 6 + TypeScript 5 + React 19 + Vitest — `pmart-mfc-simulation` 과 같다. 지도는 카카오맵 웹 JS SDK(지도 화면에는 react-three-fiber 를 쓰지 않음).

## 모드

| 모드 | 하는 일 |
|---|---|
| MOCK (기본) | 계약 의미를 브라우저 안에서 흉내. 주문·배차 요청·제안·포장 준비도 시뮬레이터가 대신 |
| 실서버 | 게이트웨이 `/api/v1` 실호출. 실제 PDA(또는 MFC 시뮬레이터) 배차 요청에서 생긴 배송만 처리 |

## 실행

```bash
npm install
npm run dev            # http://localhost:5181
npm test
PMART_GATEWAY=http://<게이트웨이>:8080 npm run dev   # 실서버 모드 프록시 대상
```

카카오 지도는 `.env.local` 에 `VITE_KAKAO_JS_KEY=<JavaScript 키>` 를 넣고, 카카오 개발자 콘솔 플랫폼 Web 에 `http://localhost:5181` 을 등록해야 뜬다(없으면 좌표 평면 대체 화면). Flutter 앱의 네이티브 앱 키와 다른 키다.

실서버 모드에는 LAN 비밀 파일(`../pmart-backend/deploy/lan/.secrets/`, Git 아님)이 필요하다 — `PMART_SECRETS_DIR` 로 바꿀 수 있다.
