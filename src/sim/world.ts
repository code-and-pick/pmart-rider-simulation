// 화면이 보는 세계 — MOCK(Simulation)과 실서버 읽기(RealWorld)가 같은 모양을 따른다. React 에 의존하지 않는다.

import type { ApiCallRecord, DomainEventRecord } from '../backend/port';
import type { SimParams } from '../config';
import type { DispatchState, ExecutionState } from '../domain/contract';
import type { LatLng } from '../util/geo';
import type { SimClock } from './clock';
import type { RiderPhase } from './rider';

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
}

/** 화면 배송 카드 — 두 서비스의 두 상태를 출처와 함께(docs/design.md §4). */
export interface DeliveryCard {
  deliveryId: string;
  orderId: string | null;
  /** dispatch Delivery.shipmentId — 실서버에서 채워지는지 실측(§5) */
  shipmentId: string | null;
  /** null = 아직 dispatch 를 못 읽음(실서버) */
  dispatchState: DispatchState | null;
  /** null = execution 사본이 아직 없음(DeliveryCreated 반영 전) */
  executionState: ExecutionState | null;
  riderId: string | null;
  radiusKm: number | null;
  /** null = 고객 위치를 모름(실서버 관찰 계정은 전달지를 읽지 않는다 — 개인정보) */
  customer: LatLng | null;
  createdAt: number;
}

export interface MetricsSummary {
  completed: number;
  inProgress: number;
  dispatchFailed: number;
  /** 평균 초 — 표본이 없으면 null */
  offerToAccept: number | null;
  acceptToStore: number | null;
  storeWait: number | null;
  pickupToComplete: number | null;
  apiErrors: number;
}

export interface World {
  readonly mode: 'mock' | 'http';
  readonly clock: SimClock;
  readonly params: SimParams;
  readonly riders: readonly RiderView[];
  readonly apiLog: readonly ApiCallRecord[];
  readonly eventLog: readonly DomainEventRecord[];
  speed: number;
  paused: boolean;
  /** 배속을 바꿀 수 있나(실서버는 늘 1×) */
  readonly canChangeSpeed: boolean;
  advance(dtReal: number): Promise<void>;
  deliveryCards(): DeliveryCard[];
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
}
