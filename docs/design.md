# 배송·라이더 가상 현장 설계

> 기준: 2026-11-16, 백엔드 `pmart-backend` `main` `cb2bf317`(처음 `aa46ce11` → DD-2 계약 반영). 계약 버전은 §3 표. PC 5 에서 `origin/main` `516e7cf5` 로 다시 확인 — 이 표의 계약 버전 그대로(그 사이 계약 변경은 case-service 만).
> 이 문서는 **설계와 결정의 정본**이다. 결정이 바뀌면 §10 이력에 날짜와 함께 남기고 본문을 고친다.

## 1. 목표와 범위

- 개발 환경에는 실제 라이더가 없다. 이 시뮬레이터가 **가상 라이더 여러 명**이 되어 백엔드 배송 서비스를 라이더 앱처럼 부른다.
- MFC 쪽(실제 PDA 앱 점원 또는 `pmart-mfc-simulation` 가상 작업자)이 **배차 요청**을 하면 그때부터 이 시뮬레이터가 일한다(사용자 2026-11-16).
- 화면은 **카카오 지도(웹 JS SDK) + 꾸민 마커**(사용자 2026-11-16 — 2D → 3D 검토 → 최종 "1번" 카카오 지도): MFC·고객 배송지·라이더 위치·이동 경로·배송 상태. 지도 자체는 평면(2D)이고 라이더 마커만 입체처럼 그린 그림이다. 자세히 §6.
- 모드 두 가지(사용자 2026-11-16): **MOCK**(백엔드 없이 브라우저 안에서 계약 의미를 흉내) / **실서버**(LAN 게이트웨이 `/api/v1`).
- 범위 밖(지금): 오배송 회수 배송(DD-2 — 백엔드 구현됨, §3-1, P4 시나리오 후보), 고객 반품 회수·재배송(백엔드 아직 없음), 운영자 상태 정정(501), 고객 화면 ETA(tracking ETA·stream 501), 수행료 정산, 실제 Google 로그인.

## 2. 연결 구조 — 두 시뮬레이터는 백엔드 사건으로만 이어진다

```
[MFC 현장]  실제 PDA(pmart-clients mfc_app) 점원 ─ 또는 ─ pmart-mfc-simulation 가상 작업자(예정)
   패킹 시작 + 예상 포장 시간(분)
   POST /shipments/{shipmentId}/dispatch-requests        mfc-fulfillment 0.4.11 (점원만, 출고당 1회)
        │  사건 DispatchRequested (mfc.fulfillment.v1)
        │  (ShipmentReady 만 오면 배송은 CREATED 로만 있고 배차는 안 시작 — BR-51 "자동요청빼")
        ▼
[delivery-dispatch]  배송 DISPATCHING → 시도(attempt) → 반경 1→2→3km 안 적격 라이더에게 제안(1분)
        │  사건 DeliveryCreated·DispatchOfferSent·DeliveryAssigned (delivery.delivery.v1)
        ▼
[이 시뮬레이터 — 가상 라이더]
   GET /offers 주기 조회(pollAfterSec) → 수락 → MFC 로 이동(위치 업로드) → 가게 도착
   → 포장마다 QR 인계(mfc-fulfillment 허가 → 확정) → [PackageHandedOver 로 execution 이 PICKED_UP]
   → 전달지 조회 → 고객으로 이동(위치 업로드) → 고객 도착 → 증빙 사진 → 전달 완료
        │  사건 DeliveryCompleted → dispatch CLOSED, order 완료 집계
```

- **시작점은 `DispatchRequested`(점원 배차 요청)이지 `ShipmentReady`(출하 대기)가 아니다.** 실제 PDA 앱은 패킹 시작 때 이미 배차 요청을 부른다(`pmart-clients/apps/mfc_app/lib/features/packing/data/packing_repository.dart`). 요청이 없으면 배송은 CREATED 에 머문다 → 화면에 "배차 요청 대기"로 보인다.
- MFC 시뮬레이터 실서버 가상 작업자(`mfcw-pp-01~10`, 기본 0명 — 그쪽 화면에서 켬)가 PACK 시작 직후 배차 요청을 부른다(그쪽 커밋 `887b0f1`, 2026-11-16 — M-03). 그래서 MFC 시뮬레이터 가상 작업자 → 백엔드 배차 → 이 시뮬레이터 가상 라이더 흐름이 저절로 이어진다(실주문으로 끝까지는 미확인).
### 2-1. 누가 무엇을 하나 (사용자 2026-11-16 "그 방향으로")

배차(라이더 찾기·반경 단계·제안·만료·동시 수락·재배차)는 **백엔드 delivery-dispatch** 가 한다. 두 시뮬레이터 어느 쪽도 배차를 구현하지 않는다(MOCK 흉내만 예외 — 아래).

| 단계 | 하는 쪽 | 실서버 모드 |
|---|---|---|
| ① 점원 배차 요청 `POST /shipments/{id}/dispatch-requests` | MFC 현장 | 실제 PDA 앱은 이미 호출. MFC 시뮬레이터 가상 작업자는 이 호출만 넣으면 됨(그쪽 계획) |
| ② 라이더 찾기·제안·만료·재배차 | 백엔드 delivery-dispatch | 시뮬레이터 할 일 없음 |
| ③ 제안 조회·수락·이동·가게 도착·QR 인계·고객 이동·완료 | **이 rider 시뮬레이터**(가상 라이더) | 계약 API 를 부름(쓰기) |

**화면은 둘 다 그리되, 라이더를 움직이는(API 를 부르는) 쪽은 rider 시뮬레이터 하나다.**

| | MFC 시뮬레이터 (3D, MFC 안) | rider 시뮬레이터 (카카오 지도, MFC 밖) |
|---|---|---|
| 보여 주는 것 | 출하대기 랙, **배정된 라이더·도착 예정**, 앞마당에서 QR 인계하는 장면 | 라이더 대기 위치, 제안·수락, MFC 로 이동, 고객으로 이동, 완료 |
| 실서버에서 하는 일 | **읽기만** — 배차 조회 `GET /deliveries/{id}/dispatch`(그 센터 운영자 볼 수 있음 — dispatch 계약), 수행 조회 `GET /deliveries/{id}`(그 센터 운영자), 출고·포장 상태 | **쓰기** — 수락·가게 도착·인계 허가·확정·완료 |
| 앞마당 라이더를 그리는 근거 | 수행 상태 ARRIVED_AT_STORE 면 나타나고, 포장 인계 확정되면 가져감 | 직접 그 API 를 부름 |

