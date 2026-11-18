// 주문 탭 — 배송 카드를 주문번호로 묶고, 주문마다 흐름 막대(구간별 걸린 시간)를 만든다. React 에 의존하지 않는다(시험).
// 한 주문에 배송이 여럿일 수 있다(오배송 회수·재발송·다시 배송). 주문번호를 모르면 배송 하나를 한 줄로 본다.

import type { DeliveryCard } from '../sim/world';
import type { DeliveryTimeline, TimelineStep } from '../sim/timeline';

/** 막대 구간 색 이름 — 지표 막대(Metrics SEG_COLOR)와 같은 구간 */
export type SegKind = 'findRider' | 'toStore' | 'atStore' | 'storeAll' | 'toCustomer' | 'bad' | 'now' | 'between';

/** 막대용 단계 — 어느 배송의 단계인지(한 주문에 배송이 여럿이면 배송 사이를 따로 그린다) */
export type OrderStep = TimelineStep & { deliveryId?: string };

export interface OrderSeg {
  kind: SegKind;
  /** 이 구간이 끝난 단계(진행 중 구간은 "진행 중") */
  label: string;
  sec: number;
}

export interface OrderRow {
  /** 주문번호 — 모르면 null(배송 ID 로 한 줄) */
  orderId: string | null;
  /** 화면용 주문번호 — 없으면 null */
  orderNumber: string | null;
  deliveryIds: string[];
  startMs: number | null;
  /** 모든 배송이 끝났으면 마지막 시각, 하나라도 진행 중이면 null */
  endMs: number | null;
  /** 마지막 단계 이름 */
  lastLabel: string;
  /** 실패·취소로 끝났거나 지금 그 상태 */
  bad: boolean;
  segments: OrderSeg[];
  /** 가장 늦게 생긴 배송 시각(정렬용) */
  createdAt: number;
}

/** 단계로 끝나는 구간이 어느 구간인가 */
function kindOf(step: TimelineStep, storeKnown: boolean): SegKind {
  if (step.bad) return 'bad';
  if (step.key === 'firstOffer' || step.key === 'assigned') return 'findRider';
  if (step.key === 'engine-store' || step.key.startsWith('x-ARRIVED_AT_STORE')) return 'toStore';
  if (step.key.startsWith('x-PICKED_UP')) return storeKnown ? 'atStore' : 'storeAll';
  return 'toCustomer';
}

/** 단계 목록 → 막대 구간(앞 단계 → 이 단계). 진행 중이면 마지막 단계 → 지금 구간을 붙인다. */
export function segmentsOf(steps: readonly OrderStep[], endMs: number | null, nowMs: number): OrderSeg[] {
  const storeKnown = steps.some((s) => s.key === 'engine-store' || s.key.startsWith('x-ARRIVED_AT_STORE'));
  const out: OrderSeg[] = [];
  for (let i = 1; i < steps.length; i++) {
    const s = steps[i] as OrderStep;
    const prev = steps[i - 1] as OrderStep;
    const sec = (s.atMs - prev.atMs) / 1000;
    // 다른 배송이 새로 생긴 단계 — 앞 배송에서 다음 배송(회수·재발송·다시 배송)이 생기기까지
    if (s.key === 'created' && s.deliveryId !== prev.deliveryId) out.push({ kind: 'between', label: `다음 배송(${s.deliveryId ?? '?'}) 생성`, sec });
    else out.push({ kind: kindOf(s, storeKnown), label: s.label, sec });
  }
  const last = steps.at(-1);
  if (endMs === null && last) out.push({ kind: 'now', label: '진행 중', sec: Math.max(0, (nowMs - last.atMs) / 1000) });
  return out;
}

/** 배송 카드 → 주문 줄(최근 주문 먼저) */
export function groupOrders(
  cards: readonly DeliveryCard[],
  timelineOf: (deliveryId: string) => DeliveryTimeline | null,
  nowMs: number,
): OrderRow[] {
  const groups = new Map<string, DeliveryCard[]>();
  for (const c of cards) {
    const k = c.orderId ?? `#${c.deliveryId}`;
    const g = groups.get(k);
    if (g) g.push(c);
    else groups.set(k, [c]);
  }
  const rows: OrderRow[] = [];
  for (const g of groups.values()) {
    const tls = g.map((c) => timelineOf(c.deliveryId)).filter((t): t is DeliveryTimeline => t !== null);
    const steps: OrderStep[] = tls.flatMap((t) => t.steps.map((s) => ({ ...s, deliveryId: t.deliveryId }))).sort((a, b) => a.atMs - b.atMs);
    const done = tls.length > 0 && tls.every((t) => t.endMs !== null);
    const last = steps.at(-1);
    const endMs = done && last ? last.atMs : null;
    rows.push({
      orderId: g[0]?.orderId ?? null,
      orderNumber: g.find((c) => c.orderNumber)?.orderNumber ?? null,
      deliveryIds: g.map((c) => c.deliveryId),
      startMs: steps[0]?.atMs ?? null,
      endMs,
      lastLabel: last?.label ?? '기록 없음',
      bad: !!last?.bad,
      segments: segmentsOf(steps, endMs, nowMs),
      createdAt: Math.max(...g.map((c) => c.createdAt)),
    });
  }
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}
