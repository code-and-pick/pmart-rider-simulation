// 흐름 탭 배차 제안 목록 — 시도마다 제안을 펼쳐 보낸 시각 순으로, 시도 번호·계기·배달리스트 표시.
import { describe, expect, it } from 'vitest';
import type { Delivery } from '../src/domain/contract';
import { offerRows } from '../src/sim/timeline';

describe('배차 제안 목록', () => {
  it('시도 → 제안을 펼치고 보낸 시각 순', () => {
    const d = {
      attempts: [
        {
          trigger: 'AUTO',
          offers: [
            { offerId: 'o2', riderId: 'RD-b', radiusKm: 1, sentAt: '2026-11-19T03:00:30Z', state: 'EXPIRED' },
            { offerId: 'o1', riderId: 'RD-a', radiusKm: 1, sentAt: '2026-11-19T03:00:00Z', state: 'REJECTED' },
          ],
        },
        { trigger: 'REASSIGN', offers: [{ offerId: 'o3', riderId: 'RD-c', radiusKm: 2, sentAt: '2026-11-19T03:05:00Z', state: 'ACCEPTED', source: 'DELIVERY_LIST' }] },
      ],
    } as Delivery;
    const rows = offerRows(d);
    expect(rows.map((r) => [r.offerId, r.state, r.attempt, r.trigger, r.fromList])).toEqual([
      ['o1', 'REJECTED', 1, 'AUTO', false],
      ['o2', 'EXPIRED', 1, 'AUTO', false],
      ['o3', 'ACCEPTED', 2, 'REASSIGN', true],
    ]);
    expect(offerRows(null)).toEqual([]);
  });
});
