// 라이더 이동 경로 — 화면 쪽 공급자와 경로 따라가기.
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/config';
import { mockStartEpochMs } from '../src/sim/clock';
import { DevServerRoutes, stitch, type RouteProvider } from '../src/sim/route';
import { Simulation } from '../src/sim/simulation';
import { distanceM, offsetM, type LatLng } from '../src/util/geo';

const MFC = DEFAULT_PARAMS.mfcLocation;
const START = mockStartEpochMs(Date.UTC(2026, 10, 16, 3, 0, 0));

describe('경로 공급자', () => {
  it('도로 경로 앞뒤를 지금 위치·정확한 목적지에 잇는다', () => {
    const from = MFC;
    const to = offsetM(MFC, 1000, 0);
    const road = [offsetM(MFC, 5, 5), offsetM(MFC, 500, 5), offsetM(MFC, 995, 5)];
    const p = stitch(from, road, to);
    expect(p[0]).toEqual(from);
    expect(p[p.length - 1]).toEqual(to);
    expect(p).toHaveLength(5);
  });

  it('개발 서버가 도로 경로를 못 주면 직선 + 이유', async () => {
    const fake = (async () => new Response(JSON.stringify({ kind: 'NONE', reason: 'QUOTA' }))) as unknown as typeof fetch;
    const r = await new DevServerRoutes(fake).route(MFC, offsetM(MFC, 100, 0));
    expect(r).toMatchObject({ kind: 'STRAIGHT', note: '카카오 사용량 소진' });
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await new DevServerRoutes(down).route(MFC, offsetM(MFC, 100, 0))).toMatchObject({ kind: 'STRAIGHT', note: '길찾기 응답 없음' });
  });
});

describe('가상 라이더가 도로 경로를 따라간다', () => {
  it('ㄱ자 경로면 모퉁이를 지나서 간다(직선으로 질러가지 않음)', async () => {
    // 출발 → 북쪽 600m 모퉁이 → 목적지(동쪽) 로 꺾는 가짜 도로
    const corners: LatLng[] = [];
    const lshape: RouteProvider = {
      async route(from, to) {
        const corner = { lat: to.lat + 0.0054, lng: from.lng }; // 약 600m 북쪽에서 꺾음
        corners.push(corner);
        return { kind: 'ROAD', points: [from, corner, to] };
      },
    };
    const sim = new Simulation({ ...DEFAULT_PARAMS, acceptProbability: 1 }, { startEpochMs: START, routes: lshape });
    sim.backend.autoOrders = false;
    const [rider] = sim.startRiders(1, () => offsetM(MFC, 300, 0));
    await sim.runFor(10);
    sim.backend.createOrder({ pickSec: 1, packMinutes: 3, packages: 1, customer: offsetM(MFC, 1500, 0) });
    let nearCorner = Infinity;
    let sawRoad = false;
    for (let t = 0; t < 40 * 60; t += 5) {
      await sim.runFor(5);
      if (rider!.pathKind === 'ROAD') sawRoad = true;
      for (const c of corners) nearCorner = Math.min(nearCorner, distanceM(rider!.pos, c));
      if (sim.deliveryCards()[0]?.executionState === 'COMPLETED') break;
    }
    expect(sim.deliveryCards()[0]?.executionState).toBe('COMPLETED');
    expect(sawRoad).toBe(true);
    expect(corners.length).toBeGreaterThanOrEqual(2); // MFC 로, 고객으로
    expect(nearCorner).toBeLessThan(60); // 모퉁이 근처를 지났다
  });
});
