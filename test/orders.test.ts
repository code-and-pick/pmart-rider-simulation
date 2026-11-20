// 주문 탭 — 배송을 주문번호로 묶고 구간 막대를 만든다.
import { describe, expect, it } from 'vitest';
import type { DeliveryTimeline } from '../src/sim/timeline';
import type { DeliveryCard } from '../src/sim/world';
import { groupOrders, segmentsOf } from '../src/ui/orders';

const card = (deliveryId: string, orderId: string | null, createdAt: number): DeliveryCard => ({
  deliveryId,
  orderId,
  orderNumber: null,
  deliveryNumber: null,
  shipmentId: null,
  dispatchState: null,
  executionState: null,
  riderId: null,
  riderIds: [],
  radiusKm: null,
  customer: null,
  purpose: null,
  pickup: null,
  createdAt,
});
const S = 1_000_000;
const tl = (id: string, keys: [string, number, boolean?][], ended: boolean): DeliveryTimeline => ({
  deliveryId: id,
  orderId: null,
  purpose: null,
  basis: 'sim',
  gaps: [],
  steps: keys.map(([key, sec, bad]) => ({ key, label: key, atMs: S + sec * 1000, source: '배차', bad })),
  endMs: ended ? S + (keys.at(-1)?.[1] ?? 0) * 1000 : null,
});

describe('주문 탭', () => {
  it('구간 — 생성→배정 라이더 찾기, →가게 도착 MFC 로, →픽업 가게에서, →완료 고객에게', () => {
    const t = tl('D1', [['created', 0], ['firstOffer', 0], ['assigned', 10], ['x-ARRIVED_AT_STORE-1', 60], ['x-PICKED_UP-2', 200], ['x-COMPLETED-3', 500]], true);
    expect(segmentsOf(t.steps, t.endMs, 0).map((s) => [s.kind, s.sec])).toEqual([
      ['findRider', 0],
      ['findRider', 10],
      ['toStore', 50],
      ['atStore', 140],
      ['toCustomer', 300],
    ]);
  });

  it('가게 도착을 모르면(실서버 목록) 배정→픽업은 한 구간, 진행 중이면 지금까지 구간', () => {
    const t = tl('D1', [['created', 0], ['assigned', 10], ['x-PICKED_UP', 300]], false);
    const segs = segmentsOf(t.steps, null, S + 400_000);
    expect(segs.map((s) => s.kind)).toEqual(['findRider', 'storeAll', 'now']);
    expect(segs.at(-1)?.sec).toBe(100);
  });

  it('같은 주문의 배송은 한 줄 — 하나라도 진행 중이면 끝나지 않음, 주문번호 없으면 배송 하나가 한 줄, 최근 먼저', () => {
    const tls: Record<string, DeliveryTimeline> = {
      D1: tl('D1', [['created', 0], ['x-COMPLETED', 100]], true),
      D2: tl('D2', [['created', 200], ['assigned', 210]], false),
      D3: tl('D3', [['created', 50], ['dispatchFailed', 90, true]], true),
    };
    const rows = groupOrders([card('D1', 'O-1', 0), card('D2', 'O-1', 200), card('D3', null, 50)], (id) => tls[id] ?? null, S + 300_000);
    expect(rows.map((r) => r.orderId)).toEqual(['O-1', null]);
    expect(rows[0]).toMatchObject({ deliveryIds: ['D1', 'D2'], startMs: S, endMs: null, lastLabel: 'assigned' });
    expect(rows[1]).toMatchObject({ deliveryIds: ['D3'], endMs: S + 90_000, bad: true });
  });
});

describe('걸린 시간 글자', () => {
  it('분·시간·일', async () => {
    const { dur } = await import('../src/ui/format');
    expect(dur(45)).toBe('45초');
    expect(dur(200)).toBe('3분 20초');
    expect(dur(2 * 3600 + 5 * 60 + 9)).toBe('2시간 5분');
    expect(dur(3909 * 60 + 11)).toBe('2일 17시간 9분');
    expect(dur(null)).toBe('—');
  });
});

