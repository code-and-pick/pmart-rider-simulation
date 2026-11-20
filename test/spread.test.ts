// 지도 — 같은 자리에 겹친 라이더를 화면에서 둥글게 벌려 그리기(실제 위치는 그대로).
import { describe, expect, it } from 'vitest';
import { spreadOffsets } from '../src/app/controller';

describe('겹친 라이더 벌리기', () => {
  it('가까운 라이더만 한 무리로 벌리고, 떨어진 라이더는 그대로', () => {
    const out = spreadOffsets([
      { id: 'b', p: { x: 100, y: 100 } },
      { id: 'a', p: { x: 104, y: 102 } },
      { id: 'c', p: { x: 300, y: 300 } },
      { id: 'd', p: null },
    ]);
    expect(out.has('c')).toBe(false);
    expect(out.has('d')).toBe(false);
    const a = out.get('a')!;
    const b = out.get('b')!;
    // 벌린 뒤 두 라이더 사이가 충분히 떨어진다
    const pa = { x: 104 + a.x, y: 102 + a.y };
    const pb = { x: 100 + b.x, y: 100 + b.y };
    expect(Math.hypot(pa.x - pb.x, pa.y - pb.y)).toBeGreaterThan(40);
  });

  it('자리는 ID 순이라 매번 같다', () => {
    const items = [
      { id: 'x', p: { x: 0, y: 0 } },
      { id: 'y', p: { x: 1, y: 1 } },
      { id: 'z', p: { x: 2, y: 0 } },
    ];
    expect(spreadOffsets(items)).toEqual(spreadOffsets([...items].reverse()));
  });
});

describe('많이 모인 라이더 — 묶음', () => {
  it('8명까지는 벌리고(반지름 120px 이하), 넘으면 벌리지 않고 묶음 하나', async () => {
    const { riderLayout, SPREAD_MAX } = await import('../src/app/controller');
    const at = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${String(i).padStart(2, '0')}`, p: { x: 500 + (i % 3), y: 500 } }));
    const few = riderLayout(at(SPREAD_MAX));
    expect(few.clusters).toEqual([]);
    expect([...few.offsets.values()].every((o) => Math.hypot(o.x, o.y) <= 125)).toBe(true);
    const many = riderLayout(at(50));
    expect(many.offsets.size).toBe(0);
    expect(many.clusters).toHaveLength(1);
    expect(many.clusters[0]).toHaveLength(50);
  });
});

describe('같은 자리 라이더 — 기본은 묶음, 펼친 무리만 벌림(사용자 2026-11-20 "위치가 너무 동떨어지게")', () => {
  it('isOpen 이 거짓이면 실제 자리에 묶음(벌리지 않음), 참인 무리만 벌림', async () => {
    const { riderLayout } = await import('../src/app/controller');
    const pts = [
      { id: 'a1', p: { x: 100, y: 100 } },
      { id: 'a2', p: { x: 104, y: 100 } },
      { id: 'b1', p: { x: 400, y: 400 } },
      { id: 'b2', p: { x: 402, y: 401 } },
      { id: 'solo', p: { x: 800, y: 800 } },
    ];
    const l = riderLayout(pts, (ids) => ids.includes('b1'));
    expect(l.groups).toEqual([
      ['a1', 'a2'],
      ['b1', 'b2'],
    ]);
    expect(l.clusters).toEqual([['a1', 'a2']]);
    expect([...l.offsets.keys()].sort()).toEqual(['b1', 'b2']);
    expect(l.offsets.has('solo')).toBe(false);
  });
});
