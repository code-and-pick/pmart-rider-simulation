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

describe('라이더 관제(RR-08) — 라이더 앱 라이더 위치', () => {
  it('이 PC(관제 계정 있음)면 GET /rider-locations 를 X-Sim-Actor control 로, 라이더 앱 라이더를 지도에 — 시뮬레이터 라이더는 빼고', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      if (url.includes('/sim-auth/status')) return json(200, { riderSigning: true, observer: true, control: true });
      if (url.includes('/rider-locations'))
        return json(200, {
          asOf: '2026-11-18T03:30:00Z',
          items: [
            { riderId: 'RD-sim-01', stale: false, activeDeliveries: [], location: { lat: 1, lng: 1 } },
            {
              riderId: 'RD-5c41',
              nameMasked: '김*수',
              stale: false,
              staleSinceSeconds: 4,
              location: { lat: 35.16, lng: 129.06, quality: 'GOOD' },
              activeDeliveries: [{ deliveryId: 'DLV-1', stage: 'TO_STORE', pickedUp: false }],
            },
            { riderId: 'RD-noloc', stale: true, activeDeliveries: [], location: null },
          ],
        });
      if (url.includes('/mfc-pickup-points')) return json(200, { items: [{ centerId: 'MFC-SEED-01', name: 'x', coordinates: { lat: 35.1578, lng: 129.0597 } }] });
      if (url.includes('/deliveries')) return json(200, { items: [] });
      return json(404, {});
    }) as unknown as typeof fetch;
    const w = new RealWorld({ ...DEFAULT_PARAMS, mode: 'http' }, GATE, undefined, { fetch: fake });
    await flush();
    await w.advance(0);
    const call = calls.find((c) => c.url.includes('/rider-locations'));
    expect(call?.url).toContain('mfcId=MFC-SEED-01');
    expect(call?.headers).toMatchObject({ 'X-Sim-Actor': 'control' });
    const app = w.riders.filter((r) => !r.id.startsWith('RD-sim-'));
    expect(app.map((r) => r.id)).toEqual(['RD-5c41', 'RD-noloc']);
    expect(app[0]).toMatchObject({ pos: { lat: 35.16, lng: 129.06 }, deliveryId: 'DLV-1' });
    expect(app[0]!.note).toContain('MFC 로 가는 중');
    expect(app[1]!.pos).toBeNull();
    expect(w.diagnostics().some((d) => d.includes('라이더 앱 라이더 2명') && d.includes('위치 있음 1명'))).toBe(true);
  });

  it('다른 기기·관제 계정 없는 PC 는 부르지 않는다', async () => {
    for (const status of [json(403, { code: 'LOOPBACK_ONLY' }), json(200, { riderSigning: true, observer: true, control: false })]) {
      const urls: string[] = [];
      const fake = (async (url: string) => {
        urls.push(url);
        if (url.includes('/sim-auth/status')) return status.clone();
        if (url.includes('/deliveries')) return json(200, { items: [] });
        return json(404, {});
      }) as unknown as typeof fetch;
      const w = new RealWorld({ ...DEFAULT_PARAMS, mode: 'http' }, GATE, undefined, { fetch: fake });
      await flush();
      await w.advance(0);
      expect(urls.some((u) => u.includes('/rider-locations'))).toBe(false);
      expect(w.diagnostics().some((d) => d.startsWith('라이더 관제:'))).toBe(true);
    }
  });
});

describe('라이더 앱 라이더 표시', () => {
  it('번호는 짧게(앞 4자리), 시뮬레이터 라이더는 sim-NN', async () => {
    const { shortRiderId } = await import('../src/domain/riderId');
    expect(shortRiderId('RD-5c41a0e7-2ac3-4d85-9f03-fc4af8df85e9')).toBe('5c41');
    expect(shortRiderId('RD-sim-01')).toBe('sim-01');
    expect(shortRiderId('RD-claude-97fb21e37325')).toBe('claude-97fb21e37325');
  });

  it('관제 단계로 색(단계)을 정하고, 새 위치로는 10초 동안 미끄러지듯 옮긴다', async () => {
    let lat = 35.16;
    let stage = 'TO_STORE';
    const fake = (async (url: string) => {
      if (url.includes('/sim-auth/status')) return json(200, { riderSigning: true, observer: true, control: true });
      if (url.includes('/rider-locations'))
        return json(200, {
          asOf: 'x',
          items: [{ riderId: 'RD-5c41a0e7-2ac3-4d85-9f03-fc4af8df85e9', nameMasked: '김*수', stale: false, location: { lat, lng: 129.06 }, activeDeliveries: [{ deliveryId: 'D', stage, pickedUp: stage === 'TO_CUSTOMER' }] }],
        });
      if (url.includes('/deliveries')) return json(200, { items: [] });
      return json(404, {});
    }) as unknown as typeof fetch;
    const w = new RealWorld({ ...DEFAULT_PARAMS, mode: 'http' }, GATE, undefined, { fetch: fake });
    await flush();
    await w.advance(0);
    const app = () => w.riders.find((r) => r.external)!;
    expect(app()).toMatchObject({ label: '김*수 · 5c41', phase: 'TO_STORE', pos: { lat: 35.16, lng: 129.06 } });

    // 다음 관제 조회: 북쪽으로 약 111m, 고객에게 가는 중
    lat = 35.161;
    stage = 'TO_CUSTOMER';
    (w as unknown as { lastControlAt: number }).lastControlAt = -Infinity;
    (w as unknown as { lastPollAt: number }).lastPollAt = -Infinity;
    await w.advance(0);
    expect(app().phase).toBe('TO_CUSTOMER');
    const start = app().pos!.lat;
    expect(start).toBeCloseTo(35.16, 4); // 바로 튀지 않는다
    const p = app() as unknown as { glide(now: number, s: number): void; t0: number };
    p.glide(p.t0 + 5, 10);
    expect(app().pos!.lat).toBeCloseTo(35.1605, 4);
    p.glide(p.t0 + 20, 10);
    expect(app().pos!.lat).toBeCloseTo(35.161, 6); // 끝은 서버 값 그대로
  });
});

