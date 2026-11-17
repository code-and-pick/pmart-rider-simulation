// 운영 화면 탭 — 라이더 백오피스로 가는 길(화면은 백오피스에, 시뮬레이터는 목록만 — 사용자 2026-11-17).
import { describe, expect, it } from 'vitest';
import { OPS_SCREENS, opsUrl } from '../src/ui/opsLinks';

describe('운영 화면 목록', () => {
  it('MOCK 은 백오피스 목 모드(5176), 실서버는 LAN 8446 — 만든 화면만 주소, 나머지는 준비 중', () => {
    const byKey = (k: string) => OPS_SCREENS.find((s) => s.key === k)!;
    expect(opsUrl('mock', byKey('cases'))).toBe('http://localhost:5176/cases');
    expect(opsUrl('http', byKey('deliveries'))).toBe('https://192.168.0.40:8446/deliveries');
    expect(opsUrl('http', byKey('control'))).toBeNull();
    expect(OPS_SCREENS.filter((s) => s.path !== null).map((s) => s.key)).toEqual(['cases', 'deliveries']);
  });
});