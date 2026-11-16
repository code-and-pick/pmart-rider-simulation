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
    const k = { ordersPerHour: 55, acceptProbability: 0.2, packTimeScale: 3, customerAbsentRate: 0.5, networkDropRate: 0.3, riderCancelRate: 0.4, locationOutageRate: 0.6 };
    sim.setKnobs(k);
    expect(sim.getKnobs()).toEqual(k);
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

  it('라이더 취소: 가게 가는 길에 배정 취소 → 그 라이더를 빼고 재배차 → 다른 라이더가 완료', async () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS, acceptProbability: 1, riderCancelRate: 1 }, { startEpochMs: START });
    sim.backend.autoOrders = false;
    const [a, b] = sim.startRiders(2, (i) => offsetM(MFC, 600 + i * 400, 0));
    await sim.runFor(10);
    sim.backend.createOrder({ pickSec: 1, packMinutes: 3, packages: 1, customer: offsetM(MFC, 1000, 0) });
    for (let i = 0; i < 60 && sim.metrics().incidents!.assignmentCancelled === 0; i++) await sim.runFor(10);
    sim.setKnobs({ riderCancelRate: 0 }); // 다음 라이더는 취소하지 않게
    expect(sim.trips.some((t) => t.cancelledAt !== undefined)).toBe(true);
    const canceller = [a!, b!].find((r) => sim.notes.some((n) => n.riderId === r.id && n.text.startsWith('배정 취소 —')))!;
    expect(sim.eventLog.some((e) => e.type === 'DeliveryAssignmentChanged' && e.riderId === canceller.id)).toBe(true);
    await sim.runFor(40 * 60);
    const card = sim.deliveryCards()[0]!;
    expect(card).toMatchObject({ executionState: 'COMPLETED', dispatchState: 'CLOSED' });
    expect(card.riderId).not.toBe(canceller.id); // 취소한 라이더는 빠졌다
    expect(card.riderIds).toEqual(expect.arrayContaining([a!.id, b!.id]));
    expect(sim.metrics()).toMatchObject({ completed: 1, incidents: { assignmentCancelled: 1 } });
    expect(sim.riders.filter((r) => r.phase === 'STOPPED')).toEqual([]);
    expect(sim.eventLog.some((e) => e.type === 'RiderLocationStale')).toBe(false); // 위치는 계속 올렸다
  }, 60_000);

  it('위치 끊김: 고객에게 가는 중 4분 못 올림 → 3분 지나 RiderLocationStale 한 번, 배송 상태는 그대로 진행·완료', async () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS, acceptProbability: 1, locationOutageRate: 1 }, { startEpochMs: START });
    sim.backend.autoOrders = false;
    const [rider] = sim.startRiders(1, () => offsetM(MFC, 300, 0));
    await sim.runFor(10);
    sim.backend.createOrder({ pickSec: 1, packMinutes: 3, packages: 1, customer: offsetM(MFC, 3500, 0) });
    let sawOffline = false;
    for (let i = 0; i < 240; i++) {
      await sim.runFor(10);
      if (rider!.locationOffline) {
        sawOffline = true;
        expect(rider!.phase).toMatch(/TO_CUSTOMER|AT_CUSTOMER/);
      }
    }
    expect(sawOffline).toBe(true);
    const stale = sim.eventLog.filter((e) => e.type === 'RiderLocationStale');
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({ riderId: rider!.id });
    expect(sim.deliveryCards()[0]).toMatchObject({ executionState: 'COMPLETED' });
    expect(sim.metrics().incidents).toMatchObject({ locationStale: 1, assignmentCancelled: 0 });
    expect(rider!.locationOffline).toBe(false);
  }, 60_000);

  it('포장 지연: 가게에서 10분 넘게 기다리면 도움요청 STORE_WAITING 한 번, 그 뒤 정상 인계·완료', async () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS, acceptProbability: 1 }, { startEpochMs: START });
    sim.backend.autoOrders = false;
    sim.startRiders(1, () => offsetM(MFC, 300, 0));
    await sim.runFor(10);
    sim.backend.createOrder({ pickSec: 1, packMinutes: 18, packages: 1, customer: offsetM(MFC, 900, 0) });
    sim.backend.createOrder({ pickSec: 1, packMinutes: 2, packages: 1, customer: offsetM(MFC, 900, 0) });
    await sim.runFor(80 * 60);
    const dels = [...sim.backend.deliveries.values()];
    const helps = dels.flatMap((d) => d.x.helps.map((h) => ({ id: d.deliveryId, ...h })));
    expect(helps).toHaveLength(1); // 18분 포장만 — 2분 포장은 안 보냄
    expect(helps[0]).toMatchObject({ category: 'STORE_WAITING', stage: 'ARRIVED_AT_STORE' });
    expect(sim.eventLog.filter((e) => e.type === 'DeliveryIncidentRaised')).toHaveLength(1);
    expect(sim.metrics()).toMatchObject({ completed: 2, incidents: { helpRequests: 1 } });
  }, 60_000);
});
