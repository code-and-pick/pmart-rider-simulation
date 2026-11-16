import type { RiderPhase } from '../sim/rider';
import type { DeliveryCard } from '../sim/world';

/** 라이더 엔진 단계별 고리 색 */
export const PHASE_COLOR: Record<RiderPhase, string> = {
  PREPARING: '#9aa4b5',
  IDLE: '#7c8aa5',
  DECIDING: '#f2b84b',
  TO_STORE: '#4c8dff',
  WAIT_ASSIGN_REFLECT: '#8f7cff',
  AT_STORE_WAIT_READY: '#b07cff',
  HANDOVER: '#d35cff',
  WAIT_PICKUP_REFLECT: '#8f7cff',
  TO_CUSTOMER: '#ff8a3d',
  AT_CUSTOMER: '#2fbf71',
  STOPPED: '#e5484d',
  REMOTE: '#5b6b86',
};

/** 고객 핀 색 — 배차 상태 기준(출처 dispatch) */
export function customerColor(c: DeliveryCard): string {
  switch (c.dispatchState) {
    case 'CREATED':
    case 'DISPATCHING':
      return '#9aa4b5';
    case 'ASSIGNED':
      return '#4c8dff';
    case 'PICKED_UP':
      return '#ff8a3d';
    case 'CLOSED':
      return '#2fbf71';
    default:
      return '#e5484d';
  }
}

export const ROUTE_COLOR = { TO_STORE: '#4c8dff', TO_CUSTOMER: '#ff8a3d' } as const;
