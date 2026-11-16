// 주소 → 좌표(개발 서버 /sim-geocode) — 카카오 주소 검색을 가짜 fetch 로. 실제 키·실제 호출 없음.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeocodeService, parseAddressBody } from '../../server/geocode';
import { decideLanRequest } from '../../server/lanPolicy';

const ADDR = '부산 부산진구 시험로 1';
const DAY0 = Date.UTC(2026, 10, 16, 3, 0, 0);

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; auth: string | null }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, auth: new Headers(init?.headers).get('authorization') });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

afterEach(() => vi.restoreAllMocks());

describe('GeocodeService', () => {
  it('키가 없으면 부르지 않고 NO_KEY, 준비 안 됨', async () => {
    const { f, calls } = fakeFetch(200, {});
    const g = new GeocodeService(null, f);
    expect(await g.geocode(ADDR)).toEqual({ kind: 'NONE', reason: 'NO_KEY' });
    expect(g.status()).toEqual({ ready: false, reason: 'NO_KEY' });
    expect(calls).toHaveLength(0);
  });

  it('찾음: 첫 결과의 x(경도)·y(위도), 주소는 쿼리에 인코딩, 키는 KakaoAK 머리에만', async () => {
    const { f, calls } = fakeFetch(200, { documents: [{ x: '129.0620', y: '35.1585' }] });
    const g = new GeocodeService('test-key', f, () => DAY0);
    expect(await g.geocode(ADDR)).toEqual({ kind: 'FOUND', lat: 35.1585, lng: 129.062 });
    expect(calls[0]!.url).toContain('https://dapi.kakao.com/v2/local/search/address.json?query=');
    expect(calls[0]!.url).toContain(encodeURIComponent(ADDR));
    expect(calls[0]!.url).not.toContain('test-key');
    expect(calls[0]!.auth).toBe('KakaoAK test-key');
  });

  it('결과 없음·한국 밖 좌표는 NOT_FOUND(그날도 계속 쓸 수 있음)', async () => {
    expect(await new GeocodeService('k', fakeFetch(200, { documents: [] }).f, () => DAY0).geocode(ADDR)).toEqual({ kind: 'NONE', reason: 'NOT_FOUND' });
    const far = new GeocodeService('k', fakeFetch(200, { documents: [{ x: '0', y: '0' }] }).f, () => DAY0);
    expect(await far.geocode(ADDR)).toEqual({ kind: 'NONE', reason: 'NOT_FOUND' });
    expect(far.status().ready).toBe(true);
  });

  it('키 거절(401·403 — 카카오맵 서비스 꺼짐 포함)·429 면 그날은 다시 부르지 않는다', async () => {
    for (const [status, reason] of [
      [401, 'KEY_REJECTED'],
      [403, 'KEY_REJECTED'],
      [429, 'QUOTA'],
    ] as const) {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { f, calls } = fakeFetch(status, { errorType: 'x' });
      let now = DAY0;
      const g = new GeocodeService('k', f, () => now);
      expect(await g.geocode(ADDR)).toEqual({ kind: 'NONE', reason });
      expect(await g.geocode(ADDR)).toEqual({ kind: 'NONE', reason });
      expect(calls).toHaveLength(1);
      expect(g.status()).toEqual({ ready: false, reason });
      now += 24 * 3600_000; // 다음 날(서울)엔 다시
      expect(g.status().ready).toBe(true);
    }
  });

  it('하루 상한을 넘으면 DAILY_CAP, 다음 날 풀림', async () => {
    const { f, calls } = fakeFetch(200, { documents: [{ x: '129', y: '35' }] });
    let now = DAY0;
    const g = new GeocodeService('k', f, () => now, 2);
    await g.geocode(ADDR);
    await g.geocode(ADDR);
    expect(await g.geocode(ADDR)).toEqual({ kind: 'NONE', reason: 'DAILY_CAP' });
    expect(g.status()).toEqual({ ready: false, reason: 'DAILY_CAP' });
    expect(calls).toHaveLength(2);
    now += 24 * 3600_000;
    expect((await g.geocode(ADDR)).kind).toBe('FOUND');
  });

  it('주소·좌표를 로그에 남기지 않는다', async () => {
    const out: string[] = [];
    for (const k of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, k).mockImplementation((...a: unknown[]) => void out.push(a.join(' ')));
    await new GeocodeService('k', fakeFetch(200, { documents: [{ x: '129.06', y: '35.15' }] }).f, () => DAY0).geocode(ADDR);
    await new GeocodeService('k', fakeFetch(401, {}).f, () => DAY0).geocode(ADDR);
    expect(out.join('\n')).not.toContain('시험로');
    expect(out.join('\n')).not.toContain('35.15');
  });
});

describe('/sim-geocode 요청', () => {
  it('본문은 {"address": 문자열} 2~200자만', () => {
    expect(parseAddressBody(JSON.stringify({ address: ' ' + ADDR + ' ' }))).toBe(ADDR);
    expect(parseAddressBody('{"address": 1}')).toBeNull();
    expect(parseAddressBody('{"address": "a"}')).toBeNull();
    expect(parseAddressBody(JSON.stringify({ address: 'x'.repeat(201) }))).toBeNull();
    expect(parseAddressBody('not json')).toBeNull();
  });

  it('이 PC 만 — 다른 기기는 찾기·상태 모두 LOOPBACK_ONLY', () => {
    for (const p of ['/sim-geocode', '/sim-geocode/status']) {
      expect(decideLanRequest('POST', p, '192.168.0.55')).toMatchObject({ allow: false, code: 'LOOPBACK_ONLY' });
      expect(decideLanRequest('GET', p, '192.168.0.55')).toMatchObject({ allow: false, code: 'LOOPBACK_ONLY' });
      expect(decideLanRequest('POST', p, '127.0.0.1')).toMatchObject({ allow: true });
    }
  });
});
