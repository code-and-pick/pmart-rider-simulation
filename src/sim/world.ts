// 화면이 보는 세계 — MOCK(Simulation)과 실서버 읽기(RealWorld)가 같은 모양을 따른다. React 에 의존하지 않는다.

import type { ApiCallRecord, DomainEventRecord } from '../backend/port';
import type { SimParams } from '../config';
import type { ControlRider, DeliveryPurpose, DispatchState, ExecutionState } from '../domain/contract';
import type { LatLng } from '../util/geo';
import type { SimClock } from './clock';
import type { RiderJob, RiderPhase } from './rider';
import type { OrderLookup } from './orderLookup';
import type { DeliveryTimeline } from './timeline';

export interface RiderView {
  readonly id: string;
  /** null = 지도에 그릴 위치 없음(실서버에서 아직 위치를 안 올린 라이더) */
  readonly pos: LatLng | null;
  readonly heading: number;
  readonly phase: RiderPhase;
  readonly note: string;
  readonly deliveryId: string | null;
  readonly target: LatLng | null;
  /** 지금 따라가는 경로 — 화면 경로선 */
  readonly path: LatLng[] | null;
  /** ROAD = 도로 경로(실선), STRAIGHT = 직선(점선, 도로 경로 아님) */
  readonly pathKind: 'ROAD' | 'STRAIGHT' | null;
  /** 위치 끊김 장면 중(MOCK) — 지도 표시가 실제 위치보다 늦다는 뜻은 아니고, 백엔드가 이 라이더 위치를 못 받는 중 */
  readonly locationOffline?: boolean;
  /** 서버가 받은 마지막 위치가 몇 초 전인가(실서버 조회 라이더만 — 모르면 없음) */
  readonly locationAgeSec?: number | null;
  /** 진행 중 주문 요약(주문번호·품목 수·금액·예상 소요) — 없으면 표시 안 함 */
  readonly job?: RiderJob | null;
  /** 화면에 보이는 짧은 이름(라이더 앱 라이더: 마스킹 이름 + 번호 앞 4자리). 없으면 id — 전체 번호는 마우스 설명에 */
  readonly label?: string;
  /** 시뮬레이터 밖 라이더(라이더 앱 — 관제로 읽음) */
  readonly external?: boolean;
}

/** 화면 배송 카드 — 두 서비스의 두 상태를 출처와 함께(docs/design.md §4). */
export interface DeliveryCard {
  deliveryId: string;
  orderId: string | null;
  /** 화면용 주문번호(8자리 — 고객·라이더·MFC·상담원이 같은 번호). 모르면 null */
  orderNumber: string | null;
  /** 화면 배송 번호(주문번호-순번, ADR-0070). 모르면 null */
  deliveryNumber: string | null;
  /** dispatch Delivery.shipmentId — 실서버에서 채워지는지 실측(§5) */
  shipmentId: string | null;
  /** null = 아직 dispatch 를 못 읽음(실서버) */
  dispatchState: DispatchState | null;
  /** null = execution 사본이 아직 없음(DeliveryCreated 반영 전) */
  executionState: ExecutionState | null;
  riderId: string | null;
  /** 이 배송에 관여한 라이더(제안을 받았거나 배정된) — 라이더별 거르기 */
  riderIds: string[];
  radiusKm: number | null;
  /** null = 고객 위치를 모름(실서버 관찰 계정은 전달지를 읽지 않는다 — 개인정보). 회수는 MFC */
  customer: LatLng | null;
  /** 배송 목적 — null 이면 모름(일반으로 본다) */
  purpose: DeliveryPurpose | null;
  /** 회수·다시 배송의 잘못 둔 곳(MOCK 만 — 실서버는 배정 라이더에게만 보임) */
  pickup: LatLng | null;
  createdAt: number;
}

/** 완료된 배송의 구간 하나 — 평균 초와, 어디서 어디까지 쟀는지 */
export interface PhaseSegment {
  key: 'findRider' | 'toStore' | 'atStore' | 'storeAll' | 'toCustomer';
  label: string;
  sec: number;
  /** 정확히 무엇부터 무엇까지(마우스 설명) */
  hint: string;
}

/** MOCK 시나리오 조절 바 — 실패를 보려고 바꾸는 값(모두 [시뮬]) */
export interface ScenarioKnobs {
  /** 시간당 주문 수 */
  ordersPerHour: number;
  /** 라이더 수락 확률(0~1) — 나머지는 거절·무응답 */
  acceptProbability: number;
  /** 포장 시간 배율 */
  packTimeScale: number;
  /** 고객 부재 확률(0~1) → 전달 실패 */
  customerAbsentRate: number;
  /** 쓰기 응답이 사라질 확률(0~1) → 같은 키 재전송 */
  networkDropRate: number;
  /** 라이더가 픽업 전 배정을 취소할 확률(0~1) → 재배차 */
  riderCancelRate: number;
  /** 고객에게 가는 중 위치 전송이 4분 끊길 확률(0~1) → RiderLocationStale */
  locationOutageRate: number;
  /** 전달 완료가 나중에 오배송으로 확인될 확률(0~1) → 회수·재발송·다시 배송 */
  misdeliveryRate: number;
}

