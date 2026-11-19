// 라이더 관제 "주문번호·라이더 찾기" — 하이픈·공백·가운뎃점을 양쪽 다 빼고 비교, 정확히 같은 것 먼저.
import { describe, expect, it } from 'vitest';
import type { OpsRow } from '../src/ui/ops';
import { findTarget, normKey } from '../src/ui/RiderBoard';
import type { RiderRow } from '../src/ui/riderTable';

const rider = (id: string, name: string) => ({ id, name }) as RiderRow;
const del = (deliveryId: string, orderNumber: string | null, deliveryNumber: string | null, riderId: string | null) =>
  ({ card: { deliveryId, orderNumber, deliveryNumber, orderId: null, riderId } }) as unknown as OpsRow;

const riders = [rider('RD-sim-01', 'sim-01'), rider('RD-5c41a0e7-2ac3', '이* · 478597'), rider('RD-d573', '배*지 · 958685')];
const dels = [del('DLV-969d9b82', '44081126', '44081126-1', 'RD-5c41a0e7-2ac3'), del('DL-m0005', '74939255', '74939255-1', null)];

describe('주문번호·라이더 찾기', () => {
  it('하이픈·별표·가운뎃점 무시', () => {
    expect(normKey('RD-sim-01')).toBe('rdsim01');
    expect(normKey('이* · 478597')).toBe('이478597');
  });

  it('예전에 안 되던 것 — sim-01, 라이더 ID, 배송 ID', () => {
    expect(findTarget('sim-01', riders, dels)).toMatchObject({ kind: 'one', riderId: 'RD-sim-01' });
    expect(findTarget('RD-5c41a0e7-2ac3', riders, dels)).toMatchObject({ kind: 'one', riderId: 'RD-5c41a0e7-2ac3' });
    expect(findTarget('DLV-969d9b82', riders, dels)).toMatchObject({ kind: 'one', deliveryId: 'DLV-969d9b82', riderId: 'RD-5c41a0e7-2ac3' });
  });

  it('라이더 번호 6자리 · 주문번호 8자리 · 배송번호', () => {
    expect(findTarget('958685', riders, dels)).toMatchObject({ riderId: 'RD-d573' });
    expect(findTarget('44081126', riders, dels)).toMatchObject({ deliveryId: 'DLV-969d9b82', riderId: 'RD-5c41a0e7-2ac3' });
    expect(findTarget('74939255-1', riders, dels)).toMatchObject({ deliveryId: 'DL-m0005', riderId: null });
  });

  it('정확히 같은 게 없으면 들어 있는 것(4자 이상), 여럿이면 many', () => {
    expect(findTarget('8597', riders, dels)).toMatchObject({ kind: 'one', riderId: 'RD-5c41a0e7-2ac3' });
    expect(findTarget('sim', riders, dels)).toEqual({ kind: 'none' }); // 3자는 부분 일치 안 함
    expect(findTarget('없는번호', riders, dels)).toEqual({ kind: 'none' });
    expect(findTarget('9', riders, dels).kind).toBe('none');
  });
});