describe('한 주문에 배송 둘', () => {
  it('앞 배송 끝 → 다음 배송 생성은 "다음 배송까지" 구간', () => {
    const tls: Record<string, DeliveryTimeline> = {
      D1: tl('D1', [['created', 0], ['cancelled', 30, true]], true),
      D2: tl('D2', [['created', 1000], ['assigned', 1010]], false),
    };
    const [row] = groupOrders([card('D1', 'O-1', 0), card('D2', 'O-1', 1000)], (id) => tls[id] ?? null, S + 1_020_000);
    expect(row!.segments.map((s) => [s.kind, s.sec])).toEqual([
      ['bad', 30],
      ['between', 970],
      ['findRider', 10],
      ['now', 10],
    ]);
  });
});

describe('화면용 번호', () => {
  it('짧은 시스템 번호·주문/배송 표시 번호', async () => {
    const { shortId, orderLabel, deliveryLabel } = await import('../src/domain/riderId');
    expect(shortId('DLV-8704f124-3020-4e1c-8781-dedd07dffef1')).toBe('DLV-8704');
    expect(shortId('ORD-4cd46d90-7b62-3934-a35f-f53fe0d6ee99')).toBe('ORD-4cd4');
    expect(shortId('DL-m00005')).toBe('DL-m00005');
    expect(shortId('ORD-4cd46d90-7b62-3934-a35f-f53fe0d6ee99-S1')).toBe('ORD-4cd4-S1');
    expect(orderLabel({ orderNumber: '43505165', orderId: 'ORD-4cd46d90-7b62-3934-a35f-f53fe0d6ee99' })).toBe('43505165');
    expect(orderLabel({ orderNumber: null, orderId: 'ORD-4cd46d90-7b62-3934-a35f-f53fe0d6ee99' })).toBe('ORD-4cd4');
    expect(deliveryLabel({ deliveryNumber: '74939255-1', deliveryId: 'DLV-x' })).toBe('74939255-1');
    expect(deliveryLabel({ deliveryNumber: null, deliveryId: 'DLV-8704f124-3020-4e1c-8781-dedd07dffef1' })).toBe('DLV-8704');
  });

  it('MOCK 카드 — 주문번호 8자리, 배송 번호 = 주문번호-1', async () => {
    const { Simulation } = await import('../src/sim/simulation');
    const { DEFAULT_PARAMS } = await import('../src/config');
    const sim = new Simulation({ ...DEFAULT_PARAMS, mock: { ...DEFAULT_PARAMS.mock } }, { startEpochMs: Date.UTC(2026, 10, 16, 1, 0, 0) });
    sim.backend.autoOrders = false;
    sim.backend.createOrder({ pickSec: 5, packMinutes: 4, packages: 1, customer: DEFAULT_PARAMS.mfcLocation });
    await sim.runFor(10); // 점원 배차 요청(pickSec 뒤)에 배송이 생긴다
    const [c] = sim.deliveryCards();
    expect(c!.orderNumber).toMatch(/^\d{8}$/);
    expect(c!.deliveryNumber).toBe(`${c!.orderNumber}-1`);
  });
});

describe('주문 탭 — 한 주문의 배송들(1차·재배송)', () => {
  it('생긴 순으로 n차, 일반 배송은 첫 배송 → 재배송, 목적이 있으면 그 이름, 상태는 배차·수행 상태로', () => {
    const a = { ...card('D1', 'O1', 1), executionState: 'FAILED' as const, dispatchState: 'CLOSED' as const };
    const b = { ...card('D2', 'O1', 3), purpose: 'FAILED_DELIVERY_RETURN' as const };
    const c = { ...card('D3', 'O1', 2), executionState: 'COMPLETED' as const, dispatchState: 'CLOSED' as const };
    const tlOf = (id: string) => tl(id, [['created', id === 'D1' ? 0 : id === 'D3' ? 100 : 200]], false);
    const [row] = groupOrders([a, b, c], tlOf, S);
    expect(row!.deliveries.map((d) => [d.n, d.deliveryId, d.kind, d.tone])).toEqual([
      [1, 'D1', '첫 배송', 'fail'],
      [2, 'D3', '재배송', 'done'],
      [3, 'D2', '실패 반납', 'active'],
    ]);
    expect(row!.deliveries[0]!.stateText).toBe('전달 실패 확정');
  });
});