- 이유: (1) 두 시뮬레이터가 같은 라이더로 API 를 부르면 인계가 겹친다. (2) MFC 시뮬레이터 실서버 모드는 이미 "관찰 전용"(실제 PDA 작업을 읽어 그림)이라 같은 방식이다. (3) 나중에 실제 라이더 앱이 움직여도 MFC 화면은 그대로 된다.
- **MOCK 모드**는 두 시뮬레이터가 각자 혼자 돈다. MFC 쪽은 기존 가상 라이더(출하 대기 뒤 앞마당에 나타남), rider 쪽은 자기 MockBackend 가 배차 요청·배차를 흉내 낸다. MOCK 끼리는 연결하지 않는다.
- MFC 시뮬레이터 화면 변경은 그 저장소 작업이다(이 저장소는 읽기만). 넘길 내용: `docs/mfc-simulator-requests.md`.

- 실제 흐름 전례: `pmart-backend/deploy/lan/checks/rider_e2e.py` 가 2026-11-16 LAN 에서 가입 → 운행 → 제안 수락 → 가게 도착 → QR 인계 → 픽업 → 전달지 → 고객 도착 → 사진 → 완료를 끝까지 돌렸다. 실서버 호출 순서는 이 스크립트를 기준으로 맞춘다.

## 3. 백엔드 계약 요약 (읽은 날 2026-11-16, `cb2bf317` → 다시 `347ea90d`: dispatch 0.4.1·fulfillment 0.5.0)

모든 경로는 게이트웨이 `/api/v1` 아래. POST 는 `Idempotency-Key`·`X-Source-System` 필수, 상태 전이는 `X-Expected-Version`(낙관적 잠금) 사용.

| 서비스 · 계약 | 이 시뮬레이터가 부를 것 (라이더 토큰) | 구현 상태 (서비스 CLAUDE.md) |
|---|---|---|
| **rider-service** 0.4.0 | 가입 `POST /riders/signups`, 내 정보 `GET /riders/me`(404 = 미가입), 운행 상태 `PUT·GET /riders/me/state`(OFF_DUTY / 운행 중·신규배차 ON / 운행 중·신규배차 OFF), 배차 설정 `PUT·GET /riders/me/settings`(하나씩 배달하기, 배차 모드 일반/AI 추천) | 구현(탈퇴만 501). 변경마다 `RiderStateChanged` |
| **rider-auth-service** 0.1.0 | — (Google ID 토큰 로그인만. 시험 라이더 토큰은 RR-01) | 구현 |
| **delivery-dispatch** 0.4.1 (0.4.1: purpose `MISDELIVERY_RESHIPMENT`·type RESHIPMENT·`caseId` — 오배송 재발송) | 내 제안 `GET /offers`(SENT·미만료, `pollAfterSec` 잠정 5초, null 이면 조회 멈춤), 제안 조회 `GET /offers/{id}`(viewedAt 기록), 응답 `POST /offers/{id}/responses`(ACCEPT/REJECT, 결과 ASSIGNED/REJECTED/LATE), 배달리스트 `GET /delivery-list` + 수락 `POST /delivery-list/{deliveryId}/acceptances`, 배차 조회 `GET /deliveries/{id}/dispatch`(shipmentId·`purpose`·회수면 `recovery` 포함), 배차 취소 `POST /deliveries/{id}/assignment-cancellations`(픽업 전만) | 구현(DD-1 2026-11-13, DD-2 오배송 회수 2026-11-16). `POST /dispatch-requests`·`POST /internal/deliveries` 는 501 — 배송 생성·배차 시작은 MFC 사건(회수는 case `MisdeliveryConfirmed`)으로만. 0.4.0: `Offer.deliveryType`·`purpose`, `Delivery.purpose`·`recovery` |
| **delivery-execution** 0.5.0 | 수행 조회 `GET /deliveries/{id}`, 가게 도착 `…/store-arrivals`, 픽업 확인 `…/pickups`(handoverIds — 상태는 안 바꾸고 확인만), 전달지 `…/drop-info`(PICKED_UP 뒤, 개인정보 — 저장·로그 금지), 고객 도착 `…/customer-arrivals`, 증빙 사진 `…/evidence-photos`(multipart, JPEG·PNG·WEBP ≤10MB), 전달 완료 `…/completions`(FACE/CONTACTLESS + photoRefs), 전달 실패 `…/failures`, 도움요청 `…/help-requests`, 내 배송 `GET /riders/me/deliveries`. 회수 배송이면 `…/returns/pickups`·`…/returns/store-deliveries`(§3-1) | 구현. 0.5.0: 오배송 회수 수행 구현, 고객 반품 회수 422 RETURN_NOT_SUPPORTED, 운영자 정정 501 |
| **delivery-tracking** 0.4.0 | 위치 올리기 `POST /riders/me/locations`(1~200점, `lat·lng·recordedAt` 필수, `deliveryId` 선택), 내 마지막 위치 `GET /riders/me/locations/latest` | 위치 수신·마지막 위치·거리 행렬 구현. **ETA·실시간 stream 501**. 배달 중 3분 끊기면 `RiderLocationStale`(알림만). 0.4.0: 내부 `GET /internal/riders/{id}/location-at`(회수지 계산용 — 시뮬레이터는 안 부름) |
| **mfc-fulfillment** 0.5.0 (인계만 — 0.5.0 변경은 ConfirmOrder `kind`·사건 필드라 인계 API 그대로) | 인계 허가 `POST /packages/{id}/handover-authorizations`(scannedCode = 포장 qrCode `PKG:<id>:<버전>`, fence), 인계 확정 `POST /packages/{id}/handover-commits` → `PackageHandedOver` | 구현. 라이더 토큰 주체 = riderId 여야 함 |

