# rider 시뮬레이터 → MFC 시뮬레이터(`../pmart-mfc-simulation`) 요청 메모

> 이 저장소는 MFC 시뮬레이터를 **읽기만** 한다. 아래는 MFC 시뮬레이터 저장소에서 작업할 때 가져갈 내용이다. 반영되면 그쪽 커밋·날짜를 적고 "반영됨"으로 옮긴다.
> 기준: 2026-11-16. 역할 구분 정본은 `docs/design.md` §2-1(사용자 2026-11-16 "그 방향으로").

## 전제

- 배차는 백엔드 delivery-dispatch 가 한다. 실서버 모드에서 **라이더 API(수락·가게 도착·인계 허가/확정·완료)는 rider 시뮬레이터만 부른다.** MFC 시뮬레이터는 같은 라이더로 인계 API 를 부르지 않는다(겹치면 인계 충돌).
- MOCK 모드는 그대로 둔다(MFC 쪽 기존 가상 라이더 유지). 두 시뮬레이터의 MOCK 끼리는 연결하지 않는다.

## M-01 실서버 모드: 배차 상태·배정 라이더 표시 — 높음

출하(shipment)마다 배송의 배차 상태와 배정 라이더를 읽어 화면에 보인다.
- 출고 → 배송 연결: 출고 조회 `GET /shipments/{shipmentId}` 의 배차 요청 정보(`dispatchRequest`)·배송 ID(필드명은 mfc-fulfillment 계약 0.4.11 로 확인).
- 배차 조회 `GET /deliveries/{deliveryId}/dispatch`(delivery-dispatch 0.3.3, 그 센터 운영자 조회 가능): `state`(CREATED·DISPATCHING·ASSIGNED·PICKED_UP·…), `assignment.riderId`·`assignedAt`, 시도의 `currentRadiusKm`·`retryCount`.
- 보이는 곳: 오른쪽 "실제 주문" 탭의 출고 줄에 `배차 요청 대기 / 배차 중(반경 n km) / 배정 RD-… / 픽업 완료`, 출하대기 랙 칸 이름표.
- 조회 주기: 기존 SIM-5 대로 3초 주기에 맞추되, 출하 대기·배차 중인 출고만.

## M-02 실서버 모드: 앞마당 라이더·인계 장면 — 중간

- 수행 조회 `GET /deliveries/{deliveryId}`(delivery-execution 0.4.0, 그 센터 운영자): `state` 가 `ARRIVED_AT_STORE` 가 되면 앞마당(라이더 주차 자리)에 라이더를 세우고, 포장 상태가 인계(HANDED_OVER)로 바뀌는 대로 출하대기 랙에서 포장을 뺀다. `PICKED_UP` 이면 라이더가 떠난다.
- 라이더가 MFC 로 오는 중(ASSIGNED)은 rider 시뮬레이터 화면 몫 — MFC 화면에는 "오는 중 RD-…" 표만.
- 서버가 확정한 상태만 그린다(사건 반영이 늦으면 늦게 그린다 — 추측해서 먼저 그리지 않는다).

## M-03 가상 작업자 단계: 패킹 시작 때 배차 요청 — 그쪽 계획 확인

MFC 시뮬레이터 일지 2026-11-16 "배차 요청 = 패킹 시작 때(가상 작업자 단계에서 반영)". 들어가면 MFC 가상 작업자 → 백엔드 배차 → rider 시뮬레이터 가상 라이더가 저절로 이어진다. 추가 요청은 없고, 반영 시점만 알려 주면 rider 쪽 시험을 같이 맞춘다.

## 반영됨

MFC 시뮬레이터 세션 알림·그쪽 저장소 읽기(2026-11-16, 브랜치 `feat/backend-sync`, **미푸시**). 그쪽 기록: `../pmart-mfc-simulation/docs/backend-requests.md` "rider 시뮬레이터 요청" 절.

| 요청 | 상태 | 그쪽 커밋 | 내용 |
|---|---|---|---|
| M-01 배차 상태 표시 | 반영 | `a66e376` | 읽기만: `GET /shipments/{id}` → `GET /deliveries?mfcId=MFC-SEED-01`(execution 직원 배송 찾기) → 픽업 전 배송만 `GET /deliveries/{id}/dispatch`. `claude-mfc-wrk` 로 셋 다 200 확인 |
| M-03 패킹 시작 때 배차 요청 | 반영 | `887b0f1` | 실서버 가상 작업자 `mfcw-pp-01~10` 이 PACK 시작 직후 `POST /shipments/{id}/dispatch-requests {estimatedPackMinutes}` → 밀봉. 기본 0명, MFC 화면 왼쪽 "가상 작업자 (실서버)" 슬라이더로 켬. **실주문 끝까지는 미확인**(고객 앱 주문 필요) |
| M-02 앞마당 라이더 장면 | 반영 | `106e199` | `src/sim/realRider.ts` — 수행 상태 ARRIVED_AT_STORE 면 입구 → 주차 자리 → 출하대기 랙 앞, 출고 HANDED_OVER 또는 픽업 뒤 상태면 포장을 들고 떠남. 그리기만, 라이더 API 안 부름 |

- 그쪽 확인: MFC 시뮬레이터는 실서버에서 라이더·인계 API 를 부르지 않는다(§2-1 그대로).
- **그쪽 발견(그쪽 R-19)**: 인계까지 끝난 출고(`HANDED_OVER`)도 `Shipment.deliveryId` 가 null 이었다 → 출고 ↔ 배송을 배송 찾기의 `orderId` 로 잇는다. 이 시뮬레이터 영향은 `docs/design.md` §5 주의 참고.
