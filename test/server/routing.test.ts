// 도로 경로(카카오모빌리티) — 개발 서버 쪽. fetch 를 가짜로(실제 카카오를 부르지 않음).
import { describe, expect, it } from 'vitest';
import { decideLanRequest } from '../../server/lanPolicy';
import { parsePoint, RouteService } from '../../server/routing';

const A = { lat: 35.1578, lng: 129.0597 };
const B = { lat: 35.1478, lng: 129.0697 };

/** 2026-11-16 실제 응답과 같은 모양(값은 줄임) */
const ok = () =>
  new Response(
    JSON.stringify({
      trans_id: 't',
      routes: [
        {
          result_code: 0,
          result_msg: '길찾기 성공',
          summary: { distance: 2400, duration: 975 },
          sections: [
            { roads: [{ vertexes: [129.0597, 35.1578, 129.0610, 35.1570] }, { vertexes: [129.0610, 35.1570, 129.0697, 35.1478] }] },
          ],
        },
      ],
    }),
    { status: 200 },
  );

function svc(reply: () => Response | Promise<Response>, opts: { key?: string | null; cap?: number; now?: () => number } = {}) {
  let calls = 0;
  let lastAuth = '';
  const fake = (async (_url: string, init: RequestInit) => {
    calls++;
    lastAuth = (init.headers as Record<string, string>).Authorization ?? '';
    return reply();
  }) as unknown as typeof fetch;
  const s = new RouteService(opts.key === undefined ? 'test-key' : opts.key, fake, opts.now, opts.cap);
  return { s, calls: () => calls, auth: () => lastAuth };
}

describe('RouteService (카카오모빌리티 GET /v1/directions)', () => {
  it('vertexes 를 [경도, 위도] 쌍으로 읽고 겹친 점은 하나로, KakaoAK 머리글', async () => {
    const { s, auth } = svc(ok);
    const r = await s.route(A, B);
    expect(r).toEqual({
      kind: 'ROAD',
      distanceM: 2400,
      durationSec: 975,
      points: [
        { lat: 35.1578, lng: 129.0597 },
        { lat: 35.157, lng: 129.061 },
        { lat: 35.1478, lng: 129.0697 },
      ],
    });
    expect(auth()).toBe('KakaoAK test-key');
  });

  it('같은 출발·도착(약 11m 안)은 저장해 둔 경로 — 다시 부르지 않는다', async () => {
    const { s, calls } = svc(ok);
    await s.route(A, B);
    await s.route({ lat: A.lat + 0.00002, lng: A.lng }, B);
    expect(calls()).toBe(1);
  });

  it('키 없음 → NO_KEY(부르지 않음), 경로 없음 → NO_ROUTE', async () => {
    const none = svc(ok, { key: null });
    expect(await none.s.route(A, B)).toEqual({ kind: 'NONE', reason: 'NO_KEY' });
    expect(none.calls()).toBe(0);
    const noRoute = svc(() => new Response(JSON.stringify({ routes: [{ result_code: 104 }] }), { status: 200 }));
    expect(await noRoute.s.route(A, B)).toEqual({ kind: 'NONE', reason: 'NO_ROUTE' });
  });

  it('카카오 일 사용량(400 code -10)·키 거절이면 그날은 더 부르지 않는다', async () => {
    const q = svc(() => new Response(JSON.stringify({ code: -10, msg: 'API limit has been exceeded' }), { status: 400 }));
    expect(await q.s.route(A, B)).toEqual({ kind: 'NONE', reason: 'QUOTA' });
    expect(await q.s.route(B, A)).toEqual({ kind: 'NONE', reason: 'QUOTA' });
    expect(q.calls()).toBe(1);
    const k = svc(() => new Response('{}', { status: 401 }));
    expect(await k.s.route(A, B)).toEqual({ kind: 'NONE', reason: 'KEY_REJECTED' });
  });

  it('하루 상한을 넘으면 DAILY_CAP, 다음 날(서울) 다시', async () => {
    let now = Date.UTC(2026, 10, 16, 3);
    const { s, calls } = svc(ok, { cap: 2, now: () => now });
    await s.route(A, B);
    await s.route(B, A);
    expect(await s.route(A, { lat: 35.16, lng: 129.05 })).toEqual({ kind: 'NONE', reason: 'DAILY_CAP' });
    expect(calls()).toBe(2);
    now += 24 * 3600_000;
    expect((await s.route(A, { lat: 35.16, lng: 129.05 })).kind).toBe('ROAD');
  });

  it('좌표 읽기 — 한국 둘레 밖·숫자 아님은 거절', () => {
    expect(parsePoint('35.1578,129.0597')).toEqual(A);
    for (const bad of [null, '', 'x,y', '0,0', '35.1', '91,129']) expect(parsePoint(bad), String(bad)).toBeNull();
  });

  it('/sim-route 는 이 PC 만(다른 기기 LOOPBACK_ONLY)', () => {
    expect(decideLanRequest('GET', '/sim-route?from=1,2&to=3,4', '192.168.0.55')).toMatchObject({ allow: false, code: 'LOOPBACK_ONLY' });
    expect(decideLanRequest('GET', '/sim-route?from=1,2&to=3,4', '127.0.0.1')).toMatchObject({ allow: true });
  });
});