배차 규칙(dispatch 계약 머리): 배차 방식 AI 추천(서버 제안) / 일반(배달리스트에서 골라 수락). 반경은 **MFC 중심 직선거리** 1→2→3km, 응답 대기 1분, 동시 수락 1명, 재시도 최대 2회·10분(외부 참고값), 배차 가능 08~24시(Asia/Seoul). 알뜰배달(BUNDLED) 1~3건은 같은 `bundleId` 로 묶여 한꺼번에 수락·거절. 하나씩 배달하기면 진행 중 배송이 있을 때 INELIGIBLE. 배달리스트 수락 최대 3건.

수행 규칙(execution 계약 머리): 시간 경과 자동완료 없음, GPS·버튼만으로 픽업 확정 금지(`PackageHandedOver` 근거), 완료는 사진 업로드 성공 후에만, 전달 실패는 운영자 확정 전까지 진행 중(FAILURE_REPORTED).

사건(토픽): MFC → `DispatchRequested`·`ShipmentReady`·`PackingFinished`·`PackageHandedOver`(mfc.fulfillment.v1) / dispatch → `DeliveryCreated`·`DispatchOfferSent`·`DeliveryAssigned`·`DeliveryAssignmentChanged`·`DeliveryCancelledBeforePickup`(delivery.delivery.v1) / execution → `PickupCompleted`·`DeliveryCompleted`·`DeliveryFailed`·`DeliveryIncidentRaised` / tracking → `RiderLocationStale`(delivery.tracking.v1) / rider → `RiderStateChanged`·`RiderRestricted`(delivery.rider.v1). 시뮬레이터는 사건을 직접 구독하지 못한다 — **REST 조회로 결과를 본다**.

### 3-1. 오배송 회수 배송 (DD-2, 2026-11-16 — dispatch 0.4.0·execution 0.5.0)

- 시작: case 가 오배송을 확인(`MisdeliveryConfirmed`)하면 dispatch 가 **새 배송**(type `RETURN`, purpose `MISDELIVERY_RECOVERY`)을 만들고 곧바로 배차. 회수지 = 원래 라이더가 전달 완료를 누른 곳(tracking 위치 기록, 없으면 원래 배송지), 도착지 = MFC.
- 후보: 원래 라이더를 뺀 **AI 추천 모드** 라이더, **회수지 중심** 직선 반경(같은 1→2→3km), 회수지까지 도로 시간이 가장 짧은 사람. 묶지 않고 배달리스트에 나오지 않는다. 제안의 `distanceKm` = 회수지 → MFC, `pickupDistanceKm`·`pickupEtaSeconds` = 라이더 → 회수지.
- 회수지 좌표는 `GET /deliveries/{id}/dispatch` 의 `recovery.pickup`(배정된 라이더·운영자만, 제안만 받은 라이더에게는 비움). 원래 배송의 완료 증빙(놓은 곳·사진 참조)은 execution `GET /deliveries/{id}` 의 `recoveryOrigin`.
- 수행: `ASSIGNED` → 회수지에서 사진(`…/evidence-photos`, RETURN 은 ASSIGNED·RETURN_PICKED_UP 에서) → `POST …/returns/pickups`(evidenceRefs 1장 이상, items 빈 배열) → `RETURN_PICKED_UP` + `ReturnPickedUp` → MFC 도착 = `POST …/returns/store-deliveries` → `RETURNED_TO_STORE` + `ReturnDelivered`(mfc-inbound 점원 수령 확인이 생기기 전까지 MFC 도착을 반납으로 봄).
- 회수 배송에는 일반 단계(가게 도착·픽업·고객 도착·완료·실패 등록)가 409, 전달지(`drop-info`)는 409 `NO_CUSTOMER_DROP`. 회수 실패(부재·거부)는 도움요청 → 운영자 배차 취소(reassign=false).
- **오배송 재발송(dispatch 0.4.1, 2026-11-16)**: MFC 재발송 출고로 생긴 배송은 type RESHIPMENT·purpose `MISDELIVERY_RESHIPMENT`·`caseId`, "배차는 일반 배송과 같다". 다만 execution 이 같은 단계(가게 도착 → 인계 → 고객 → 완료)로 처리하는지 계약(0.5.0)·서비스 문서에 없어서 **가상 라이더는 지금 거절**한다 — P4 에서 확인 뒤 받는다.
- 이 시뮬레이터: 가상 라이더 상태기계에 **회수 분기**가 필요하다(배송 `purpose` 로 분기). 시작 사건(오배송 확인)은 case 쪽이라 실서버에서 만들려면 운영자 화면이 필요 — P4 시나리오 후보로 둔다. 다만 실서버에서 회수 제안이 가상 라이더에게 올 수 있으므로 **P3 부터 `purpose` 가 DELIVERY 가 아닌 제안은 수락하지 않거나 회수 흐름으로 처리**해야 한다.

## 4. 같은 배송, 두 서비스의 두 상태

배송 하나(`deliveryId`)를 **delivery-dispatch** 와 **delivery-execution** 이 각자 자기 관점으로 갖고 있다(service-map §7: 배정 권리 = dispatch, 수행 = execution). 서로의 DB 를 읽지 않고 사건으로 사본을 맞추므로 **값 이름도, 바뀌는 시점도 다르다.**

| 흐름 | dispatch `DispatchState` (`GET /deliveries/{id}/dispatch`) | execution `ExecutionState` (`GET /deliveries/{id}`) |
|---|---|---|
| MFC 출하 대기(ShipmentReady)만 | CREATED | (배송 없음 — DeliveryCreated 전) |
| 점원 배차 요청 | DISPATCHING (시도·제안 진행) | UNASSIGNED (DeliveryCreated 받음) |
| 라이더 수락 | ASSIGNED | ASSIGNED (DeliveryAssigned 받음 — 조금 늦게) |
| 가게 도착 | ASSIGNED (모름) | ARRIVED_AT_STORE |
| 모든 포장 인계 확정 | PICKED_UP | PICKED_UP (+ PickupCompleted) |
| 고객 도착 | PICKED_UP (모름) | ARRIVED_AT_CUSTOMER |
| 전달 완료 | CLOSED (DeliveryCompleted 받음) | COMPLETED |
| 전달 실패 등록 → 확정 | PICKED_UP → CLOSED | FAILURE_REPORTED → FAILED |
| 픽업 전 배차 취소(재배차) | DISPATCHING (새 시도) | UNASSIGNED |
| 픽업 전 취소(재배차 없음·주문 취소) | CANCELLED_BEFORE_PICKUP | CANCELLED |
| 라이더 못 찾음 | DISPATCH_FAILED | UNASSIGNED |
| 주문 취소로 차단 | BLOCKED | — |
| (회수 배송) 회수품 수거 → MFC 반납 | ASSIGNED → CLOSED | ASSIGNED → RETURN_PICKED_UP → RETURNED_TO_STORE (§3-1) |

