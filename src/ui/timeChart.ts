// 분석 "시간대별 배송" 막대의 칸 나누기 — 화면 없이 시험한다.
// 자료 폭에 맞춰 칸 크기를 바꾸면(예전) 볼 때마다 축이 달라지고 빈 칸·겹친 글자가 생긴다.
// 그래서 운영자가 실제로 묻는 세 질문에 고정된 틀을 쓴다(서울 시각):
//   최근 2시간 = 10분 칸 12개(지금 몰리는지) · 하루 = 1시간 칸 24개(몇 시가 바쁜지) · 7일 = 하루 칸 7개(요일·날짜 흐름).

export type ChartMode = 'recent' | 'day' | 'week';

export const KST = 9 * 3600_000;
const MIN = 60_000;
const HOUR = 3600_000;
const DAY = 86_400_000;
const RECENT_BIN = 10 * MIN; // [시뮬] 최근 2시간 칸
const RECENT_BINS = 12;

/** 서울 0시(ms) */
export function dayStart(ms: number): number {
  return Math.floor((ms + KST) / DAY) * DAY - KST;
}

/** 서울 날짜 "11/16" */
export function seoulDay(ms: number): string {
  const d = new Date(ms + KST);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/** 서울 요일 "수" */
export function weekday(ms: number): string {
  return '일월화수목금토'[new Date(ms + KST).getUTCDay()]!;
}

function hhmm(ms: number): string {
  const d = new Date(ms + KST);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export interface ChartView {
  mode: ChartMode;
  /** 하루·7일 = 보는 날(그날 아무 시각), 최근 = 무시(늘 지금) */
  anchor: number;
}

export interface Frame {
  mode: ChartMode;
  from: number;
  to: number;
  step: number;
  n: number;
  /** 아래 글자를 몇 칸마다(겹치지 않게 고정) */
  labelEvery: number;
}

export function frame(v: ChartView, nowMs: number): Frame {
  if (v.mode === 'recent') {
    const to = Math.floor((nowMs + KST) / RECENT_BIN) * RECENT_BIN - KST + RECENT_BIN;
    return { mode: 'recent', from: to - RECENT_BIN * RECENT_BINS, to, step: RECENT_BIN, n: RECENT_BINS, labelEvery: 3 };
  }
  if (v.mode === 'day') {
    const from = dayStart(v.anchor);
    return { mode: 'day', from, to: from + DAY, step: HOUR, n: 24, labelEvery: 3 };
  }
  const to = dayStart(v.anchor) + DAY;
  return { mode: 'week', from: to - 7 * DAY, to, step: DAY, n: 7, labelEvery: 1 };
}

export interface Bin<K extends string> {
  from: number;
  to: number;
  counts: Record<K, number>;
  total: number;
}

export function binCount<K extends string>(items: readonly { at: number; kind: K }[], f: Frame, kinds: readonly K[]): Bin<K>[] {
  const bins: Bin<K>[] = Array.from({ length: f.n }, (_, i) => ({
    from: f.from + i * f.step,
    to: f.from + (i + 1) * f.step,
    counts: Object.fromEntries(kinds.map((k) => [k, 0])) as Record<K, number>,
    total: 0,
  }));
  for (const it of items) {
    if (it.at < f.from || it.at >= f.to) continue;
    const b = bins[Math.floor((it.at - f.from) / f.step)]!;
    b.counts[it.kind]++;
    b.total++;
  }
  return bins;
}

/**
 * 처음 보는 틀 — 최근 2시간에 배송이 있으면 최근(MOCK·바쁜 시간), 아니면 마지막 배송이 있는 날의 하루.
 * (실서버에서 오늘 배송이 없을 때 빈 오늘을 보이지 않으려고.)
 */
export function defaultView(starts: readonly number[], nowMs: number): ChartView {
  if (starts.some((s) => s >= nowMs - RECENT_BIN * RECENT_BINS && s <= nowMs + RECENT_BIN)) return { mode: 'recent', anchor: nowMs };
  if (!starts.length) return { mode: 'day', anchor: nowMs };
  return { mode: 'day', anchor: Math.max(...starts) };
}

/** 앞뒤로 — 하루 ±1일, 7일 ±7일, 최근은 늘 지금 */
export function shift(v: ChartView, dir: -1 | 1): ChartView {
  if (v.mode === 'recent') return v;
  return { mode: v.mode, anchor: v.anchor + dir * (v.mode === 'day' ? 1 : 7) * DAY };
}

/** 칸 아래 글자 — 윗줄, (7일이면) 아랫줄 요일 */
export function binLabel(mode: ChartMode, ms: number): [string, string?] {
  if (mode === 'recent') return [hhmm(ms)];
  if (mode === 'day') return [`${new Date(ms + KST).getUTCHours()}시`];
  return [seoulDay(ms), weekday(ms)];
}

/** 칸 범위(툴팁) */
export function binRange(mode: ChartMode, b: { from: number; to: number }): string {
  if (mode === 'week') return `${seoulDay(b.from)}(${weekday(b.from)}) 하루`;
  const day = mode === 'day' ? `${seoulDay(b.from)} ` : '';
  return `${day}${hhmm(b.from)} ~ ${hhmm(b.to)}`;
}

/** 틀 제목 — "최근 2시간 09:00 ~ 11:00", "11/18(수)", "11/12 ~ 11/18" */
export function frameTitle(f: Frame, nowMs: number): string {
  if (f.mode === 'recent') return `${hhmm(f.from)} ~ ${hhmm(f.to)}`;
  if (f.mode === 'day') return `${seoulDay(f.from)}(${weekday(f.from)})${dayStart(nowMs) === f.from ? ' · 오늘' : ''}`;
  return `${seoulDay(f.from)} ~ ${seoulDay(f.to - DAY)}`;
}

/** 세로축 눈금 간격 — 1·2·5·10… 중 눈금이 2~3칸이 되게(0 · 5 · 9 같은 어색한 숫자 대신 0 · 5 · 10) */
export function niceStep(peak: number): number {
  const half = Math.max(1, peak / 2);
  for (let p = 1; ; p *= 10) for (const m of [1, 2, 5]) if (m * p >= half) return m * p;
}
