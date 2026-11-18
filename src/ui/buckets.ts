// 위쪽 숫자 칸 — 배송 카드를 칸별로 나눈다(누르면 그 배송만 보이고, 숫자도 같은 규칙으로 센다 — 칸 숫자와 목록이 어긋나지 않게).
// 두 서비스 상태(배차 dispatch · 수행 execution)를 함께 본다. React 에 의존하지 않는다(시험).

import type { DeliveryCard } from '../sim/world';

export type Bucket = 'done' | 'delivering' | 'searching' | 'dispatchFailed' | 'deliveryFailed' | 'closed';

export const BUCKET_LABEL: Record<Exclude<Bucket, 'closed'>, string> = {
  done: '전달 완료',
  delivering: '배송 중',
  searching: '라이더 찾는 중',
  dispatchFailed: '배차 실패',
  deliveryFailed: '전달 실패',
};

/** 배송 하나가 어느 칸인가. closed = 칸에 없는 끝(픽업 전 취소·되돌림 등) */
export function bucketOf(c: DeliveryCard): Bucket {
  const x = c.executionState;
  const d = c.dispatchState;
  if (x === 'COMPLETED') return 'done';
  if (x === 'FAILURE_REPORTED' || x === 'FAILED') return 'deliveryFailed';
  if (d === 'DISPATCH_FAILED') return 'dispatchFailed';
  if (d === 'CANCELLED_BEFORE_PICKUP' || x === 'CANCELLED' || x === 'RETURNED_TO_STORE' || d === 'CLOSED') return 'closed';
  if (d === 'CREATED' || d === 'DISPATCHING') return 'searching';
  if (!d && (x === 'UNASSIGNED' || x === null)) return 'searching';
  return 'delivering';
}

export function countBuckets(cards: readonly DeliveryCard[]): Record<Bucket, number> {
  const n: Record<Bucket, number> = { done: 0, delivering: 0, searching: 0, dispatchFailed: 0, deliveryFailed: 0, closed: 0 };
  for (const c of cards) n[bucketOf(c)]++;
  return n;
}

/** 응답 끊김(요청 실패)으로 세는 API 기록 — 응답 없음(ERR)·서버 오류 5xx */
export function isFailedCall(r: { status: number | 'ERR' }): boolean {
  return r.status === 'ERR' || (typeof r.status === 'number' && r.status >= 500);
}