- dispatch 는 **누가 맡았나**(배정 권리)만 알아서 가게 도착·고객 도착은 모른다. execution 은 **어디까지 했나**를 알지만 제안·반경·재시도는 모른다.
- **버전도 따로 오른다**(events.md §7 — 발행 서비스마다). 서비스 사이 순서는 `assignmentVersion`·상태로 판단한다.
- **사건이 늦게 도착할 수 있다.** 수락 직후 execution 이 아직 UNASSIGNED 일 수 있어 `rider_e2e.py` 도 execution 에 riderId 가 보일 때까지 최대 30초 기다린 뒤 가게 도착을 부른다. 시뮬레이터도 "반영 대기"를 상태로 두고 실패로 보지 않는다.
- Delivery-Test 의 `IN_TRANSIT`(배송 출발)·`ARRIVED_AT_MFC` 같은 이름은 백엔드에 없다. 백엔드는 픽업 뒤 바로 고객 쪽으로 가는 PICKED_UP 하나다.
- 화면: 배송 카드에 **두 상태를 출처와 함께** 보인다(예: `배차 PICKED_UP · 수행 ARRIVED_AT_CUSTOMER`). 하나로 합친 "표시 단계"를 만들 때는 계산 규칙을 `src/domain` 한 곳에 두고 정본 값처럼 보이지 않게 한다.

## 5. 가상 라이더 (실서버 모드 순서)

`rider_e2e.py` 와 같은 순서. 각 단계는 계약 API 하나이고 응답 없음 = 결과 불명(같은 키로 재전송 또는 조회).

1. **준비**: 시험 라이더 토큰(RR-01) → `GET /riders/me` 404 면 가입 → 운행 상태 ON_DUTY + 신규배차 ON → 배차 설정(AI 추천 / 일반).
2. **대기**: MFC 근처 대기 위치를 주기적으로 업로드(반경 판정은 tracking 마지막 위치 기준). `GET /offers` 를 `pollAfterSec` 간격으로. 일반 모드는 `GET /delivery-list`.
3. **수락**: 제안 상세 → ACCEPT(시뮬 정책에 따라 일부 REJECT·무응답 만료도). 결과 LATE 면 그 이유를 기록하고 대기로.
4. **MFC 로**: 경로를 따라 이동하며 위치 업로드(`deliveryId` 붙임) → execution 에 배정이 보이면 가게 도착.
5. **인계**: `GET /deliveries/{id}/dispatch` 의 shipmentId → 포장 목록·qrCode 확보(RR-03) → 포장마다 허가 → 확정. 출고가 아직 READY 가 아니면(포장 중) 가게에서 기다린다(대기 시간 = 지표).
   - 주의(2026-11-16 MFC 시뮬레이터 발견, 그쪽 R-19): MFC 출고 `Shipment.deliveryId` 가 인계 뒤에도 null 이었다. 이 시뮬레이터는 반대 방향(배송 → dispatch `Delivery.shipmentId` → 출고)으로 잇는데, dispatch 의 `shipmentId` 는 **채워진다**(2026-11-16 P2 실측 — MFC-SEED-01 배송 4건 모두, 관찰 계정 `GET /deliveries/{id}/dispatch`). 그래서 배송 → dispatch `shipmentId` → 출고로 잇는다. 비어 있는 배송이 나오면 MFC 시뮬레이터처럼 `orderId` 로 잇는다(엔진은 지금 오류로 멈춘다 — P3 에서 orderId 대체 추가 여부 결정).
6. **픽업 확인**: execution 이 PICKED_UP 이 될 때까지 조회(사건 반영). `POST …/pickups` 로 handoverIds 확인(선택).
7. **고객으로**: `…/drop-info` 로 배송지 핀(lat·lng)만 쓰고 주소·전화는 화면·로그에 남기지 않는다 → 이동하며 위치 업로드.
8. **도착·완료**: 고객 도착 → 시험용 사진 업로드 → 전달 완료. (시나리오에 따라 전달 실패·도움요청·배차 취소)
9. 다시 2번. 운행 종료는 진행 중 배송이 없을 때만(409).

MOCK 모드는 같은 포트(`RiderPort`) 메서드를 MockBackend 가 받는다. MOCK 은 배차 요청·출하 대기·포장·제안 생성처럼 **다른 서비스가 하는 일도 시뮬레이터가 대신**한다(MFC 시뮬레이터 `simulation.ts` 머리 주석 방식).

## 6. 화면 (카카오 지도 + 꾸민 마커)

결정(사용자 2026-11-16 "1번으로 하자"): **카카오맵 웹 JS SDK 지도 위에 마커를 꾸며 올린다.** 지도는 기울기·회전 없는 평면이고, 입체감은 마커 그림으로만 낸다. (검토했던 OSM 데이터 3D 도시안은 채택하지 않음 — §10.)

### 6-1. 지도