/** 지금까지 일어난 사건 수(MOCK — 실서버는 사건을 구독하지 못해 없음) */
export interface IncidentCounts {
  /** 배정 취소 → 재배차(DeliveryAssignmentChanged) */
  assignmentCancelled: number;
  /** 위치 끊김(RiderLocationStale) */
  locationStale: number;
  /** 도움요청(DeliveryIncidentRaised) */
  helpRequests: number;
}

/** 고른 배송 전달지 화면 값 */
export type DropLocationView =
  | { state: 'loading' }
  | { state: 'ok'; address: string; postalCode: string | null; pos: LatLng | null; source: string; logId: string | null; kind: string }
  | { state: 'none'; reason: string };


export interface MetricsSummary {
  /** 전달 완료(지금까지) */
  completed: number;
  /** 전달 실패(등록·확정 — 지금까지) */
  deliveryFailed: number;
  /** 응답이 끊긴 요청 수(재전송으로 이어짐) */
  responseLost: number;
  /** 사건 수 — MOCK 만 */
  incidents?: IncidentCounts;
  /** 배정돼 배송 중(가게로·가게에서·고객에게) */
  delivering: number;
  /** 배차 요청 뒤 라이더를 찾는 중 */
  searching: number;
  /** 라이더를 못 찾아 배차 실패 */
  dispatchFailed: number;
  /** 완료된 배송 n 건의 구간별 평균(모든 구간이 같은 n 건). 완료가 없으면 null */
  phases: { n: number; totalSec: number; segments: PhaseSegment[] } | null;
  /** 시간 기준 — sim = 시뮬레이션 시각(배속 반영), real = 실제 시각 */
  timeBasis: 'sim' | 'real';
  apiErrors: number;
}

/** 가상 라이더 엔진의 진행 기록(제안 검토·수락·이동·인계 …) — 백엔드 상태가 아니다 */
export interface NoteRecord {
  at: number;
  riderId: string;
  text: string;
}

export interface World {
  readonly mode: 'mock' | 'http';
  readonly clock: SimClock;
  readonly params: SimParams;
  readonly riders: readonly RiderView[];
  /** 실서버 라이더 관제(GET /rider-locations) 마지막 응답 — 이 PC 에서 관제 계정이 있을 때만, 그 밖(MOCK·다른 기기)은 null */
  controlBoard?(): { items: ControlRider[]; asOf: string } | null;
  /**
   * 고른 배송의 전달지(주소·좌표) — 실서버는 직원용 drop-location(이 PC·관제 계정, 부를 때마다 백엔드 열람 기록), MOCK 은 가상 위치.
   * 처음 부르면 읽기 시작(loading). 화면 메모리에만 두고 로그·저장소에 남기지 않는다. 사용자 2026-11-18 "주소까지 보이게".
   */
  dropLocation?(deliveryId: string): DropLocationView;
  /**
   * 주문 창 "주문" 탭 — 직원용 주문 상세·원문 열람(사용자 2026-11-19 "여기서 다 열람할 수 있게 해").
   * 실서버 = order-service(이 PC·관제 계정, 열람은 사유 필수·audit 기록), MOCK = 가상 값. 화면 메모리에만.
   */
  readonly orders?: OrderLookup;
  readonly apiLog: readonly ApiCallRecord[];
  readonly eventLog: readonly DomainEventRecord[];
  readonly notes: readonly NoteRecord[];
  /** 지도·라이더가 쓰는 MFC 위치 — 실서버는 center-master 에서 읽은 값(인계 위치가 있으면 그것) */
  readonly mfcLocation: LatLng;
  speed: number;
  paused: boolean;
  /** 배속을 바꿀 수 있나(실서버는 늘 1×) */
  readonly canChangeSpeed: boolean;
  advance(dtReal: number): Promise<void>;
  deliveryCards(): DeliveryCard[];
  /** 배송 한 건의 흐름·시간(카드를 누르면 펼침) — 없는 배송이면 null */
  deliveryTimeline(deliveryId: string): DeliveryTimeline | null;
  metrics(): MetricsSummary;
  /** 화면 위쪽 안내 줄(연결 상태·실측 결과 등) */
  diagnostics(): string[];
  addRider(): void;
  /** 실서버 가상 라이더 운행 — null 이면 해당 없음(MOCK), 문자열이면 잠긴 이유 */
  readonly operationLock: string | null;
  /** 실서버 가상 라이더 운행 시작(잠겨 있으면 아무것도 안 함) */
  startOperation(): void;
  /** 실서버 가상 라이더가 움직이는 중인가 */
  readonly operating: boolean;
  /** 운행 종료 — 진행 중 배송은 끝낸 뒤 OFF_DUTY */
  stopOperation(): void;
  /** 시나리오 조절 바를 쓸 수 있나(MOCK 만 — 실서버는 실제 결과만) */
  readonly tunable: boolean;
  getKnobs(): ScenarioKnobs;
  setKnobs(k: Partial<ScenarioKnobs>): void;
}
