// 관제판 — 화면에 이미 있는 값(배송 카드·흐름·라이더·API 기록)만으로 지연·이상을 골라낸다. React 에 의존하지 않는다(시험).
// 배송 상태를 바꾸지 않는다(화면 알림만). 기준은 config OPS_THRESHOLDS [가정].

import { OPS_THRESHOLDS } from '../config';
import type { DeliveryTimeline } from '../sim/timeline';
import type { DeliveryCard, RiderView } from '../sim/world';
import { type Bucket, bucketOf, isFailedCall } from './buckets';

export type AlertLevel = 'bad' | 'warn';

export interface OpsAlert {
  level: AlertLevel;
  /** 같은 대상 중복 막기·정렬 */
  key: string;
  kind: 'SEARCH_LONG' | 'STORE_WAIT' | 'LATE' | 'DISPATCH_FAILED' | 'DELIVERY_FAILED' | 'RIDER_STALE' | 'CALL_FAILURES';
  title: string;
  detail: string;
  deliveryId?: string;
  riderId?: string;
  /** 얼마나 오래(초) — 정렬용 */
  sec: number;
  /** 기준을 넘긴 초(목록 "+n분") — 기준이 없는 알림은 없음 */
  overSec?: number;
}

/** 배송 한 줄(관제 목록) */
export interface OpsRow {
  card: DeliveryCard;
  bucket: Bucket;
  /** 배송 생성(배차 요청) 시각 epoch ms — 모르면 null */
  startMs: number | null;
  /** 지금 단계와 그 단계에 들어온 시각 */
  stepLabel: string | null;
  stepAtMs: number | null;
  /** 생성부터 지금(끝났으면 끝)까지 초 */
  totalSec: number | null;
  /** 지연·이상(가장 심한 것) — 없으면 null */
  alert: OpsAlert | null;
}

export interface OpsBoard {
  rows: OpsRow[];
  alerts: OpsAlert[];
  counts: Record<Bucket, number> & { delayed: number; active: number };
  riders: { total: number; busy: number; stale: number; app: number };
  /** 최근 failBurstWindowSec 안 요청 실패 수 */
  recentFailures: number;
}

const ACTIVE: ReadonlySet<Bucket> = new Set(['searching', 'delivering']);