- 카카오맵 JS SDK 를 `dapi.kakao.com` 에서 불러 React 컴포넌트 안 `div` 에 지도를 띄운다. **서드파티 React 래퍼는 쓰지 않는다**(P1 결정 — 의존성·라이선스 줄이기). 불러오기와 쓰는 부분만의 타입은 `src/render/kakao.ts`(손으로 적은 타입 — SDK 문서로 다시 확인 안 함 `[미검증]`).
- **키**: 카카오 개발자 콘솔 같은 앱의 **JavaScript 키**(Flutter 앱이 쓰는 네이티브 앱 키와 다름). 앱 설정 → 플랫폼 → Web 에 개발 서버 주소(`http://localhost:5181`, LAN 의 다른 PC 에서 열면 그 주소도)를 등록해야 지도가 뜬다.
- **콘솔에서 카카오맵 사용 설정이 따로 필요하다**(2026-11-16 확인): 꺼져 있으면 SDK 요청이 403 `NotAuthorizedError` "App(PMart Rider Simulator) disabled OPEN_MAP_AND_LOCAL service"(브라우저에서는 503 으로 보였다) → 좌표 평면 대체 화면으로 돈다.
- 키는 `.env.local` 의 `VITE_KAKAO_JS_KEY` 로 넣는다(Git 제외 — `.gitignore` 의 `.env.*`). JavaScript 키는 브라우저에 노출되는 키라 도메인 등록으로 제한한다. **REST API 키는 브라우저에 두지 않는다**(쓰게 되면 Vite 개발 서버에서만 — RR-04).
- 키가 없거나 SDK 를 못 불러오면 지도 없이 **좌표 평면 대체 화면**(MFC 원점 격자 + 점)으로 계속 돈다. MOCK 시험·화면 없는 vitest 는 카카오에 의존하지 않는다.
- 이용 조건(일일 호출 한도·상업 이용·로고 표기)은 키 등록 때 확인해 여기에 적는다 `[미검증]`. 카카오 로고·저작권 표기는 지우지 않는다.
- 스택 영향: 지도 화면에는 react-three-fiber 를 쓰지 않는다(스택의 Vite·TS·React 19·Vitest 는 그대로). r3f 는 마커를 3D 로 미리 그려 이미지로 굽는 용도 등 필요할 때만.

### 6-2. 그리는 것

| 대상 | 카카오 SDK 기능 | 표현 |
|---|---|---|
| MFC | 커스텀 오버레이 | 건물 아이콘 + 센터 ID, 반경 1·2·3km 원(`Circle`) |
| 고객 배송지 | 마커 이미지 | 핀. 주소·이름은 표시하지 않음(개인정보 — 배송 ID 만) |
| 라이더 | **커스텀 오버레이(HTML·CSS)** | 입체처럼 그린 오토바이 스프라이트, 진행 방향별 그림(8방향 등), 상태별 색 고리, 라이더 ID 이름표, 이동은 화면 박자마다 좌표 보간 |
| 이동 경로 | `Polyline` | 경로 출처에 따라 선 모양 구분(§6-3) |
| 배송 카드·로그·지표 | React 패널(지도 밖) | 두 상태 §4, API 로그·사건 로그, 지표(제안→수락, 수락→가게 도착, 가게 대기, 픽업→완료) |

- 매 프레임 바뀌는 라이더 위치는 React 상태로 올리지 않고 오버레이 객체의 `setPosition` 을 직접 부른다(MFC 시뮬레이터의 `useFrame` 규칙과 같은 뜻). 패널은 약 4Hz.
- MFC 위치: 실서버는 center-master `GET /centers/{centerId}` 의 `coordinates`(정본). `rider_e2e.py` 기본값 `MFC-SEED-01` = `35.1578, 129.0597`(부산) — 확인 전까지 `[가정]`.

### 6-3. 이동 경로

- 실서버 배차·거리 계산은 백엔드가 카카오모빌리티로 한다. 시뮬레이터의 **화면 이동 경로는 그것과 별개**다(거리 행렬 `/internal` 은 못 부르고, 경로 좌표도 주지 않음). 카카오맵 JS SDK 에는 길찾기가 없다.
- 도로 경로: 카카오모빌리티 길찾기(REST 키, 서버에서만)를 Vite 개발 서버가 부르는 안 — RR-04 회신·키·비용 확인 뒤.
- 그 전까지: 직선(또는 손으로 만든 고정 경로)으로 이동하고 선을 점선으로 그려 **"직선 — 도로 경로 아님"**으로 표시한다. **직선 경로를 도로 경로라고 표시하지 않는다.**

### 6-4. 접속 주소와 다른 기기에서 보기 (사용자 2026-11-16 "1번으로")

MFC 시뮬레이터 실행 구조(그쪽 커밋 `d0dd0b2`, `vite.config.ts` `server.host: true` + `server/simAuth.ts`)를 그대로 따르고, 라이더 위치를 보기 위한 부분만 넓힌다.

| 구분 | 이 PC (`http://localhost:5181`) | 다른 기기 (`http://<이 PC IP>:5181`) |
|---|---|---|
| 화면 | 전부 | 전부(보기만) |
| 토큰 | **브라우저는 토큰을 받지 않는다**(P2 결정): `X-Sim-Rider: RD-sim-NN` / `X-Sim-Actor: observer` 만 보내면 개발 서버가 서명·로그인해 붙인다. `/sim-auth/status`(비밀 파일 있는지만)는 루프백만 | **토큰을 주지 않음** — 같은 방식으로 개발 서버가 붙이되 아래 허용 목록만. `/sim-auth/*` 는 루프백만(`LOOPBACK_ONLY`) |
| 백엔드 호출 | 읽기·쓰기(가상 라이더 운행) | **GET·HEAD 만**(그 밖 403 `LAN_READ_ONLY`). 개발 서버가 들어온 Authorization 을 지우고 아래 토큰을 붙여 프록시로 넘김 |
| 가상 라이더 | 켤 수 있음 | 켜지 않음 |

