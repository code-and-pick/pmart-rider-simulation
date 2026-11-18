// 관제판 — 지연·이상 골라내기(화면 알림만).
import { describe, expect, it } from 'vitest';
import type { DeliveryTimeline } from '../src/sim/timeline';
import type { DeliveryCard, RiderView } from '../src/sim/world';
import { buildBoard, rowMatches } from '../src/ui/ops';

const NOW = 10_000_000;
const card = (id: string, d: DeliveryCard['dispatchState'], x: DeliveryCard['executionState'], riderId: string | null = null): DeliveryCard => ({
  deliveryId: id,
  orderId: null,
  orderNumber: null,
  deliveryNumber: `${id}-1`,
  shipmentId: null,
  dispatchState: d,
  executionState: x,
  riderId,
  riderIds: riderId ? [riderId] : [],
  radiusKm: null,
  customer: null,
  purpose: null,
  pickup: null,
  createdAt: 0,
});
const tl = (id: string, steps: [string, number][], ended = false): DeliveryTimeline => ({
  deliveryId: id,
  orderId: null,
  purpose: null,
  basis: 'real',
  gaps: [],
  steps: steps.map(([key, agoSec]) => ({ key, label: key, atMs: NOW - agoSec * 1000, source: '배차' })),
  endMs: ended ? NOW : null,
});
const rider = (id: string, over: Partial<RiderView> = {}): RiderView => ({
  id,
  pos: null,
  heading: 0,
  phase: 'IDLE',
  note: '',
  deliveryId: null,
  target: null,
  path: null,
  pathKind: null,
  ...over,
});

describe('관제판', () => {
  it('라이더 못 찾음 5분 주의·10분 심각, 가게 대기 10분, 40분 지연 — 진행 중만', () => {
    const tls: Record<string, DeliveryTimeline> = {
      A: tl('A', [['created', 6 * 60]]),
      B: tl('B', [['created', 11 * 60]]),
      C: tl('C', [['created', 20 * 60], ['assigned', 19 * 60], ['x-ARRIVED_AT_STORE-1', 12 * 60]]),
      D: tl('D', [['created', 45 * 60], ['assigned', 44 * 60], ['x-PICKED_UP-1', 30 * 60]]),
      E: tl('E', [['created', 2 * 60]]),
    };
    const b = buildBoard({
      cards: [card('A', 'DISPATCHING', null), card('B', 'DISPATCHING', null), card('C', 'ASSIGNED', 'ARRIVED_AT_STORE', 'R1'), card('D', 'PICKED_UP', 'PICKED_UP', 'R2'), card('E', 'DISPATCHING', null), card('F', 'CLOSED', 'COMPLETED')],
      timelineOf: (id) => tls[id] ?? null,
      riders: [],
      calls: [],
      epochOf: (s) => s * 1000,
      nowMs: NOW,
    });
    const byId = Object.fromEntries(b.rows.map((r) => [r.card.deliveryId, r]));
    expect(byId.A!.alert).toMatchObject({ kind: 'SEARCH_LONG', level: 'warn' });
    expect(byId.B!.alert).toMatchObject({ kind: 'SEARCH_LONG', level: 'bad' });
    expect(byId.C!.alert).toMatchObject({ kind: 'STORE_WAIT' });
    expect(byId.D!.alert).toMatchObject({ kind: 'LATE' });
    expect(byId.E!.alert).toBeNull();
    expect(byId.F!.alert).toBeNull();
    expect(b.counts).toMatchObject({ searching: 3, delivering: 2, done: 1, active: 5, delayed: 4 });
    expect(b.alerts[0]).toMatchObject({ level: 'bad', deliveryId: 'B' }); // 심각 먼저
    expect(rowMatches(byId.A!, 'delayed')).toBe(true);
    expect(rowMatches(byId.E!, 'delayed')).toBe(false);
    expect(rowMatches(byId.F!, 'done')).toBe(true);
  });

  it('배차·전달 실패는 심각, 배송 중 라이더 위치 끊김·요청 실패 몰림은 주의', () => {
    const b = buildBoard({
      cards: [card('X', 'DISPATCH_FAILED', 'UNASSIGNED'), card('Y', 'PICKED_UP', 'FAILURE_REPORTED', 'R1')],
      timelineOf: () => null,
      riders: [rider('R1', { deliveryId: 'Y', locationOffline: true, label: '김*수 5c41' }), rider('R2', { locationOffline: true })],
      calls: [
        { at: 9_990, status: 503 },
        { at: 9_995, status: 'ERR' },
        { at: 9_998, status: 500 },
        { at: 9_999, status: 404 },
        { at: 1, status: 503 }, // 오래전
      ],
      epochOf: (s) => s * 1000,
      nowMs: NOW,
    });
    const kinds = b.alerts.map((a) => a.kind);
    expect(kinds).toEqual(expect.arrayContaining(['DISPATCH_FAILED', 'DELIVERY_FAILED', 'RIDER_STALE', 'CALL_FAILURES']));
    expect(b.alerts.filter((a) => a.kind === 'RIDER_STALE')).toHaveLength(1); // 쉬는 라이더는 숫자만
    expect(b.riders).toMatchObject({ total: 2, stale: 2, busy: 1 });
    expect(b.recentFailures).toBe(3);
    expect(b.alerts.slice(0, 2).every((a) => a.level === 'bad')).toBe(true);
  });
});