export function buildBoard(input: {
  cards: readonly DeliveryCard[];
  timelineOf: (deliveryId: string) => DeliveryTimeline | null;
  riders: readonly RiderView[];
  calls: readonly { at: number; status: number | 'ERR' }[];
  /** API 기록 시각(시뮬 초) → epoch ms */
  epochOf: (at: number) => number;
  nowMs: number;
  t?: typeof OPS_THRESHOLDS;
}): OpsBoard {
  const t = input.t ?? OPS_THRESHOLDS;
  const alerts: OpsAlert[] = [];
  const rows: OpsRow[] = input.cards.map((card) => {
    const bucket = bucketOf(card);
    const active = ACTIVE.has(bucket);
    // 흐름은 진행 중·실패만 읽는다(끝난 배송이 많아도 가볍게)
    const tl = active || bucket === 'dispatchFailed' || bucket === 'deliveryFailed' ? input.timelineOf(card.deliveryId) : null;
    const first = tl?.steps[0];
    const last = tl?.steps.at(-1);
    const startMs = first?.atMs ?? null;
    const endMs = tl?.endMs ?? (active ? input.nowMs : null);
    const row: OpsRow = {
      card,
      bucket,
      startMs,
      stepLabel: last?.label ?? null,
      stepAtMs: last?.atMs ?? null,
      totalSec: startMs !== null && endMs !== null ? Math.max(0, (endMs - startMs) / 1000) : null,
      alert: null,
    };
    const label = card.deliveryNumber ?? card.orderNumber ?? card.deliveryId;
    const push = (a: Omit<OpsAlert, 'key' | 'deliveryId' | 'riderId'>) => {
      const full: OpsAlert = { ...a, key: `${a.kind}:${card.deliveryId}`, deliveryId: card.deliveryId, riderId: card.riderId ?? undefined };
      alerts.push(full);
      if (!row.alert || (row.alert.level === 'warn' && full.level === 'bad')) row.alert = full;
    };
    if (bucket === 'dispatchFailed') push({ level: 'bad', kind: 'DISPATCH_FAILED', title: '배차 실패', detail: `${label} — 라이더를 못 찾음`, sec: row.totalSec ?? 0 });
    if (bucket === 'deliveryFailed') push({ level: 'bad', kind: 'DELIVERY_FAILED', title: '전달 실패', detail: `${label} — 확정·회수 확인 필요`, sec: row.totalSec ?? 0 });
    if (active && row.totalSec !== null) {
      if (bucket === 'searching' && row.totalSec >= t.searchWarnSec) {
        push({
          level: row.totalSec >= t.searchBadSec ? 'bad' : 'warn',
          kind: 'SEARCH_LONG',
          title: '라이더 못 찾음',
          detail: `${label} — 배차 요청 뒤 ${min(row.totalSec)}분째`,
          sec: row.totalSec,
          overSec: row.totalSec - t.searchWarnSec,
        });
      }
      const atStore = last && (last.key === 'engine-store' || last.key.startsWith('x-ARRIVED_AT_STORE'));
      if (atStore && last) {
        const wait = (input.nowMs - last.atMs) / 1000;
        if (wait >= t.storeWaitWarnSec) push({ level: 'warn', kind: 'STORE_WAIT', title: '가게에서 대기 길어짐', detail: `${label} — 가게 도착 뒤 ${min(wait)}분째 픽업 전`, sec: wait, overSec: wait - t.storeWaitWarnSec });
      }
      if (row.totalSec >= t.lateTotalSec) push({ level: 'warn', kind: 'LATE', title: '배송 지연', detail: `${label} — 배차 요청부터 ${min(row.totalSec)}분째 진행 중`, sec: row.totalSec, overSec: row.totalSec - t.lateTotalSec });
    }
    return row;
  });

  let stale = 0;
  for (const r of input.riders) {
    if (!r.locationOffline) continue;
    stale++;
    // 배송 중인 라이더의 위치 끊김만 알린다(쉬는 라이더는 숫자만)
    if (r.deliveryId) {
      alerts.push({
        level: 'warn',
        key: `RIDER_STALE:${r.id}`,
        kind: 'RIDER_STALE',
        title: '배송 중 위치 끊김',
        detail: `${r.label ?? r.id} — 위치가 안 들어옴`,
        riderId: r.id,
        deliveryId: r.deliveryId,
        sec: 0,
      });
    }
  }

  const since = input.nowMs - t.failBurstWindowSec * 1000;
  const recentFailures = input.calls.filter((c) => isFailedCall(c) && input.epochOf(c.at) >= since).length;
  if (recentFailures >= t.failBurstCount) {
    alerts.push({
      level: 'warn',
      key: 'CALL_FAILURES',
      kind: 'CALL_FAILURES',
      title: '실서버 요청 실패',
      detail: `최근 ${Math.round(t.failBurstWindowSec / 60)}분 ${recentFailures}건 — 백엔드 배포·재시작 중일 수 있음(화면 숫자가 늦을 수 있다)`,
      sec: 0,
    });
  }

  // 심각 먼저, 같은 수준이면 오래된 것 먼저
  alerts.sort((a, b) => (a.level === b.level ? b.sec - a.sec : a.level === 'bad' ? -1 : 1));

  const counts = { done: 0, delivering: 0, searching: 0, dispatchFailed: 0, deliveryFailed: 0, closed: 0, delayed: 0, active: 0 };
  for (const r of rows) {
    counts[r.bucket]++;
    if (ACTIVE.has(r.bucket)) counts.active++;
    if (r.alert && ACTIVE.has(r.bucket)) counts.delayed++;
  }
  return {
    rows,
    alerts,
    counts,
    riders: {
      total: input.riders.length,
      busy: input.riders.filter((r) => r.deliveryId).length,
      stale,
      app: input.riders.filter((r) => r.external).length,
    },
    recentFailures,
  };
}

function min(sec: number): number {
  return Math.max(1, Math.floor(sec / 60));
}

/** 관제 거르기 — 숫자 칸·알림이 정하고 목록·지도가 따른다 */
export type OpsFilter = Exclude<Bucket, 'closed'> | 'active' | 'failed' | 'delayed' | 'failedCalls';

/** 거르기 이름(화면) */
export const FILTER_LABEL: Record<OpsFilter, string> = {
  active: '진행 중',
  searching: '라이더 찾는 중',
  delivering: '배송 중',
  delayed: '지연·이상',
  done: '전달 완료',
  failed: '실패',
  dispatchFailed: '배차 실패',
  deliveryFailed: '전달 실패',
  failedCalls: '요청 실패',
};

export function rowMatches(r: OpsRow, f: OpsFilter | null): boolean {
  if (!f || f === 'failedCalls') return true;
  if (f === 'delayed') return r.alert !== null && (r.bucket === 'searching' || r.bucket === 'delivering');
  if (f === 'active') return r.bucket === 'searching' || r.bucket === 'delivering';
  if (f === 'failed') return r.bucket === 'dispatchFailed' || r.bucket === 'deliveryFailed';
  return r.bucket === f;
}
