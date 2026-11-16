// 시나리오 조절 바(MOCK) — 실패 장면이 계약대로 흘러가는지.
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/config';
import { customerColor } from '../src/render/colors';
import { mockStartEpochMs } from '../src/sim/clock';
import { Simulation } from '../src/sim/simulation';
import { distanceM, offsetM } from '../src/util/geo';

const START = mockStartEpochMs(Date.UTC(2026, 10, 16, 3, 0, 0));
const MFC = DEFAULT_PARAMS.mfcLocation;

describe('시나리오 조절 바', () => {
  it('조절해도 기본 설정(DEFAULT_PARAMS)은 그대로 — 시뮬레이션마다 사본', () => {
    const before = JSON.stringify(DEFAULT_PARAMS);
    const sim = new Simulation({ ...DEFAULT_PARAMS }, { startEpochMs: START });
    sim.setKnobs({ ordersPerHour: 55, acceptProbability: 0.2, packTimeScale: 3, customerAbsentRate: 0.5, networkDropRate: 0.3 });
    expect(sim.getKnobs()).toEqual({ ordersPerHour: 55, acceptProbability: 0.2, packTimeScale: 3, customerAbsentRate: 0.5, networkDropRate: 0.3 });
    expect(JSON.stringify(DEFAULT_PARAMS)).toBe(before);
    sim.setKnobs({ acceptProbability: 7, networkDropRate: -1 }); // 범위 밖은 자름
    expect(sim.getKnobs()).toMatchObject({ acceptProbability: 1, networkDropRate: 0 });
  });

  it('주문량 0 이면 새 주문이 생기지 않는다', async () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS }, { startEpochMs: START });
    sim.setKnobs({ ordersPerHour: 0 });
    sim.startRiders(2);
    await sim.runFor(2 * 3600);
    expect(sim.deliveryCards()).toHaveLength(0);
    sim.setKnobs({ ordersPerHour: 60 });
    await sim.runFor(30 * 60);
    expect(sim.deliveryCards().length).toBeGreaterThan(5);
  }, 60_000);

  it('고객 부재: 연락 2번·사진 → 전달 실패 등록 → (MOCK 운영자) 확정 → 상품 들고 MFC 복귀 → 다음 주문', async () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS, acceptProbability: 1, customerAbsentRate: 1 }, { startEpochMs: START });
    sim.backend.autoOrders = false;
    const [rider] = sim.startRiders(1, () => offsetM(MFC, 300, 0));
    await sim.runFor(10);
    sim.backend.createOrder({ pickSec: 1, packMinutes: 3, packages: 1, customer: offsetM(MFC, 1200, 0) });
    await sim.runFor(40 * 60);
    const card = sim.deliveryCards()[0]!;
    expect(card).toMatchObject({ executionState: 'FAILED', dispatchState: 'CLOSED' });
    const del = [...sim.backend.deliveries.values()][0]!;
    expect(del.x.failure).toMatchObject({ reason: 'CUSTOMER_ABSENT', contactAttempts: 2, goodsLocation: 'WITH_RIDER' });
    expect(del.x.failure?.photoRefs.length).toBe(1);
    expect(sim.eventLog.some((e) => e.type === 'DeliveryFailed')).toBe(true);
    expect(sim.eventLog.some((e) => e.type === 'DeliveryCompleted')).toBe(false);
    expect(customerColor(card)).toBe('#e5484d');
    const m = sim.metrics();
    expect(m).toMatchObject({ completed: 0, deliveryFailed: 1 });
    expect(m.phases).toBeNull(); // 실패는 구간 평균에 넣지 않는다
    expect(rider!.phase).toBe('IDLE');
    expect(distanceM(rider!.pos, MFC)).toBeLessThan(400);
    expect(sim.trips[0]?.failedAt).toBeDefined();
    // 다음 주문을 받는다(부재 0 으로)
    sim.setKnobs({ customerAbsentRate: 0 });
    sim.backend.createOrder({ pickSec: 1, packMinutes: 3, packages: 1, customer: offsetM(MFC, 900, 0) });
    await sim.runFor(30 * 60);
    expect(sim.metrics().completed).toBe(1);
  }, 60_000);

  it('응답 끊김 25%: 같은 키 재전송으로 멈춤·중복 없이 이어진다', async () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS }, { startEpochMs: START });
    sim.setKnobs({ networkDropRate: 0.25 });
    const drops = { before: 0, after: 0 };
    sim.backend.onApiCall((r) => {
      if (r.code === 'NETWORK_DROP_BEFORE') drops.before++;
      if (r.code === 'NETWORK_DROP_AFTER') drops.after++;
    });
    sim.startRiders(5);
    await sim.runFor(2 * 3600);
    const m = sim.metrics();
    expect(drops.before).toBeGreaterThan(0);
    expect(drops.after).toBeGreaterThan(0);
    expect(m.responseLost).toBe(drops.before + drops.after);
    expect(m.completed).toBeGreaterThanOrEqual(10);
    expect(sim.riders.filter((r) => r.phase === 'STOPPED').map((r) => `${r.id}: ${r.note}`)).toEqual([]);
    const done = sim.trips.filter((t) => t.completedAt !== undefined).map((t) => t.deliveryId);
    expect(new Set(done).size).toBe(done.length);
    // 처리 뒤 끊긴 요청을 다시 보내면 같은 결과(IDEMPOTENT_REPLAY)가 돌아온다
    expect(sim.apiLog.some((r) => r.code === 'IDEMPOTENT_REPLAY') || drops.after > 0).toBe(true);
    expect(sim.deliveryCards().filter((c) => c.executionState === 'COMPLETED' && c.dispatchState !== 'CLOSED')).toEqual([]);
  }, 60_000);
});