다른 기기 조회에 개발 서버가 붙이는 토큰:
- **직원 조회 경로**(`GET /deliveries?mfcId=`, `/deliveries/{id}`, `/deliveries/{id}/dispatch`, `/shipments/{id}`) → 관찰 직원 계정 토큰(MFC 시뮬레이터와 같은 `claude-mfc-wrk` — 계정은 P2 에서 확정).
- **라이더 본인 경로**(`GET /riders/me`, `/riders/me/state`, `/riders/me/locations/latest`, `/riders/me/deliveries`, `/offers`) → 요청 헤더 `X-Sim-Rider: <라이더 ID>` 가 **시뮬레이터 라이더 목록(RR-02)** 에 있을 때만 그 라이더의 시험 토큰을 개발 서버가 서명해 붙인다(RR-01). 목록 밖 ID·헤더 없음은 403. 라이더 위치·제안은 공개 API 로는 본인 토큰으로만 읽을 수 있어서 필요하다(tracking `/internal/rider-locations` 는 내부 전용).
- **허용 목록 밖 경로는 다른 기기에서 막는다.** 특히 `GET /deliveries/{id}/drop-info`(고객 주소·전화 — 개인정보)는 다른 기기로 넘기지 않는다.
- 다른 기기 화면은 MFC 시뮬레이터 실서버 관찰처럼 **백엔드에서 읽은 것만** 그린다: 시뮬레이터 라이더 목록을 돌며 마지막 위치·운행 상태·진행 중 배송을 주기 조회(간격은 `src/config.ts` `[시뮬]`, 게이트웨이 처리율 제한은 JWT 주체 단위라 라이더마다 따로 셈). 이 PC 브라우저 안 엔진 상태(다음 행동·대기 사유 등)는 다른 기기에 보이지 않는다.
- RR-01 은 2026-11-16 승인(§6-5 조건 5). 서명키가 없는 PC 에서는 라이더 본인 경로를 넘길 수 없다 → 다른 기기에서는 배송 목록·상태만 보이고 지도 위 라이더 위치는 비어 있다("서명키 있는 PC 에서만 라이더 위치 표시" 안내).
- 카카오 콘솔 [플랫폼 → Web] 등록 주소: `http://localhost:5181` + 다른 기기에서 여는 `http://<이 PC IP 또는 호스트 이름>:5181`. PC 마다 IP 가 다르면 그 PC 주소를 추가한다.
- Windows 방화벽: 이 PC 의 Node.js 들어오는 연결 허용이 필요할 수 있다(사용자 승인 — MFC 시뮬레이터는 규칙 있음).

### 6-5. 시험 라이더 토큰 — RR-01 회신 조건 (백엔드 `docs/handoff/simulator/rider/2026-11-16-simulator-reply-rider-token-rr01.md`, 사용자 "A번")

rider-auth 에 시험 토큰 발급 경로는 없다. **Vite 개발 서버가 LAN rider-auth 서명키로 직접 서명**하되 아래를 지킨다.

| # | 조건 | 구현에서 |
|---|---|---|
| 1 | Vite 개발 서버(Node)에서만 서명. 서명키는 브라우저·번들·localStorage·sessionStorage 에 두지 않고 브라우저에는 토큰만 | `server/` 플러그인에서만 키를 읽는다(`server/secrets.ts`·`riderToken.ts`). `src/` 는 키도 토큰도 모른다 — 토큰은 개발 서버가 프록시 요청에 붙인다(`server/devServer.ts`). 빌드 결과에 비밀 문자열 없음 확인 |
| 2 | 키는 `PMART_SECRETS_DIR`(기본 `../pmart-backend/deploy/lan/.secrets`)의 `rider-auth-signing-key.pem`·`rider-auth-signing-kid` 를 **읽기만**. 다른 PC·다른 폴더로 복사하지 않음(실서버 모드는 비밀 파일이 있는 PC 에서만). 운영 키에 쓰지 않음 — LAN 전용. **예외: 작업 PC 인 PC 5 의 같은 경로에는 사용자가 복사해 둔다(RR-06 사용자 결정 2026-11-16)** | 파일이 없으면 실서버 모드를 끄고 MOCK 만(오류 안내) |
| 3 | 주체(`sub`)는 **`RD-sim-` 접두어 라이더만**. 서명 함수 안에서 접두어가 아니면 거절 | 서명 함수 첫 줄 검사 + vitest |
| 4 | `rider_e2e.py` 와 같은 모양: RS256, `kid` = 서명키 ID, `iss` = LAN rider-auth 발급자, `aud: ["pmart-api"]`, `typ: "RIDER"`, `roles`·`centers` 빈 배열, `sid` = `sim-…` 새 값, **유효 15분**(`exp = iat + 900`), `jti` 새 값. 만료되면 새로 만듦(재사용·연장 없음) | 만료 직전이면 새 토큰. 같은 토큰 연장 금지 |
| 5 | LAN 다른 기기에는 토큰을 주지 않음. 개발 서버가 GET·HEAD 허용 목록(라이더 본인 조회)만, 시뮬레이터 라이더 ID 에 한해 붙여 넘김. 쓰기·`drop-info` 는 넘기지 않음. 직원용 라이더 위치 조회 API 가 생기면 그것으로 바꿈 | §6-4 그대로 |
| 6 | 토큰·서명키·고객 주소·전화번호를 로그·일지·화면에 남기지 않음. 요청 로그에는 라이더 ID·경로·상태 코드만 | API 로그 형식 고정 |
| 7 | 세션 차단(라이더 정지 등)으로 401 이면 새 토큰을 만들되, 같은 라이더가 정지 상태면 운행하지 않음 | 401 → 새 토큰 1회 → `GET /riders/me` 로 제한 확인 → 정지면 그 라이더 멈춤 |

## 7. PMart-Delivery-Test 에서 참고만 하는 것 (사용자 2026-11-16 "참고만")

PMart-Delivery-Test 는 **배송 기능(배차·인계·위치 추적·경로 재생·Android 2대 E2E)이 가능한지 시험한 프로젝트**다(사용자 2026-11-16). 그 결과를 바탕으로 실제 구현은 pmart-backend 의 delivery-*·rider-* 서비스로 따로 만들어졌다. 그래서 그쪽 계약(`com.baropick`, `/api/rider/...`, 단일 서비스·단일 상태)은 정본이 아니고, API·상태값·필드는 가져오지 않는다. 아이디어만:

