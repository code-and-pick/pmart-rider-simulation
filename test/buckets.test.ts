// 위쪽 숫자 칸 나누기 — 칸 숫자와 눌렀을 때 목록이 같은 규칙.
import { describe, expect, it } from 'vitest';
import type { DeliveryCard } from '../src/sim/world';
import { bucketOf, countBuckets, isFailedCall } from '../src/ui/buckets';

const card = (dispatchState: DeliveryCard['dispatchState'], executionState: DeliveryCard['executionState']): DeliveryCard => ({
  deliveryId: 'D',
  orderId: null,
  orderNumber: null,
  deliveryNumber: null,
  shipmentId: null,
  dispatchState,
  executionState,
  riderId: null,
  riderIds: [],
  radiusKm: null,
  customer: null,
  purpose: null,
  pickup: null,
  createdAt: 0,
});

describe('숫자 칸', () => {
  it('두 상태로 칸을 정한다', () => {
    expect(bucketOf(card('CLOSED', 'COMPLETED'))).toBe('done');
    expect(bucketOf(card('PICKED_UP', 'FAILURE_REPORTED'))).toBe('deliveryFailed');
    expect(bucketOf(card('DISPATCH_FAILED', 'UNASSIGNED'))).toBe('dispatchFailed');
    expect(bucketOf(card('DISPATCHING', null))).toBe('searching');
    expect(bucketOf(card(null, 'UNASSIGNED'))).toBe('searching'); // 실서버 — 배차를 아직 못 읽음
    expect(bucketOf(card('ASSIGNED', 'ARRIVED_AT_STORE'))).toBe('delivering');
    expect(bucketOf(card('PICKED_UP', 'PICKED_UP'))).toBe('delivering');
    expect(bucketOf(card('CANCELLED_BEFORE_PICKUP', 'CANCELLED'))).toBe('closed');
  });

  it('센 숫자', () => {
    const n = countBuckets([card('CLOSED', 'COMPLETED'), card('CLOSED', 'COMPLETED'), card('DISPATCHING', null), card('CANCELLED_BEFORE_PICKUP', 'CANCELLED')]);
    expect(n).toMatchObject({ done: 2, searching: 1, closed: 1, delivering: 0 });
  });

  it('요청 실패 = 응답 없음·5xx (4xx 는 서버가 확정한 거절이라 아님)', () => {
    expect(isFailedCall({ status: 'ERR' })).toBe(true);
    expect(isFailedCall({ status: 503 })).toBe(true);
    expect(isFailedCall({ status: 500 })).toBe(true);
    expect(isFailedCall({ status: 404 })).toBe(false);
    expect(isFailedCall({ status: 200 })).toBe(false);
  });
});
