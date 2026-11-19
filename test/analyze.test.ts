// 분석 화면 — 시간대 칸 크기, 타임라인 겹침 줄 나누기.
import { describe, expect, it } from 'vitest';
import type { OpsRow } from '../src/ui/ops';
import { binMinutes, pack } from '../src/ui/AnalyzePage';

const r = (id: string) => ({ card: { deliveryId: id } }) as unknown as OpsRow;

describe('분석', () => {
  it('칸 크기 = 자료 폭에 맞춰 16칸 이하', () => {
    expect(binMinutes(40)).toBe(10);
    expect(binMinutes(200)).toBe(15);
    expect(binMinutes(400)).toBe(30);
    expect(binMinutes(900)).toBe(60);
    expect(binMinutes(24 * 60)).toBe(120);
  });

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
