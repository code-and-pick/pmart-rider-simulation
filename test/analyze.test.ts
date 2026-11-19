// 분석 화면 — 시간대 막대 틀(최근 2시간·하루·7일), 타임라인 겹침 줄 나누기.
import { describe, expect, it } from 'vitest';
import type { OpsRow } from '../src/ui/ops';
import { pack } from '../src/ui/AnalyzePage';
import { binCount, binLabel, binRange, dayStart, defaultView, frame, frameTitle, niceStep, shift } from '../src/ui/timeChart';

const r = (id: string) => ({ card: { deliveryId: id } }) as unknown as OpsRow;
// 2026-11-18 14:05 서울 = 05:05Z
const T = Date.UTC(2026, 10, 18, 5, 5);
const H = 3600_000;

describe('분석 시간대 막대', () => {
  it('하루 = 서울 0시부터 1시간 24칸, 글자 3칸마다', () => {
    const f = frame({ mode: 'day', anchor: T }, T + 2 * 86_400_000);
    expect(f.n).toBe(24);
    expect(f.from).toBe(Date.UTC(2026, 10, 17, 15, 0)); // 11/18 0시 서울
    expect(f.labelEvery).toBe(3);
    const bins = binCount([{ at: T, kind: 'done' as const }, { at: T + 10 * 60_000, kind: 'failed' as const }], f, ['done', 'failed'] as const);
    expect(bins[14]!.total).toBe(2);
    expect(bins[14]!.counts).toEqual({ done: 1, failed: 1 });
    expect(binLabel('day', bins[14]!.from)).toEqual(['14시']);
    expect(binRange('day', bins[14]!)).toBe('11/18 14:00 ~ 15:00');
    expect(frameTitle(f, T + 2 * 86_400_000)).toBe('11/18(수)');
  });

  it('최근 2시간 = 지금 칸까지 10분 12칸', () => {
    const f = frame({ mode: 'recent', anchor: 0 }, T);
    expect(f.n).toBe(12);
    expect(f.to).toBe(T + 5 * 60_000); // 14:10 서울
    expect(f.to - f.from).toBe(2 * H);
  });

  it('7일 = 그날까지 하루 7칸, 날짜·요일 두 줄', () => {
    const f = frame({ mode: 'week', anchor: T }, T);
    expect(f.n).toBe(7);
    expect(f.to).toBe(dayStart(T) + 86_400_000);
    expect(binLabel('week', dayStart(T))).toEqual(['11/18', '수']);
    expect(frameTitle(f, T)).toBe('11/12 ~ 11/18');
  });

  it('처음 틀 — 최근 2시간에 있으면 최근, 아니면 마지막 배송 날 하루', () => {
    expect(defaultView([T - 30 * 60_000], T).mode).toBe('recent');
    expect(defaultView([T - 30 * H], T)).toEqual({ mode: 'day', anchor: T - 30 * H });
    expect(defaultView([], T)).toEqual({ mode: 'day', anchor: T });
    expect(shift({ mode: 'day', anchor: T }, -1).anchor).toBe(T - 86_400_000);
    expect(shift({ mode: 'week', anchor: T }, 1).anchor).toBe(T + 7 * 86_400_000);
  });

  it('세로 눈금은 1·2·5 단위', () => {
    expect([0, 1, 4, 9, 13, 40].map(niceStep)).toEqual([1, 1, 2, 5, 10, 20]);
  });
});

describe('라이더 타임라인', () => {
  it('겹치는 막대는 아랫줄로, 이어지는 막대는 같은 줄, 최대 4줄', () => {
    const p = pack([
      { r: r('a'), s: 0, e: 10 },
      { r: r('b'), s: 10, e: 20 },
      { r: r('c'), s: 5, e: 15 },
    ]);
    expect(p.lines).toBe(2);
    expect(Object.fromEntries(p.placed.map((x) => [x.r.card.deliveryId, x.line]))).toEqual({ a: 0, c: 1, b: 0 });
    const many = pack(Array.from({ length: 6 }, (_, i) => ({ r: r(`x${i}`), s: 0, e: 10 })));
    expect(many.lines).toBe(4);
  });
});
