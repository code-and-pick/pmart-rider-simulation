// 배송 한 건의 흐름·시간 — 언제 무슨 일이 있었는지(화면 배송 카드를 누르면 펼쳐 보인다).
// 시각은 모두 서버가 남긴 값(배차·수행 기록)에서 읽는다. 엔진이 잰 값은 출처를 "라이더 엔진"으로 따로 붙인다.
// React 에 의존하지 않는다.

import { riderName } from '../domain/riderId';
import type { Delivery, DeliveryPurpose, DispatchAttempt, ExecutionState, OfferState, StaffDeliverySummary, StatusHistoryEntry } from '../domain/contract';

/** 단계 하나. atMs = epoch ms */
export interface TimelineStep {
  key: string;
  label: string;
  atMs: number;
  /** 어디서 읽은 시각인가 — 배차(delivery-dispatch)·수행(delivery-execution)·라이더 엔진(시뮬레이터) */
  source: '배차' | '수행' | '라이더 엔진';
  /** 덧붙임(라이더 ID·제안 수 등) — 주소·전화는 넣지 않는다 */
  detail?: string;
  /** 실패·취소처럼 흐름이 끊긴 단계 */
  bad?: boolean;
}

export interface DeliveryTimeline {
  deliveryId: string;
  orderId: string | null;
  /** 화면용 주문번호·배송 번호(있으면 이것을 보인다) */
  orderNumber?: string | null;
  deliveryNumber?: string | null;
  purpose: DeliveryPurpose | null;
  /** 시각 순 */
  steps: TimelineStep[];
  /** 끝났으면 마지막 단계 시각, 진행 중이면 null(화면이 지금까지로 잰다) */
  endMs: number | null;
  /** 이 배송의 시각 기준 — sim = 시뮬레이션 시각(배속 반영), real = 실제 시각 */
  basis: 'sim' | 'real';
  /** 이 화면에서 볼 수 없는 단계 안내(실서버 직원 목록에 없는 시각 등) */
  gaps: string[];
  /** 배차 제안 한 줄씩(누가 거절·만료·수락했나) — 배차 관점을 못 읽었으면 빈 배열 */
  offers?: OfferRow[];
}

/** 배차 제안 한 건 — dispatch GET /deliveries/{id}/dispatch 의 attempts[].offers[](계약엔 거절 사유 칸이 없다) */
export interface OfferRow {
  offerId: string;
  riderId: string | null;
  radiusKm: number | null;
  sentAtMs: number | null;
  state: OfferState | null;
  /** 몇 번째 배차 시도인가(1부터) */
  attempt: number;
  /** 시도 계기 — 재배차(REASSIGN)·재시도(RETRY)면 표시 */
  trigger: DispatchAttempt['trigger'] | null;
  /** 배달리스트에서 직접 잡은 것(제안이 아님) */
  fromList: boolean;
}

export const OFFER_STATE_LABEL: Record<OfferState, string> = {
  SENT: '응답 기다림',
  ACCEPTED: '수락',
  REJECTED: '거절',
  EXPIRED: '만료(1분 무응답)',
  LATE: '늦은 수락(이미 배정됨)',
  SEND_FAILED: '보내기 실패',
  SUPERSEDED: '다른 라이더가 먼저',
};

/** 배차 관점에서 제안 목록 — 보낸 시각 순 */
export function offerRows(d: Delivery | null): OfferRow[] {
  if (!d) return [];
  const out: OfferRow[] = [];
  (d.attempts ?? []).forEach((a, i) => {
    for (const o of a.offers ?? []) {
      out.push({
        offerId: o.offerId ?? `${i}-${out.length}`,
        riderId: o.riderId ?? null,
        radiusKm: o.radiusKm ?? null,
        sentAtMs: ms(o.sentAt),
        state: o.state ?? null,
        attempt: i + 1,
        trigger: a.trigger ?? null,
        fromList: o.source === 'DELIVERY_LIST',
      });
    }
  });
  return out.sort((x, y) => (x.sentAtMs ?? 0) - (y.sentAtMs ?? 0));
}