| 아이디어 | 그쪽 위치 | 여기서 쓰는 방식 |
|---|---|---|
| 결정적 경로 재생(누적 거리 보간, 가상 시계, 같은 seed = 같은 결과) | `delivery-service/.../testsupport/simulation/RoutePlayback.java` | `src/sim` 라이더 이동 — TypeScript 로 새로 작성 |
| 위치 장애 주입 7종(STOP·DROP·DELAY·DUPLICATE·REORDER·ANOMALY·DISCONNECT) | `.../simulation/FaultSpec.java` | 시나리오 옵션. 백엔드가 어떻게 기록하는지(gpsQuality)는 tracking 계약 기준으로 본다 |
| 시험 시나리오 목록 D-01~D-35 | `CLAUDE.md` §8, `docs/delivery-implementation/TEST_MATRIX.md` | 해당하는 것만 시나리오로 옮겨 이름을 다시 붙인다 |
| 경로 fixture 형식 | `src/main/resources/fixtures/routes/*.json` | MOCK 경로 데이터 형식 참고 |

## 8. 모드

| 모드 | 하는 일 |
|---|---|
| MOCK (기본) | 계약 의미를 브라우저 안에서 흉내. 주문 유입 → 배차 요청 → 제안 → 포장 준비 → 인계까지 시뮬레이터가 대신. 배속 가능. |
| 실서버 | 게이트웨이 `/api/v1` 실호출, 시계는 실제 시각 1×(MFC SIM-1 과 같게). 배송은 실제 MFC 배차 요청에서만 생긴다(가짜 주문 없음 — MFC SIM-4 와 같게). |

## 9. 단계 계획

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| P0 | 골격: package.json·vite(포트 5181, `/api` 프록시)·tsconfig, `src/domain/contract.ts`(§3 계약 사본), `src/backend/port.ts`(`RiderPort`), `src/config.ts` + LAN 다른 기기 가드(`server/lanPolicy.ts` — §6-4 중 토큰 붙이기 뺀 부분) | typecheck·빌드 통과 — **완료 2026-11-16 PC 5** |
| P1 | MOCK 백엔드 + 가상 라이더 상태기계 + 카카오 지도 화면(§6 — 키 없으면 좌표 평면 대체, MFC·고객·라이더 마커·경로선) | 화면 없이 도는 vitest(배차→완료 1건, 동시 수락 1명, 픽업 전 사진 완료 거부 등) — **완료 2026-11-16**(시험 25건). 카카오 지도 화면은 콘솔 카카오맵 사용 설정 뒤 실제로 띄워 확인 필요(좌표 평면으로만 확인) |
| P2 | 실서버 읽기: 라이더 토큰(RR-01), 관찰 계정 토큰, 배차 대기 배송·제안 조회 표시, 다른 기기 조회 경로(§6-4), dispatch `shipmentId` 실측(§5) | LAN 에서 실제 PDA 배차 요청이 화면에 뜸 — **구현·LAN 읽기 확인 2026-11-16**(기존 배송 4건·토큰 두 종류·다른 기기 경로). 진행 중인 배차 요청이 없어 "새 배차 요청이 뜨는 것"은 아직 못 봄 |
| P3 | 실서버 쓰기: 가상 라이더 수락 → 인계 → 완료 | 실제 PDA 주문 1건이 DeliveryCompleted 까지 — **실서버 가입·운행 확인 2026-11-16**(RD-sim-01·02 가입 201 → ON_DUTY → 위치·제안 조회 → 운행 종료 OFF_DUTY). 완료 기준(실제 주문 1건 완료)은 진행 중 주문이 없어 아직 |
| P4 | 시나리오: 거절·만료·재배차·전달 실패·도움요청·위치 끊김(장애 주입) | 시나리오별 기대 결과 기록 |

## 10. 결정 이력

