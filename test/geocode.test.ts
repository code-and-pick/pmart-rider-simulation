// 브라우저 쪽 주소 찾기(DevServerGeocoder) — 개발 서버 /sim-geocode 를 가짜 fetch 로.
import { describe, expect, it } from 'vitest';
import { DevServerGeocoder, mockLocator } from '../src/sim/geocode';

function fake(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  const seen: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    const r = handler(url, init);
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { f, seen };
}

describe('DevServerGeocoder', () => {
  it('상태를 읽기 전엔 준비 안 됨 → 준비됨이면 다시 배송을 받는다', async () => {
    const { f } = fake(() => ({ status: 200, body: { ready: true, reason: null } }));
    const g = new DevServerGeocoder(f);
    expect(g.ready).toBe(false);
    await g.refresh();
    expect(g.ready).toBe(true);
  });

  it('키 없음이면 준비 안 됨(이유 보존)', async () => {
    const g = new DevServerGeocoder(fake(() => ({ status: 200, body: { ready: false, reason: 'NO_KEY' } })).f);
    await g.refresh();
    expect(g).toMatchObject({ ready: false, reason: 'NO_KEY' });
  });

  it('주소는 POST 본문으로만(URL 에 안 들어감), 찾으면 좌표', async () => {
    const { f, seen } = fake(() => ({ status: 200, body: { kind: 'FOUND', lat: 35.1, lng: 129.1 } }));
    const g = new DevServerGeocoder(f);
    expect(await g.locate('부산 시험로 2')).toEqual({ lat: 35.1, lng: 129.1 });
    expect(seen[0]!.url).toBe('/sim-geocode');
    expect(seen[0]!.init?.method).toBe('POST');
    expect(JSON.parse(String(seen[0]!.init?.body))).toEqual({ address: '부산 시험로 2' });
  });

  it('못 찾음은 null(계속 준비됨), 키 거절·사용량 끝이면 null + 그날은 준비 안 됨', async () => {
    const g = new DevServerGeocoder(fake(() => ({ status: 200, body: { kind: 'NONE', reason: 'NOT_FOUND' } })).f);
    g.ready = true;
    expect(await g.locate('x 주소')).toBeNull();
    expect(g.ready).toBe(true);
    const h = new DevServerGeocoder(fake(() => ({ status: 200, body: { kind: 'NONE', reason: 'KEY_REJECTED' } })).f);
    h.ready = true;
    expect(await h.locate('x 주소')).toBeNull();
    expect(h).toMatchObject({ ready: false, reason: 'KEY_REJECTED' });
  });

  it('MOCK 주소록', async () => {
    const m = mockLocator((a) => (a === '집' ? { lat: 1, lng: 2 } : null));
    expect(m.ready).toBe(true);
    expect(await m.locate('집')).toEqual({ lat: 1, lng: 2 });
    expect(await m.locate('없음')).toBeNull();
  });
});
