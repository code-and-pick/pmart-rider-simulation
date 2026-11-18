// 배송 목록 묶기·정렬 — 라이더·배송이 많을 때(100명 …) 찾기만으로는 못 찾으니 "지금 봐야 할 것"이 먼저 보이게(사용자 2026-11-18).
// Onfleet·LogiNext 처럼 상태(단계)별, 바로고처럼 담당(라이더)별로 묶는다. React 에 의존하지 않는다(시험).

import { displayStage } from '../domain/displayStage';
import { BUCKET_LABEL } from './buckets';
import type { OpsRow } from './ops';

export type GroupBy = 'none' | 'stage' | 'rider';
export type SortBy = 'urgent' | 'longest' | 'recent';

export interface RowGroup {
  key: string;
  label: string;
  rows: OpsRow[];
  /** 지연·이상 건수(심각+주의) */
  alerts: number;
  /** 라이더 묶음이면 그 라이더 ID */
  riderId?: string;
}

const ACTIVE = new Set(['searching', 'delivering']);

function level(r: OpsRow): number {
  return r.alert?.level === 'bad' ? 0 : r.alert ? 1 : 2;
}

/** 급한 순 = 심각 → 주의 → 진행 중(오래된 것 먼저) → 끝난 것(최근 것 먼저) / 오래 걸린 순 / 최근 순(배차 요청이 늦은 것 먼저) */
export function sortRows(rows: readonly OpsRow[], by: SortBy): OpsRow[] {
  const out = [...rows];
  if (by === 'recent') return out.sort((a, b) => b.card.createdAt - a.card.createdAt);
  if (by === 'longest') return out.sort((a, b) => (b.totalSec ?? -1) - (a.totalSec ?? -1));
  return out.sort((a, b) => {
    const d = level(a) - level(b);
    if (d) return d;
    const aa = ACTIVE.has(a.bucket);
    const ba = ACTIVE.has(b.bucket);
    if (aa !== ba) return aa ? -1 : 1;
    if (aa) return (a.startMs ?? 0) - (b.startMs ?? 0);
    return b.card.createdAt - a.card.createdAt;
  });
}

/** 지금 단계 이름·순서 — 진행 중은 단계 막대의 지금 칸(배차 요청 → 배정 → 가게 도착 → 픽업 → 고객 도착), 끝난 것은 결과 */
function stageOf(r: OpsRow): { key: string; label: string; order: number } {
  if (ACTIVE.has(r.bucket)) {
    const s = displayStage(r.card.dispatchState, r.card.executionState, r.card.radiusKm, r.card.purpose);
    const label = s.index === 0 ? '라이더 찾는 중' : (s.labels[s.index] ?? s.text);
    return { key: `s${s.index}:${label}`, label, order: s.index };
  }
  const label = r.bucket === 'closed' ? '끝남(취소 등)' : BUCKET_LABEL[r.bucket];
  return { key: `b:${r.bucket}`, label, order: 100 + ['deliveryFailed', 'dispatchFailed', 'done', 'closed'].indexOf(r.bucket) };
}

/**
 * 묶기 — 묶음 안 순서는 이미 정렬된 순서 그대로.
 *   단계별: 단계 순서(찾는 중 → … → 고객 도착 → 끝난 것).
 *   라이더별: 지연 있는 라이더 먼저 → 건수 많은 순 → 이름. 라이더 없는 배송(찾는 중)은 맨 앞 한 묶음.
 */
export function groupRows(rows: readonly OpsRow[], by: GroupBy, riderName: (id: string) => string): RowGroup[] {
  if (by === 'none') return [{ key: 'all', label: '', rows: [...rows], alerts: rows.filter((r) => r.alert).length }];
  const m = new Map<string, RowGroup & { order: number }>();
  for (const r of rows) {
    let key: string;
    let label: string;
    let order: number;
    let riderId: string | undefined;
    if (by === 'stage') {
      ({ key, label, order } = stageOf(r));
    } else if (r.card.riderId) {
      riderId = r.card.riderId;
      key = `r:${riderId}`;
      label = riderName(riderId);
      order = 1;
    } else {
      key = 'r:none';
      label = '라이더 없음(찾는 중)';
      order = 0;
    }
    const g = m.get(key) ?? { key, label, rows: [], alerts: 0, order, riderId };
    g.rows.push(r);
    if (r.alert) g.alerts++;
    m.set(key, g);
  }
  const groups = [...m.values()];
  if (by === 'stage') groups.sort((a, b) => a.order - b.order);
  else groups.sort((a, b) => a.order - b.order || b.alerts - a.alerts || b.rows.length - a.rows.length || a.label.localeCompare(b.label, 'ko'));
  return groups.map(({ order: _o, ...g }) => g);
}
