import type { RiderPhase } from '../sim/rider';
import { displayStage } from '../domain/displayStage';
import type { DeliveryCard } from '../sim/world';

/** 라이더 엔진 단계별 고리 색 */
export const PHASE_COLOR: Record<RiderPhase, string> = {
  PREPARING: '#9aa4b5',
  IDLE: '#7c8aa5',
  DECIDING: '#f2b84b',
  TO_STORE: '#4c8dff',
  WAIT_ASSIGN_REFLECT: '#2dd4bf',
  AT_STORE_WAIT_READY: '#facc15',
  HANDOVER: '#facc15',
  WAIT_PICKUP_REFLECT: '#2dd4bf',
  TO_CUSTOMER: '#ff8a3d',
  AT_CUSTOMER: '#2fbf71',
  STOPPED: '#e5484d',
  TO_PICKUP: '#2dd4bf',
  AT_PICKUP: '#facc15',
  FAILING: '#e5484d',
  RETURNING: '#c47a3a',
  REMOTE: '#5b6b86',
};

/**
 * 고객 핀 색 — 화면용 단계(domain/displayStage, 두 상태를 합친 것) 기준.
 * 완료 초록 · 실패 빨강 · 실패 등록(확정 대기) 주황 · 진행 중은 단계별(찾는 중 회색, 배정·가게 파랑, 픽업·고객 주황).
 * (예전에는 배차 상태만 봐서 전달 실패로 끝난 배송도 배차 CLOSED 라 초록이었다)
 */
export function customerColor(c: DeliveryCard): string {
  const s = displayStage(c.dispatchState, c.executionState, c.radiusKm, c.purpose);
  if (s.tone === 'done') return '#2fbf71';
  if (s.tone === 'fail') return '#e5484d';
  if (s.tone === 'warn') return '#e09b1a';
  if (s.index === 0) return '#9aa4b5';
  return s.index <= 2 ? '#4c8dff' : '#ff8a3d';
}

export const ROUTE_COLOR = { TO_STORE: '#4c8dff', TO_CUSTOMER: '#ff8a3d' } as const;
