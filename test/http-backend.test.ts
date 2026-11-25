// HttpBackend — 계약 경로·머리글·응답 규칙. fetch 를 가짜로 바꿔 화면·서버 없이 본다.
import { describe, expect, it } from 'vitest';
import { HttpBackend } from '../src/backend/http/HttpBackend';
import { ApiProblem, ResultUnknown } from '../src/domain/contract';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function backend(reply: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    const c: Call = { url, method: init.method ?? 'GET', headers: init.headers as Record<string, string>, body: init.body };
    calls.push(c);
    return reply(c);
  }) as unknown as typeof fetch;
  const b = new HttpBackend({ apiBase: '/api/v1', sourceSystem: 'rider-simulator', now: () => 0, fetch: fake });
  return { b, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' } });

describe('HttpBackend (실서버 어댑터)', () => {
  it('라이더 호출은 X-Sim-Rider 만 — 브라우저는 토큰을 보내지 않는다', async () => {
    const { b, calls } = backend(() => json(200, { items: [], pollAfterSec: 5 }));
    await b.asRider('RD-sim-03').listOffers({ size: 10 });
    expect(calls[0]?.url).toBe('/api/v1/offers?size=10');
    expect(calls[0]?.headers['X-Sim-Rider']).toBe('RD-sim-03');
    expect(Object.keys(calls[0]!.headers).map((k) => k.toLowerCase())).not.toContain('authorization');
  });

  it('관찰 조회는 X-Sim-Actor: observer', async () => {
    const { b, calls } = backend(() => json(200, { items: [] }));
    await b.observer.searchDeliveries({ mfcId: 'MFC-BJG-01', sort: 'NEWEST', size: 30 });
    expect(calls[0]?.url).toBe('/api/v1/deliveries?mfcId=MFC-BJG-01&sort=NEWEST&size=30');
    expect(calls[0]?.headers['X-Sim-Actor']).toBe('observer');
  });

  it('쓰기는 Idempotency-Key·X-Source-System·X-Expected-Version, 계약 경로 그대로', async () => {
    const { b, calls } = backend(() => json(200, { status: 'APPLIED', requestId: 'k1' }));
    await b.asRider('RD-sim-01').reportStoreArrival('DL 1', { note: 'x' }, { idempotencyKey: 'k1', expectedVersion: 4 });
    expect(calls[0]).toMatchObject({ url: '/api/v1/deliveries/DL%201/store-arrivals', method: 'POST' });
    expect(calls[0]?.headers).toMatchObject({ 'Idempotency-Key': 'k1', 'X-Source-System': 'rider-simulator', 'X-Expected-Version': '4' });
  });

  it('증빙 사진은 multipart file', async () => {
    const { b, calls } = backend(() => json(201, { photoRef: 'PH1', contentType: 'image/jpeg', sizeBytes: 3, uploadedAt: 'x' }));
    await b.asRider('RD-sim-01').uploadEvidencePhoto('DL1', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), { idempotencyKey: 'p' });
    expect(calls[0]?.body).toBeInstanceOf(FormData);
    expect((calls[0]?.body as FormData).get('file')).toBeInstanceOf(Blob);
  });

  it('4xx = ApiProblem(서버 확정 거절), 쓰기 5xx·응답 없음 = ResultUnknown(실패로 단정하지 않음)', async () => {
    const { b } = backend((c) =>
      c.url.includes('offers') ? json(409, { code: 'IDEMPOTENCY_CONFLICT', title: 't', status: 409 }) : json(503, { code: 'DEPENDENCY_UNAVAILABLE' }),
    );
    const r = b.asRider('RD-sim-01');
    await expect(r.respondToOffer('OF1', { response: 'ACCEPT' }, { idempotencyKey: 'a' })).rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT' });
    await expect(r.reportCompletion('DL1', { method: 'FACE', evidence: { photoRefs: ['p'], takenAt: 'x' } }, { idempotencyKey: 'b' })).rejects.toBeInstanceOf(
      ResultUnknown,
    );
    // GET 의 5xx 는 거절로 본다(다시 읽으면 된다)
    await expect(r.getExecution('DL1')).rejects.toBeInstanceOf(ApiProblem);
    const down = backend(() => Promise.reject(new TypeError('fetch failed')));
    await expect(down.b.asRider('RD-sim-01').getMe()).rejects.toBeInstanceOf(ResultUnknown);
  });

  it('API 로그에는 행위자·경로·상태 코드만', async () => {
    const { b } = backend(() => json(200, { deliveryId: 'DL1', roadAddress: '비밀 주소', receiverPhone: '01012345678', receiverName: 'x', detailAddress: 'y' }));
    const logs: unknown[] = [];
    b.onApiCall((r) => logs.push(r));
    await b.asRider('RD-sim-01').getDropInfo('DL1');
    expect(JSON.stringify(logs)).not.toMatch(/비밀 주소|01012345678/);
    expect(logs[0]).toMatchObject({ actor: 'RD-sim-01', method: 'GET', path: '/deliveries/DL1/drop-info', status: 200 });
  });

  it('시뮬레이터 라이더가 아니면 창구를 주지 않는다', () => {
    const { b } = backend(() => json(200, {}));
    expect(() => b.asRider('RD-0001')).toThrow();
  });
});
