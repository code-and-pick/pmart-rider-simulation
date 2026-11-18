// 배송 목록 묶기·정렬 — 라이더가 많아도 봐야 할 것이 먼저.
import { describe, expect, it } from 'vitest';
import type { DeliveryCard } from '../src/sim/world';
import type { OpsRow } from '../src/ui/ops';
import { groupRows, sortRows } from '../src/ui/listView';

const row = (id: string, o: { d: DeliveryCard['dispatchState']; x: DeliveryCard['executionState']; rider?: string; start: number; total: number | null; alert?: 'bad' | 'warn'; created?: number }): OpsRow => ({
  card: {
    deliveryId: id,
    orderId: null,
    orderNumber: null,
    deliveryNumber: null,
    shipmentId: null,
    dispatchState: o.d,
    executionState: o.x,
    riderId: o.rider ?? null,
    riderIds: o.rider ? [o.rider] : [],
    radiusKm: null,
    customer: null,
    purpose: null,
    pickup: null,
    createdAt: o.created ?? o.start,
  },
  bucket: o.x === 'COMPLETED' ? 'done' : o.d === 'DISPATCHING' ? 'searching' : 'delivering',
  startMs: o.start,
  stepLabel: null,
  stepAtMs: null,
  totalSec: o.total,
  alert: o.alert ? { level: o.alert, key: id, kind: 'LATE', title: 't', detail: 'd', sec: 0 } : null,
});

const rows = [
  row('A', { d: 'PICKED_UP', x: 'PICKED_UP', rider: 'R1', start: 300, total: 100 }),
  row('B', { d: 'DISPATCHING', x: null, start: 100, total: 400, alert: 'warn' }),
  row('C', { d: 'CLOSED', x: 'COMPLETED', rider: 'R2', start: 50, total: 600 }),
  row('D', { d: 'ASSIGNED', x: 'ARRIVED_AT_STORE', rider: 'R1', start: 200, total: 200, alert: 'bad' }),
  row('E', { d: 'ASSIGNED', x: 'ASSIGNED', rider: 'R2', start: 250, total: 150 }),
];

describe('배송 목록 묶기·정렬', () => {
  it('급한 순 = 심각 → 주의 → 진행 중 오래된 것 → 끝난 것', () => {
    expect(sortRows(rows, 'urgent').map((r) => r.card.deliveryId)).toEqual(['D', 'B', 'E', 'A', 'C']);
    expect(sortRows(rows, 'longest').map((r) => r.card.deliveryId)).toEqual(['C', 'B', 'D', 'E', 'A']);
    expect(sortRows(rows, 'recent')[0]!.card.deliveryId).toBe('A');
  });

  it('단계별 = 찾는 중 → 배정 → 가게 도착 → 픽업 → … → 끝난 것', () => {
    const g = groupRows(sortRows(rows, 'urgent'), 'stage', (id) => id);
    expect(g.map((x) => x.label)).toEqual(['라이더 찾는 중', '배정', '가게 도착', '픽업', '전달 완료']);
    expect(g.find((x) => x.label === '가게 도착')?.alerts).toBe(1);
  });

  it('라이더별 = 라이더 없음 먼저 → 지연 있는 라이더 → 건수 많은 순, 묶음 안은 정렬 그대로', () => {
    const g = groupRows(sortRows(rows, 'urgent'), 'rider', (id) => `이름 ${id}`);
    expect(g.map((x) => x.label)).toEqual(['라이더 없음(찾는 중)', '이름 R1', '이름 R2']);
    expect(g[1]!.rows.map((r) => r.card.deliveryId)).toEqual(['D', 'A']);
    expect(g[1]).toMatchObject({ riderId: 'R1', alerts: 1 });
  });
});
