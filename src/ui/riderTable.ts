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
  /** 위치 공유 중(관제 응답 locationShared, tracking 0.12.0) — 모르면 null(배송·신규배차로 판단) */
  shared?: boolean | null;
  restriction: string | null;
  loc: LocState;
  /** 마지막 수신 뒤 초 — 모르면 null */
  sinceSec: number | null;
  /** 운행 시작·대기 시작(관제 응답 — 모르면 null) */
  onDutySince: string | null;
  waitingSince: string | null;
  /** 지금 위치(지도·목록 좌표) — 모르면 null */
  pos: { lat: number; lng: number } | null;
  /** 진행 중 배송(관제 단계·도착 예정). stageKey = 관제 단계 값(TO_STORE·AT_STORE·TO_CUSTOMER·AT_CUSTOMER — 단계 칩) */
  deliveries: { deliveryId: string; stage: string; stageKey: string | null; etaPickup: string | null; etaDrop: string | null }[];
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

/** 화면 라이더 단계 → 관제 단계 값(단계 칩) */
const PHASE_STAGE: Partial<Record<string, string>> = {
  TO_STORE: 'TO_STORE',
  AT_STORE_WAIT_READY: 'AT_STORE',
  AT_STORE: 'AT_STORE',
  WAIT_ASSIGN_REFLECT: 'TO_STORE',
  HANDOVER: 'AT_STORE',
  WAIT_PICKUP_REFLECT: 'AT_STORE',
  TO_PICKUP: 'TO_STORE',
  TO_CUSTOMER: 'TO_CUSTOMER',
  AT_CUSTOMER: 'AT_CUSTOMER',
};

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
    shared: c.locationShared ?? null,
    restriction: c.restriction && c.restriction !== 'NORMAL' ? c.restriction : null,
    loc: !c.location ? 'none' : c.stale ? 'stale' : 'ok',
    sinceSec: c.staleSinceSeconds ?? null,
    onDutySince: c.onDutySince ?? null,
    waitingSince: c.waitingSince ?? null,
    pos: c.location?.lat !== undefined && c.location?.lng !== undefined ? { lat: c.location.lat, lng: c.location.lng } : null,
    deliveries: (c.activeDeliveries ?? []).map((d) => ({
      deliveryId: d.deliveryId,
      stage: STAGE[d.stage ?? ''] ?? (d.pickedUp ? '픽업 뒤' : '진행 중'),
      stageKey: d.stage ?? (d.pickedUp ? 'TO_CUSTOMER' : 'TO_STORE'),
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
    vehicle: r.vehicle ?? (r.external ? null : 'MOTORCYCLE'),
    dispatchOn: r.dispatchOn ?? null,
    shared: r.locationShared ?? null,
    restriction: null,
    // 끊김 판단은 라이더 쪽 locationOffline 하나만(숫자 카드·머리·알림과 같은 값 — 2026-11-19 사용자 "상세에는 복구된 라이더도 계속 위치 끊김").
    // 실서버 조회 라이더는 그 값이 '마지막 위치 3분 넘음'(tracking 끊김 기준), MOCK 은 위치 끊김 장면 중
    loc: !r.pos ? 'none' : r.locationOffline ? 'stale' : 'ok',
    sinceSec: r.locationAgeSec ?? null,
    onDutySince: null,
    waitingSince: null,
    pos: r.pos ? { lat: r.pos.lat, lng: r.pos.lng } : null,
    deliveries: r.deliveryId ? [{ deliveryId: r.deliveryId, stage: PHASE_LABEL[r.phase], stageKey: PHASE_STAGE[r.phase] ?? null, etaPickup: null, etaDrop: null }] : [],
  }));
}

/**
 * 라이더 ID → 표 줄(이름·위치 상태·도착 예정) — 실서버 이 PC 는 관제 응답, 그 밖은 화면 라이더.
 * 관제 응답에 없는 라이더(운행을 끈 시뮬레이터 라이더 등)는 화면 라이더로 채운다.
 */
export function riderIndex(control: readonly ControlRider[] | null, riders: readonly RiderView[], isSim: (id: string) => boolean): Map<string, RiderRow> {
  const m = new Map<string, RiderRow>();
  for (const r of rowsFromRiders(riders, isSim)) m.set(r.id, r);
  if (control) for (const r of rowsFromControl(control, isSim)) m.set(r.id, r);
  return m;
}

/** waiting = 대기(맡은 배송 없음 · 위치 끊김 아님 — 백오피스 라이더 관제 숫자 카드와 같은 기준) */
/**
 * 위치 상태 — 배송 없고 신규배차를 켠 게 아니면(꺼 둠·모름) 위치가 안 들어와도 "쉬는 중"(rest — 문제 아님, 회색).
 * "끊김"(stale·none)은 배송 중이거나 신규배차를 켠 라이더만(사용자 2026-11-19 "신규배차 끈 사람은 위치끊겨도 되지 않아? … 구분해야").
 */
export type LocStatus = 'ok' | 'stale' | 'none' | 'rest';

export function locStatus(r: RiderRow): LocStatus {
  // 서버가 정한 값(tracking 0.12.0 locationShared, 백엔드 4c8748fd)이 있으면 그대로.
  // 없으면(옛 서버·MOCK) 같은 규칙으로 판단 — 위치 공유 = 맡은 배송이 있음 또는 신규배차 켬
  if (r.shared === false) return 'rest';
  if (r.shared === true) return r.loc;
  if (r.deliveries.length === 0 && r.dispatchOn !== true) return 'rest';
  return r.loc;
}

/** 화면 라이더가 쉬는 중인가(맡은 배송 없음 · 신규배차 켠 게 아님) — 지도에 그리지 않는다 */
export function isResting(r: { deliveryId: string | null; dispatchOn?: boolean | null; locationShared?: boolean | null }): boolean {
  if (typeof r.locationShared === 'boolean') return !r.locationShared;
  return !r.deliveryId && r.dispatchOn !== true;
}

/** 화면 라이더(RiderView) 기준 같은 판단 — 지도 색·머리 숫자 */
export function isAlarmOffline(r: { locationOffline?: boolean; deliveryId: string | null; dispatchOn?: boolean | null; locationShared?: boolean | null }): boolean {
  return !!r.locationOffline && !isResting(r);
}

export type RiderTableFilter = 'all' | 'delivering' | 'waiting' | 'stale' | 'sim' | 'app';

export function rowMatchesRider(r: RiderRow, f: RiderTableFilter): boolean {
  if (f === 'delivering') return r.deliveries.length > 0;
  if (f === 'waiting') return r.deliveries.length === 0 && locStatus(r) === 'ok';
  if (f === 'stale') return locStatus(r) === 'stale' || locStatus(r) === 'none';
  if (f === 'sim') return r.sim;
  if (f === 'app') return r.external;
  return true;
}
