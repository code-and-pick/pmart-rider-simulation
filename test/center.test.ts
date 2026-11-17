// MFC 위치 = center-master(실서버) — 배차 반경이 그 좌표 기준이라 시뮬레이터도 같아야 한다.
import { describe, expect, it } from 'vitest';
import { HttpBackend } from '../src/backend/http/HttpBackend';
import { DEFAULT_PARAMS } from '../src/config';
import { RealWorld } from '../src/sim/realWorld';

const GATE = { operationAllowed: true, signupAllowed: false, riderCount: 1 };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

describe('MFC 위치 — center-master', () => {
  it('HttpBackend 관찰 계정 GET /centers/{id}', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string> });
      return json(200, { centerId: 'MFC-SEED-01', coordinates: { lat: 1, lng: 2 } });
    }) as unknown as typeof fetch;
    const b = new HttpBackend({ apiBase: '/api/v1', sourceSystem: 'rider-simulator', now: () => 0, fetch: fake });
    await b.observer.getCenter('MFC-SEED-01');
    expect(calls[0]).toMatchObject({ url: '/api/v1/centers/MFC-SEED-01', headers: { 'X-Sim-Actor': 'observer' } });
  });

  it('센터 좌표를 쓰고, 인계 위치(HANDOVER_POINT)가 있으면 그것 — 읽기 전에는 운행을 막는다', async () => {
    let center: unknown = null;
    const fake = (async (url: string) => {
      if (url.includes('/centers/')) return center ? json(200, center) : json(503, { code: 'DEPENDENCY_UNAVAILABLE' });
      if (url.includes('/sim-auth/status')) return json(200, { riderSigning: true, observer: true });
      return json(404, {});
    }) as unknown as typeof fetch;
    const w = new RealWorld({ ...DEFAULT_PARAMS, mode: 'http' }, GATE, undefined, { fetch: fake });
    await flush();
    expect(w.operationLock).toContain('center-master');
    expect(w.mfcLocation).toEqual(DEFAULT_PARAMS.mfcLocation); // 읽기 전엔 설정값으로 지도만
    expect(w.diagnostics().some((d) => d.includes('못 읽음'))).toBe(true);

    center = {
      centerId: 'MFC-SEED-01',
      version: 3,
      name: '부산진구 MFC',
      coordinates: { lat: 35.1585, lng: 129.062 },
      accessPoints: [{ kind: 'HANDOVER_POINT', label: '라이더 인계', coordinates: { lat: 35.1586, lng: 129.0622 } }],
    };
    await w.loadCenter();
    expect(w.mfcLocation).toEqual({ lat: 35.1586, lng: 129.0622 });
    expect(w.operationLock).toBeNull();
    expect(w.diagnostics().some((d) => d.includes('인계 위치') && d.includes('35.15860'))).toBe(true);
  });

  it('운행(쓰기)은 서명키가 있는 그 PC 에서만 — 다른 기기·서명키 없는 PC 는 버튼을 막는다', async () => {
    const center = { centerId: 'MFC-SEED-01', coordinates: { lat: 35.1585, lng: 129.062 } };
    const make = (status: Response) =>
      (async (url: string) => (url.includes('/sim-auth/status') ? status.clone() : json(200, center))) as unknown as typeof fetch;
    const remote = new RealWorld({ ...DEFAULT_PARAMS, mode: 'http' }, GATE, undefined, { fetch: make(json(403, { code: 'LOOPBACK_ONLY' })) });
    await flush();
    await remote.loadCenter();
    expect(remote.operationLock).toContain('다른 기기');
    remote.startOperation();
    expect(remote.operating).toBe(false);
    const noKey = new RealWorld({ ...DEFAULT_PARAMS, mode: 'http' }, GATE, undefined, { fetch: make(json(200, { riderSigning: false, observer: true })) });
    await flush();
    await noKey.loadCenter();
    expect(noKey.operationLock).toContain('서명키');
  });

  it('라이더용 픽업지 목록(center-master 0.2.0)을 먼저 — 첫 시뮬레이터 라이더로, 인계 위치가 있으면 그것', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string> });
      if (url.endsWith('/mfc-pickup-points'))
        return json(200, {
          items: [
            { centerId: 'MFC-OTHER', name: '다른 지점', coordinates: { lat: 1, lng: 1 } },
            {
              centerId: 'MFC-SEED-01',
              name: '부산진구 MFC',
              coordinates: { lat: 35.1585, lng: 129.062 },
              handoverPoint: { label: '라이더 인계', coordinates: { lat: 35.1587, lng: 129.0623 } },
            },
          ],
        });
      return json(500, {});
    }) as unknown as typeof fetch;
    const w = new RealWorld({ ...DEFAULT_PARAMS, mode: 'http' }, GATE, undefined, { fetch: fake });
    await w.loadCenter();
    expect(w.mfcLocation).toEqual({ lat: 35.1587, lng: 129.0623 });
    expect(calls.find((c) => c.url.endsWith('/mfc-pickup-points'))?.headers).toMatchObject({ 'X-Sim-Rider': 'RD-sim-01' });
    expect(calls.some((c) => c.url.includes('/centers/'))).toBe(false);
    expect(w.diagnostics().some((d) => d.includes('라이더용 픽업지 목록') && d.includes('인계 위치'))).toBe(true);
  });

  it('픽업지 목록이 404(아직 배포 안 됨)거나 목록에 없으면 센터 조회로, 둘 다 못 읽으면 운행 막음', async () => {
    let list: Response = json(404, { title: 'Not Found' });
    let center: Response = json(200, { centerId: 'MFC-SEED-01', version: 2, coordinates: { lat: 35.1578, lng: 129.0597 } });
    const fake = (async (url: string) => {
      if (url.endsWith('/mfc-pickup-points')) return list.clone();
      if (url.includes('/centers/')) return center.clone();
      if (url.includes('/sim-auth/status')) return json(200, { riderSigning: true, observer: true });
      return json(404, {});
    }) as unknown as typeof fetch;
    const w = new RealWorld({ ...DEFAULT_PARAMS, mode: 'http' }, GATE, undefined, { fetch: fake });
    await flush();
    await w.loadCenter();
    expect(w.mfcLocation).toEqual({ lat: 35.1578, lng: 129.0597 });
    expect(w.diagnostics().some((d) => d.includes('센터 조회') && d.includes('픽업지 목록 못 읽음'))).toBe(true);

    list = json(200, { items: [{ centerId: 'MFC-OTHER', name: 'x', coordinates: { lat: 1, lng: 1 } }] });
    await w.loadCenter();
    expect(w.mfcLocation).toEqual({ lat: 35.1578, lng: 129.0597 });

    const w2 = new RealWorld({ ...DEFAULT_PARAMS, mode: 'http' }, GATE, undefined, { fetch: fake });
    list = json(404, {});
    center = json(503, { code: 'DEPENDENCY_UNAVAILABLE' });
    await flush();
    await w2.loadCenter();
    expect(w2.operationLock).toContain('center-master');
  });

  it('인계 위치가 없으면 센터 좌표', async () => {
    const fake = (async () =>
      json(200, { centerId: 'MFC-SEED-01', version: 2, coordinates: { lat: 35.1578, lng: 129.0597 }, accessPoints: null })) as unknown as typeof fetch;
    const w = new RealWorld({ ...DEFAULT_PARAMS, mode: 'http' }, GATE, undefined, { fetch: fake });
    await w.loadCenter();
    expect(w.mfcLocation).toEqual({ lat: 35.1578, lng: 129.0597 });
  });
});
