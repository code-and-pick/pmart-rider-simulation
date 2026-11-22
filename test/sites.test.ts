// 지점(1호점 부산·2호점 목포) — MOCK 자리 방향은 목포만 바다 쪽(남·동남)을 뺀다
import { describe, expect, it } from 'vitest';
import { riderSite, siteBearing } from '../src/config';

describe('지점 MOCK 방향', () => {
  it('부산은 사방, 목포는 260°→북→80° 안', () => {
    const busan = riderSite('MFC-SEED-01');
    expect(siteBearing(busan, 0.5)).toBe(180);
    const mokpo = riderSite('MFC-MOKPO-01');
    for (let r = 0; r <= 1; r += 0.05) {
      const b = siteBearing(mokpo, r);
      expect(b >= 260 || b <= 80).toBe(true);
    }
    expect(siteBearing(mokpo, 0)).toBe(260);
    expect(siteBearing(mokpo, 1)).toBe(80);
  });
});
