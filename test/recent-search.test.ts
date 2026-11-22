// 목록 관제 최근 배송 찾기 — 번호·시스템 ID·라이더 이름/번호
import { describe, expect, it } from 'vitest';
import type { OpsRow } from '../src/ui/ops';
import { recentMatches } from '../src/ui/RiderControlPage';

const row = (over: Partial<OpsRow['card']>) =>
  ({
    card: { deliveryId: 'DLV-aaa', deliveryNumber: 'D28767701-2', orderId: 'ORD-bbb', orderNumber: '28767701', shipmentId: 'ORD-bbb-S1', riderId: 'RD-xyz', ...over },
  }) as unknown as OpsRow;
const label = () => '이* · 478597';

describe('최근 배송 찾기', () => {
  it('빈 찾기면 모두, 배송 번호·주문번호·ID·라이더 이름/번호 일부로 찾는다(소문자 비교)', () => {
    expect(recentMatches(row({}), '', label)).toBe(true);
    expect(recentMatches(row({}), '-2', label)).toBe(true);
    expect(recentMatches(row({}), '28767701', label)).toBe(true);
    expect(recentMatches(row({}), 'dlv-aaa', label)).toBe(true);
    expect(recentMatches(row({}), 's1', label)).toBe(true);
    expect(recentMatches(row({}), '478597', label)).toBe(true);
    expect(recentMatches(row({}), '없는값', label)).toBe(false);
  });
  it('라이더 없는 배송은 라이더로 찾지 않는다', () => {
    expect(recentMatches(row({ riderId: null }), '478597', label)).toBe(false);
  });
});
