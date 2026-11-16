// 가상 라이더 상태기계가 MOCK 위에서 끝까지 도는지 — 화면 없이.
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, type SimParams } from '../src/config';
import { mockStartEpochMs } from '../src/sim/clock';
import { decideOffer } from '../src/sim/rider';
import { Simulation } from '../src/sim/simulation';
import { offsetM } from '../src/util/geo';

const START = mockStartEpochMs(Date.UTC(2026, 10, 16, 3, 0, 0));
const MFC = DEFAULT_PARAMS.mfcLocation;

function params(over: Partial<SimParams> = {}): SimParams {
  return { ...DEFAULT_PARAMS, ...over, mock: { ...DEFAULT_PARAMS.mock, ...(over.mock ?? {}) } };
}

describe('가상 라이더 (MOCK, 화면 없이)', () => {
  it('배차 요청 → 제안 → 수락 → MFC → QR 인계 → 고객 → 사진 → 완료 1건', async () => {
    const sim = new Simulation(params({ acceptProbability: 1 }), { startEpochMs: START });
    sim.backend.autoOrders = false;
    const [rider] = sim.startRiders(1, () => offsetM(MFC, 500, 0));
    await sim.runFor(10); // 준비(가입·운행 시작)
    expect(rider!.phase).toBe('IDLE');
    sim.backend.createOrder({ pickSec: 5, packMinutes: 4, packages: 2, customer: offsetM(MFC, 0, 1500) });
    await sim.runFor(30 * 60);

    const cards = sim.deliveryCards();
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ dispatchState: 'CLOSED', executionState: 'COMPLETED', riderId: 'RD-sim-01' });
    expect(sim.metrics().completed).toBe(1);
    expect(rider!.phase).toBe('IDLE');

    // 사건 순서(계약 이름 그대로)
    const types = sim.eventLog.map((e) => e.type);
    const order = ['DispatchRequested', 'DeliveryCreated', 'DispatchOfferSent', 'DeliveryAssigned', 'ShipmentReady', 'PackageHandedOver', 'PickupCompleted', 'DeliveryCompleted'];
    let last = -1;
    for (const t of order) {
      const i = types.indexOf(t as (typeof types)[number], last + 1);
      expect(i, `${t} 가 ${order[order.indexOf(t) - 1] ?? '처음'} 뒤에 있어야`).toBeGreaterThan(last);
      last = i;
    }
    // 5xx·응답 없음 없음, 업무 거절도 없음(정상 흐름)
    expect(sim.apiErrors).toBe(0);
    expect(sim.apiLog.filter((r) => typeof r.status === 'number' && r.status >= 400 && r.status !== 404)).toEqual([]);
    // API 로그에 개인정보가 들어가지 않는다(경로에 ID 만)
    expect(sim.apiLog.every((r) => !/MOCK 주소|01000000000/.test(JSON.stringify(r)))).toBe(true);
  });

  it('포장이 늦으면 가게에서 기다린다(픽업은 인계 확정 뒤에만)', async () => {
    const sim = new Simulation(params({ acceptProbability: 1 }), { startEpochMs: START });
    sim.backend.autoOrders = false;
    const [rider] = sim.startRiders(1, () => offsetM(MFC, 200, 0));
    await sim.runFor(10);
    sim.backend.createOrder({ pickSec: 1, packMinutes: 15, packages: 1, customer: offsetM(MFC, 800, 0) });
    await sim.runFor(5 * 60);
    expect(rider!.phase).toBe('AT_STORE_WAIT_READY');
    expect(sim.deliveryCards()[0]?.executionState).toBe('ARRIVED_AT_STORE');
    await sim.runFor(25 * 60);
    expect(sim.deliveryCards()[0]?.executionState).toBe('COMPLETED');
    expect(sim.metrics().storeWait).toBeGreaterThan(9 * 60);
  });

  it('2시간 운영: 라이더 5명이 주문을 나눠 끝내고 멈춘 라이더가 없다', async () => {
    const sim = new Simulation(params({ mock: { ...DEFAULT_PARAMS.mock, ordersPerHour: 12 } }), { startEpochMs: START });
    sim.startRiders(5);
    await sim.runFor(2 * 3600);
    const m = sim.metrics();
    expect(m.completed).toBeGreaterThanOrEqual(12);
    expect(m.apiErrors).toBe(0);
    expect(sim.riders.filter((r) => r.phase === 'STOPPED').map((r) => `${r.id}: ${r.note}`)).toEqual([]);
    // 같은 배송을 두 번 완료하지 않는다(동시 수락 1명)
    const completedIds = sim.trips.filter((t) => t.completedAt !== undefined).map((t) => t.deliveryId);
    expect(new Set(completedIds).size).toBe(completedIds.length);
  }, 60_000);

  it('제안 판단: 회수 배송(purpose ≠ DELIVERY)은 받지 않는다(§3-1)', () => {
    expect(decideOffer({ purpose: 'MISDELIVERY_RECOVERY', deliveryType: 'RETURN' }, 0, 1)).toEqual({ kind: 'REJECT', reason: 'OTHER' });
    expect(decideOffer({ purpose: 'DELIVERY', deliveryType: 'FORWARD' }, 0.1, 0.9)).toEqual({ kind: 'ACCEPT' });
    expect(decideOffer({ purpose: 'DELIVERY' }, 0.92, 0.9)).toEqual({ kind: 'REJECT', reason: 'TOO_FAR' });
    expect(decideOffer({ purpose: 'DELIVERY' }, 0.99, 0.9)).toEqual({ kind: 'IGNORE' });
  });
});
