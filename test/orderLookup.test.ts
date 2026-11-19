// 주문 창 "주문" 탭 — 주문 상세 읽기와 원문 열람(결과 불명이면 같은 키로 다시, 서버 확정만 확정).
import { describe, expect, it } from 'vitest';
import { ApiProblem, ResultUnknown, type StaffOrderDetail, type StaffPiiReveal } from '../src/domain/contract';
import { OrderLookup, reasonProblem, type OrderSource } from '../src/sim/orderLookup';

const flush = () => new Promise((r) => setTimeout(r, 0));
const detail = { orderId: 'OR-1' } as StaffOrderDetail;
const reveal = { orderId: 'OR-1', piiAccessLogId: 'PAL-1', recordedAt: '2026-11-19T03:00:00Z', fields: ['NAME'], shippingAddress: null } as StaffPiiReveal;

function source(revealResults: (() => Promise<StaffPiiReveal>)[]) {
  const keys: string[] = [];
  let gets = 0;
  const src: OrderSource = {
    getOrder: async () => {
      gets++;
      return detail;
    },
    reveal: (_id, _body, w) => {
      keys.push(w.idempotencyKey);
      return (revealResults.shift() ?? (async () => reveal))();
    },
  };
  return { src, keys, gets: () => gets };
}

let n = 0;
const newKey = () => `k${++n}`;

describe('주문 탭', () => {
  it('상세는 한 번 읽어 두고, 막혔으면 부르지 않는다', async () => {
    const s = source([]);
    const o = new OrderLookup(s.src, () => null, newKey);
    expect(o.detail('OR-1').state).toBe('loading');
    await flush();
    expect(o.detail('OR-1')).toEqual({ state: 'ok', detail });
    expect(s.gets()).toBe(1);
    const blocked = new OrderLookup(s.src, () => '다른 기기', newKey);
    expect(blocked.detail('OR-1')).toEqual({ state: 'none', reason: '다른 기기' });
    expect(s.gets()).toBe(1);
  });

  it('사유는 2~200자 — 아니면 보내지 않는다', async () => {
    expect(reasonProblem(' a ')).not.toBeNull();
    expect(reasonProblem('고객 문의')).toBeNull();
    expect(reasonProblem('가'.repeat(201))).not.toBeNull();
    const s = source([]);
    const o = new OrderLookup(s.src, () => null, newKey);
    await o.reveal('OR-1', ' ', ['NAME']);
    expect(o.revealView('OR-1').state).toBe('failed');
    expect(s.keys).toEqual([]);
  });

  it('결과 불명이면 원문 없음 — 같은 사유·항목으로 다시 누르면 같은 키, 사유가 바뀌면 새 키', async () => {
    const s = source([
      async () => {
        throw new ResultUnknown('응답 없음');
      },
      async () => {
        throw new ApiProblem(503, { code: 'DEPENDENCY_UNAVAILABLE' });
      },
      async () => reveal,
    ]);
    const o = new OrderLookup(s.src, () => null, newKey);
    await o.reveal('OR-1', '고객 문의', ['NAME']);
    expect(o.revealView('OR-1').state).toBe('unknown');
    await o.reveal('OR-1', '고객 문의', ['NAME']);
    expect(o.revealView('OR-1').state).toBe('unknown');
    expect(s.keys[0]).toBe(s.keys[1]);
    await o.reveal('OR-1', '고객 문의 — 배송지', ['NAME']);
    expect(s.keys[2]).not.toBe(s.keys[1]);
    expect(o.revealView('OR-1')).toEqual({ state: 'ok', reveal });
    o.hide('OR-1');
    expect(o.revealView('OR-1').state).toBe('none');
  });

  it('거절(4xx)은 실패로 — 다음엔 새 키', async () => {
    const s = source([
      async () => {
        throw new ApiProblem(403, { code: 'FORBIDDEN' });
      },
    ]);
    const o = new OrderLookup(s.src, () => null, newKey);
    await o.reveal('OR-1', '고객 문의', ['PHONE']);
    expect(o.revealView('OR-1')).toMatchObject({ state: 'failed' });
    await o.reveal('OR-1', '고객 문의', ['PHONE']);
    expect(s.keys[0]).not.toBe(s.keys[1]);
  });
});
