// 주문 탭 — 배송 카드를 주문번호로 묶고, 주문마다 흐름 막대(구간별 걸린 시간)를 만든다. React 에 의존하지 않는다(시험).
// 한 주문에 배송이 여럿일 수 있다(오배송 회수·재발송·다시 배송). 주문번호를 모르면 배송 하나를 한 줄로 본다.

import { displayStage, purposeLabel, type StageTone } from '../domain/displayStage';
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
  /** 이 주문의 배송들 — 생긴 순(1차·2차…). 한 주문에 배송이 여럿이면 무엇이 재배송이고 어디까지 됐는지 보인다 */
  deliveries: OrderDelivery[];
  /** 가장 늦게 생긴 배송 시각(정렬용) */
  createdAt: number;
}

/** 주문 안 배송 한 건 — n차, 무슨 배송인지, 지금 어디까지 */
export interface OrderDelivery {
  deliveryId: string;
  deliveryNumber: string | null;
  /** 생긴 순서 1, 2, 3… */
  n: number;
  /** "첫 배송"·"재배송"·"오배송 회수"·"재발송"·"다시 배송"·"반품 회수"·"실패 반납" */
  kind: string;
  /** 지금 상태 글(배차·수행 상태로 — 전달 완료·전달 실패 확정·라이더 찾는 중 …) */
  stateText: string;
  tone: StageTone;
  /** 단계 이름들과 지금 단계 번호 — 점 막대(●●●○○) */
  labels: readonly string[];
  index: number;
  startMs: number | null;
  endMs: number | null;
}

/** 배송 종류 이름 — 목적이 있으면 그것, 일반 배송이면 첫 번째는 "첫 배송", 그 뒤는 "재배송" */
export function deliveryKind(n: number, purpose: DeliveryCard['purpose']): string {
  return purposeLabel(purpose) ?? (n === 1 ? '첫 배송' : '재배송');
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
    const byStart = g
      .map((c) => ({ c, t: tls.find((t) => t.deliveryId === c.deliveryId) ?? null }))
      .sort((a, b) => (a.t?.steps[0]?.atMs ?? a.c.createdAt) - (b.t?.steps[0]?.atMs ?? b.c.createdAt));
    const deliveries: OrderDelivery[] = byStart.map(({ c, t }, i) => {
      const purpose = c.purpose ?? t?.purpose ?? null;
      const st = displayStage(c.dispatchState, c.executionState, c.radiusKm, purpose);
      return {
        deliveryId: c.deliveryId,
        deliveryNumber: c.deliveryNumber ?? t?.deliveryNumber ?? null,
        n: i + 1,
        kind: deliveryKind(i + 1, purpose),
        stateText: st.text,
        tone: st.tone,
        labels: st.labels,
        index: st.index,
        startMs: t?.steps[0]?.atMs ?? null,
        endMs: t?.endMs ?? null,
      };
    });
    rows.push({
      orderId: g[0]?.orderId ?? null,
      deliveries,
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
