// 지점(1호점 부산·2호점 목포·3호점 세종) — MOCK 자리 방향은 목포만 바다 쪽(남·동남)을 뺀다
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

  it('세종은 3호점 — 센터 좌표·사방, 실서버 라이더 01·02 돌려 씀', () => {
    const sej = riderSite('MFC-SEJ-01');
    expect(sej.name).toBe('세종 MFC');
    expect(sej.mfcLocation).toEqual({ lat: 36.5017504, lng: 127.2573522 });
    expect(siteBearing(sej, 0.5)).toBe(180);
    expect(sej.realRiderIndexes).toEqual([0, 1]);
  });
});
