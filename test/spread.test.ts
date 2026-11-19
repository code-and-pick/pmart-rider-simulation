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
