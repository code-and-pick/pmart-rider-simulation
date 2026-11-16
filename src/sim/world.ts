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
  /** 이 배송에 관여한 라이더(제안을 받았거나 배정된) — 라이더별 거르기 */
  riderIds: string[];
  radiusKm: number | null;
  /** null = 고객 위치를 모름(실서버 관찰 계정은 전달지를 읽지 않는다 — 개인정보) */
  customer: LatLng | null;
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

export interface MetricsSummary {
  /** 전달 완료(지금까지) */
  completed: number;
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
