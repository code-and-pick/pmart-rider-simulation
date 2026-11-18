// 라이더 관제 표 줄 — 라이더 백오피스 "라이더 관제" 표와 같은 칸(라이더·수단·신규 배차·위치·마지막 수신·진행 중 배송).
// 실서버 이 PC = 관제 응답(ControlRider) 그대로, 그 밖(MOCK·다른 기기) = 화면 라이더(RiderView)로 채운다(모르는 칸은 null). React 에 의존하지 않는다(시험).

import type { ControlRider } from '../domain/contract';
import { shortRiderId } from '../domain/riderId';
import { PHASE_LABEL } from '../sim/rider';
import type { RiderView } from '../sim/world';

export type LocState = 'ok' | 'stale' | 'none';

export interface RiderRow {
  id: string;
  /** "김*수 · 482913" — 이름·번호가 없으면 짧은 번호 */
  name: string;
  external: boolean;
  sim: boolean;
  vehicle: string | null;
  /** 신규 배차 받음 — 모르면 null */
  dispatchOn: boolean | null;
  restriction: string | null;
  loc: LocState;
  /** 마지막 수신 뒤 초 — 모르면 null */
  sinceSec: number | null;
  /** 진행 중 배송(관제 단계·도착 예정) */
  deliveries: { deliveryId: string; stage: string; etaPickup: string | null; etaDrop: string | null }[];
}

const STAGE: Record<string, string> = {
  UNASSIGNED: '배정 전',
  TO_STORE: 'MFC로 가는 중',
  AT_STORE: 'MFC 도착',
  TO_CUSTOMER: '고객에게 가는 중',
  AT_CUSTOMER: '고객 도착',
  DONE: '끝남',
};

const VEHICLE: Record<string, string> = { MOTORCYCLE: '오토바이', BICYCLE: '자전거', E_BIKE: '전기자전거', KICKBOARD: '킥보드', CAR: '자동차', WALK: '도보' };

export function vehicleName(v: string | null): string {
  return v ? (VEHICLE[v] ?? v) : '—';
}

export function rowsFromControl(items: readonly ControlRider[], isSim: (id: string) => boolean): RiderRow[] {
  return items.map((c) => ({
    id: c.riderId,
    name: [c.nameMasked, c.riderNumber ?? shortRiderId(c.riderId)].filter(Boolean).join(' · '),
    external: !isSim(c.riderId),
    sim: isSim(c.riderId),
    vehicle: c.vehicleType ?? null,
    dispatchOn: c.newDispatchEnabled ?? null,
    restriction: c.restriction && c.restriction !== 'NORMAL' ? c.restriction : null,
    loc: !c.location ? 'none' : c.stale ? 'stale' : 'ok',
    sinceSec: c.staleSinceSeconds ?? null,
    deliveries: (c.activeDeliveries ?? []).map((d) => ({
      deliveryId: d.deliveryId,
      stage: STAGE[d.stage ?? ''] ?? (d.pickedUp ? '픽업 뒤' : '진행 중'),
      etaPickup: d.etaPickup ?? null,
      etaDrop: d.etaDrop ?? null,
    })),
  }));
}

/** 관제 응답이 없을 때 — 화면 라이더로(MOCK 가상 라이더·실서버 시뮬레이터 라이더) */
export function rowsFromRiders(riders: readonly RiderView[], isSim: (id: string) => boolean): RiderRow[] {
  return riders.map((r) => ({
    id: r.id,
    name: r.label ?? shortRiderId(r.id),
    external: !!r.external,
    sim: isSim(r.id),
    vehicle: r.external ? null : 'MOTORCYCLE',
    dispatchOn: null,
    restriction: null,
    // 서버 끊김 기준(3분 — tracking stale-after)과 같게 [확정: delivery-tracking 0.8.0 설명]
    loc: !r.pos ? 'none' : r.locationOffline || (r.locationAgeSec ?? 0) > 180 ? 'stale' : 'ok',
    sinceSec: r.locationAgeSec ?? null,
    deliveries: r.deliveryId ? [{ deliveryId: r.deliveryId, stage: PHASE_LABEL[r.phase], etaPickup: null, etaDrop: null }] : [],
  }));
}

export type RiderTableFilter = 'all' | 'delivering' | 'stale' | 'sim' | 'app';

export function rowMatchesRider(r: RiderRow, f: RiderTableFilter): boolean {
  if (f === 'delivering') return r.deliveries.length > 0;
  if (f === 'stale') return r.loc !== 'ok';
  if (f === 'sim') return r.sim;
  if (f === 'app') return r.external;
  return true;
}