describe('직원용 전달지(주소·좌표) — 사용자 2026-11-18 "주소까지 보이게"', () => {
  const summary = { deliveryId: 'DLV-1', state: 'ASSIGNED', createdAt: '2026-11-18T08:00:00Z' };
  it('이 PC(관제 계정)는 X-Sim-Actor control 로 한 번만 읽어 주소·핀, 409 는 이유, 다른 기기는 부르지 않음', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    let mode: 'ok' | '409' = 'ok';
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      if (url.includes('/sim-auth/status')) return json(200, { riderSigning: true, observer: true, control: true });
      if (url.includes('/drop-location'))
        return mode === 'ok'
          ? json(200, { deliveryId: 'DLV-1', kind: 'DELIVERY_DROP', roadAddress: '부산 시험로 1', detailAddress: '101호', postalCode: '47000', lat: 35.16, lng: 129.06, coordinateSource: 'ORDER_PIN', piiAccessLogId: 'PII-1' })
          : json(409, { code: 'DROP_LOCATION_CLOSED' });
      if (url.endsWith('/dispatch')) return json(200, { state: 'ASSIGNED' });
      if (url.includes('/deliveries')) return json(200, { items: [summary] });
      return json(404, {});
    }) as unknown as typeof fetch;
    const w = new RealWorld({ ...DEFAULT_PARAMS, mode: 'http' }, GATE, undefined, { fetch: fake });
    await flush();
    await w.advance(0);
    expect(w.dropLocation('DLV-1')).toEqual({ state: 'loading' });
    await flush();
    const d = w.dropLocation('DLV-1');
    expect(d).toMatchObject({ state: 'ok', address: '부산 시험로 1 101호', postalCode: '47000', pos: { lat: 35.16, lng: 129.06 }, logId: 'PII-1' });
    w.dropLocation('DLV-1');
    const drops = calls.filter((c) => c.url.includes('/drop-location'));
    expect(drops).toHaveLength(1); // 열람 기록이 남으므로 한 번만
    expect(drops[0]!.headers).toMatchObject({ 'X-Sim-Actor': 'control' });
    expect(w.deliveryCards().find((c) => c.deliveryId === 'DLV-1')?.customer).toEqual({ lat: 35.16, lng: 129.06 });

    mode = '409';
    w.dropLocation('DLV-2');
    await flush();
    expect(w.dropLocation('DLV-2')).toMatchObject({ state: 'none' });
    expect((w.dropLocation('DLV-2') as { reason: string }).reason).toContain('배정 ~ 전달 전');
  });

  it('다른 기기·관제 계정 없는 PC 는 부르지 않는다', async () => {
    for (const status of [json(403, { code: 'LOOPBACK_ONLY' }), json(200, { riderSigning: true, observer: true, control: false })]) {
      const urls: string[] = [];
      const fake = (async (url: string) => {
        urls.push(url);
        if (url.includes('/sim-auth/status')) return status.clone();
        return json(200, { items: [] });
      }) as unknown as typeof fetch;
      const w = new RealWorld({ ...DEFAULT_PARAMS, mode: 'http' }, GATE, undefined, { fetch: fake });
      await flush();
      expect(w.dropLocation('DLV-1').state).toBe('none');
      await flush();
      expect(urls.some((u) => u.includes('/drop-location'))).toBe(false);
    }
  });
});

describe('오늘 운행시간(직원용 /rider-operating-time)', () => {
  it('이 PC 는 관제 계정으로 서울 날짜 하루를 읽고, 1분 안에는 다시 부르지 않는다', async () => {
    const urls: { url: string; headers: Record<string, string> }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      urls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      if (url.includes('/sim-auth/status')) return json(200, { riderSigning: true, observer: true, control: true });
      if (url.includes('/rider-operating-time')) return json(200, { from: 'x', to: 'x', totalSeconds: 3900, connectedSeconds: 7200, waitingSeconds: null, days: [] });
      return json(200, { items: [] });
    }) as unknown as typeof fetch;
    const w = new RealWorld({ ...DEFAULT_PARAMS, mode: 'http' }, GATE, undefined, { fetch: fake });
    await flush();
    await w.advance(0);
    expect(w.operatingTime('RD-1').state).toBe('loading');
    await flush();
    expect(w.operatingTime('RD-1')).toMatchObject({ state: 'ok', totalSec: 3900, connectedSec: 7200, waitingSec: null });
    const calls = urls.filter((u) => u.url.includes('/rider-operating-time'));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toMatch(/riderId=RD-1&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);
    expect(calls[0]!.headers).toMatchObject({ 'X-Sim-Actor': 'control' });
  });
});