/** 수행 상태 → 화면 단계 이름. ASSIGNED·UNASSIGNED 는 배차 쪽 배정과 겹쳐 뺀다. */
const EXEC_LABEL: Partial<Record<ExecutionState, { label: string; bad?: boolean; end?: boolean }>> = {
  ARRIVED_AT_STORE: { label: '가게 도착' },
  PICKED_UP: { label: '픽업 완료(QR 인계)' },
  ARRIVED_AT_CUSTOMER: { label: '고객 도착' },
  FAILURE_REPORTED: { label: '전달 실패 등록', bad: true },
  COMPLETED: { label: '전달 완료', end: true },
  FAILED: { label: '전달 실패 확정', bad: true, end: true },
  SUSPENDED: { label: '수행 중지', bad: true },
  RETURN_IN_PROGRESS: { label: '가게로 되돌리는 중', bad: true },
  RETURN_PICKED_UP: { label: '되돌림 물건 회수', bad: true },
  RETURNED_TO_STORE: { label: '가게로 되돌림', bad: true, end: true },
  CANCELLED: { label: '수행 취소', bad: true, end: true },
};

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** 배차 관점(dispatch)에서 단계 — 배송 생성·첫 제안·배정·재배차·배차 실패·픽업 전 취소 */
export function dispatchSteps(d: Delivery | null, createdMs: number | null): TimelineStep[] {
  const out: TimelineStep[] = [];
  if (createdMs !== null) out.push({ key: 'created', label: '배차 요청(배송 생성)', atMs: createdMs, source: '배차' });
  if (!d) return out;
  const offers = (d.attempts ?? []).flatMap((a) => a.offers ?? []);
  const sent = offers.map((o) => ms(o.sentAt)).filter((x): x is number => x !== null);
  if (sent.length) {
    const rejected = offers.filter((o) => o.state === 'REJECTED' || o.state === 'EXPIRED').length;
    out.push({
      key: 'firstOffer',
      label: '첫 제안 보냄',
      atMs: Math.min(...sent),
      source: '배차',
      detail: `제안 ${offers.length}번${rejected ? ` · 거절·만료 ${rejected}` : ''}`,
    });
  }
  const reassigns = (d.attempts ?? []).filter((a) => a.trigger === 'REASSIGN');
  for (const a of reassigns) {
    const t = ms(a.startedAt);
    if (t !== null) out.push({ key: `reassign-${a.attemptId ?? t}`, label: '재배차 시작(배정 취소 뒤)', atMs: t, source: '배차', bad: true });
  }
  const assigned = ms(d.assignment?.assignedAt);
  if (assigned !== null) out.push({ key: 'assigned', label: '배정(라이더 수락)', atMs: assigned, source: '배차', detail: d.assignment?.riderId ? riderName(d.assignment.riderId) : undefined });
  const updated = ms(d.updatedAt);
  if (d.state === 'DISPATCH_FAILED' && updated !== null) {
    const reason = (d.attempts ?? []).at(-1)?.failureReason;
    out.push({ key: 'dispatchFailed', label: '배차 실패', atMs: updated, source: '배차', bad: true, detail: reason });
  }
  if (d.state === 'CANCELLED_BEFORE_PICKUP') {
    const t = ms(d.assignment?.cancelledAt) ?? updated;
    if (t !== null) out.push({ key: 'cancelled', label: '픽업 전 취소', atMs: t, source: '배차', bad: true });
  }
  return out;
}

/** 수행 기록(history)에서 단계 */
export function executionSteps(history: readonly StatusHistoryEntry[]): TimelineStep[] {
  const out: TimelineStep[] = [];
  for (const h of history) {
    const def = h.state ? EXEC_LABEL[h.state] : undefined;
    const t = ms(h.occurredAt ?? h.recordedAt);
    if (!def || t === null) continue;
    out.push({ key: `x-${h.state}-${t}`, label: def.label, atMs: t, source: '수행', bad: def.bad });
  }
  return out;
}

/** 실서버 직원 배송 목록 한 줄에서 단계(수행 기록이 없을 때) — 배정·픽업·완료 시각만 있다 */
export function summarySteps(s: StaffDeliverySummary, hasDispatchAssigned: boolean): TimelineStep[] {
  const out: TimelineStep[] = [];
  const a = ms(s.assignedAt);
  if (a !== null && !hasDispatchAssigned) out.push({ key: 'assigned', label: '배정(라이더 수락)', atMs: a, source: '수행', detail: s.riderId ? riderName(s.riderId) : undefined });
  const p = ms(s.pickedUpAt);
  if (p !== null) out.push({ key: 'x-PICKED_UP', label: '픽업 완료(QR 인계)', atMs: p, source: '수행' });
  const c = ms(s.completedAt);
  if (c !== null) out.push({ key: 'x-COMPLETED', label: '전달 완료', atMs: c, source: '수행' });
  return out;
}

const END_KEYS = new Set(['dispatchFailed', 'cancelled']);

/** 단계를 시각 순으로 묶고 끝 시각을 정한다 */
export function assemble(
  base: Omit<DeliveryTimeline, 'steps' | 'endMs'>,
  steps: TimelineStep[],
  terminal: boolean,
): DeliveryTimeline {
  // 시각은 ms 로 맞춰 비교한다(ISO 는 ms 까지라 소수점 시각과 섞이면 같은 순간의 순서가 뒤집힌다). 같으면 넣은 순서 그대로(안정 정렬).
  const sorted = steps.map((s) => ({ ...s, atMs: Math.round(s.atMs) })).sort((a, b) => a.atMs - b.atMs);
  const last = sorted.at(-1);
  const ended =
    terminal ||
    sorted.some((s) => END_KEYS.has(s.key) || /^x-(COMPLETED|FAILED|RETURNED_TO_STORE|CANCELLED)-?/.test(s.key));
  return { ...base, steps: sorted, endMs: ended && last ? last.atMs : null };
}