| 날짜 | 결정 | 출처 |
|---|---|---|
| 2026-11-16 | 기술 스택 = pmart-mfc-simulation 과 동일 | 사용자 |
| 2026-11-16 | 참고 프로젝트 = pmart-mfc-simulation(구조·규칙), PMart-Delivery-Test(참고만) | 사용자 |
| 2026-11-16 | 계약 정본 = pmart-backend delivery-*/rider-* OpenAPI | 사용자 |
| 2026-11-16 | 시작점 = MFC(실제 PDA·MFC 시뮬레이터)가 배차 요청을 한 뒤. 두 시뮬레이터는 백엔드 사건으로만 연결 | 사용자 요청 + 설계(§2) |
| 2026-11-16 | 화면 = 2D 지도, MOCK 모드 유지, 백엔드·형제 저장소는 읽기만 | 사용자 |
| 2026-11-16 | 역할 = 배차는 백엔드, 라이더 API 는 rider 시뮬레이터만, MFC 시뮬레이터는 실서버에서 배차·수행 상태를 읽어 앞마당 인계만 그림(§2-1) | 사용자 "그 방향으로" |
| 2026-11-16 | 화면 2D → 3D 검토(권장안 = OSM 데이터로 3D 도시) | 사용자(3D), 권장안은 설계 |
| 2026-11-16 | 접속 = MFC 시뮬레이터 방식(`host: true`, 토큰은 이 PC 만, 다른 기기는 GET 만) + 다른 기기 라이더 위치는 개발 서버가 시뮬레이터 라이더 토큰을 붙여 조회만 넘김(§6-4, RR-01 회신 전에는 배송 상태만) | 사용자 "1번으로" |
| 2026-11-16 | 시험 라이더 토큰 = 개발 서버가 LAN 서명키로 직접, 조건 7개(§6-5) | 백엔드 회신 RR-01(사용자 "A번") |
| 2026-11-16 | 작업 PC = PC 5. 서명키는 PC 5 의 같은 경로에 사용자가 복사해 읽기만(RR-01 조건 ② 예외) | 사용자(RR-06) |
| 2026-11-16 | **최종: 카카오 지도(웹 JS SDK) + 꾸민 마커**(지도는 평면, 라이더는 입체처럼 그린 커스텀 오버레이). OSM 3D 도시안은 채택 안 함. 지도 화면에 r3f 미사용 | 사용자 "1번으로 하자" |
| 2026-11-16 | P0: `host: true` 를 켜는 순간부터 다른 기기 가드를 둔다 — 다른 기기는 GET·HEAD 허용 목록만(아니면 403 `LAN_READ_ONLY`/`LAN_PATH_BLOCKED`), Authorization 지움, `/sim-auth` 루프백만. 토큰 붙이기는 P2 | 설계(§6-4 를 앞당김) |
| 2026-11-16 | 의존성 범위는 MFC 시뮬레이터와 같게 두되 **Vite 는 6.4.6 이상**(`^6.4.6`) — MFC 시뮬레이터 lock 의 6.3.5 는 Windows `server.fs.deny` 우회 등 high 권고 대상이고 이쪽은 LAN 에 연다. **Vitest 는 3.x 유지** — `npm audit` 권고(tinypool·@vitest/mocker)는 남지만 `npm test` 때만 잠깐 도는 시험 도구라 LAN 에 열리지 않고, 고치려면 Vitest 5(주 버전)로 MFC 시뮬레이터와 스택이 달라진다 | 설계(보안 권고) / Vitest 유지는 사용자 2026-11-16 "응" |
| 2026-11-16 | 게이트웨이 기본값 `http://192.168.0.40:8080`(`rider_e2e.py` 37행과 같은 곳). MFC 시뮬레이터는 `http://D603-16:8080` — `PMART_GATEWAY` 로 바꾼다 | 설계 |
| 2026-11-16 | P1: 카카오 지도는 SDK 직접(React 래퍼 없음). 카카오 화면과 좌표 평면이 같은 `MapSurface`·같은 HTML 마커를 쓴다 | 설계 |
| 2026-11-16 | P1: 시뮬레이션 진행은 50ms 타이머(한 번에 실제 1초까지), 그리기는 rAF — rAF 는 가려진 창에서 초당 1~2회로 줄어 시각이 밀렸다(실측). 실서버(P2)는 백그라운드 탭 타이머 제한(분당 1회까지)이 남는다 → P2 에서 Worker 또는 "탭을 앞에 둘 것" 결정 | 설계 |
| 2026-11-16 | P1 MOCK 단순화: AI 추천 제안은 그 반경 단계 안 적격 라이더 모두에게 한 번에, 반경 한 단계 60초, 전달지 값은 가짜(좌표만 의미) — `docs/backend-requests.md` "시뮬레이터가 정한 값" | 설계 [시뮬] |
| 2026-11-16 | 가상 라이더는 purpose ≠ DELIVERY(회수 등) 제안을 거절한다(§3-1 — 회수 흐름은 P4). 제안 응답이 4xx 면(그 사이 닫힌 제안) 멈추지 않고 대기로 | 설계 |
| 2026-11-16 | P2: **토큰은 브라우저에 주지 않는다** — 이 PC 도 다른 기기와 같이 `X-Sim-Rider`/`X-Sim-Actor` 머리글만 보내고 개발 서버가 붙인다(§6-4 표의 "브라우저가 `/sim-auth` 에서 받아" 를 바꿈. RR-01 조건 1 보다 엄격). 401 이면 그 토큰을 버리고 다음 요청에 새로 | 설계 |
| 2026-11-16 | P2: 관찰 계정 = `claude-mfc-wrk`(staff_auth.py 와 같은 Keycloak 비밀번호 로그인 → employee-auth 시험 토큰 교환). LAN 에서 `GET /deliveries?mfcId=`·`/deliveries/{id}/dispatch` 200 확인 | 설계(§6-4 "P2 에서 확정") |
| 2026-11-16 | P2: 모드는 주소 `?mode=http` 로 고르고 바꾸면 페이지를 새로 연다(브라우저 저장소에 두지 않음). 실서버는 벽시계 1×, 배속 잠금 | 설계 |
| 2026-11-16 | **P3 는 가입 없이 준비만** — 실서버 가입·운행은 `REAL_RIDER_GATE`(operationAllowed·signupAllowed 둘 다 false)로 잠근다. 가입한 라이더는 지울 수 없다(탈퇴 501, 계약상 탈퇴도 미정산 수행료가 있으면 409) → RR-07 | 사용자 "가입 없이 할 수 있는 P3 준비만 먼저" |
| 2026-11-16 | 탈퇴는 백엔드 작업이라 이 저장소는 고치지 않는다(백엔드 읽기만) — 포트·MOCK 만 계약대로 준비하고 RR-07 로 요청 | 설계(절대 규칙) |
| 2026-11-16 | RR-01 조건 7 구현: 401 → `GET /riders/me`(개발 서버가 새 토큰) → SUSPENDED·TERMINATED 면 그 라이더 멈춤, 아니면 한 번만 다시(`src/sim/authGuard.ts`). 준비 단계에서도 정지 라이더는 운행을 켜지 않는다 | 설계 |
| 2026-11-16 | **실서버 잠금 풀기**: 운행·가입 허용, 시뮬레이터 라이더 2명(RD-sim-01·02), 전화 `010-0000-00NN` — RR-02 를 사용자가 정함. 백엔드도 사용자가 맡으므로 RR 전달(PR·handoff)은 하지 않는다 | 사용자 "백엔드도 내가 하니까 PR 전달할 필요 없어. 시험 번호로 시작" |
| 2026-11-16 | 운행 종료 = OFF_DUTY(진행 중 배송은 끝낸 뒤, 반영 지연 409 는 5초 간격 다시). 운행 중 탭 닫기는 브라우저가 묻는다 — ON_DUTY 로 남은 라이더에게 실제 제안이 가지 않게 | 설계 |
| 2026-11-16 | 개발 서버가 `/api` 요청의 `Origin`·`Referer` 를 지운다 — 브라우저가 POST 에 붙이는 Origin 을 게이트웨이 CORS 가 본문 없는 403 으로 막음(실측) | 설계 |
| 2026-11-16 | 재발송 배송(purpose MISDELIVERY_RESHIPMENT)은 지금 거절(§3-1) — execution 처리 확인 뒤(P4) | 설계 |
| 2026-11-16 | 진행 박자는 전용 Worker 타이머(Blob 한 줄, 안 되면 setInterval). 실서버는 벽시계로 따라잡기(최대 600초) — 가려진 탭에서 위치 업로드가 끊기지 않게 `[미검증: 가려진 탭 실측 안 함]` | 설계 |
