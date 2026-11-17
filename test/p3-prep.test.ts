// P3 준비(가입 없이): RR-01 조건 7, 가입 잠금, 탈퇴(계약 흉내), 실서버 운행 잠금.
import { describe, expect, it } from 'vitest';
import type { RiderApi } from '../src/backend/port';
import { DEFAULT_PARAMS, REAL_RIDER_GATE, simRiderPhone } from '../src/config';
import { ApiProblem, type RiderProfile } from '../src/domain/contract';
import { RiderRestrictedError, withAuthRecovery } from '../src/sim/authGuard';
import { mockStartEpochMs } from '../src/sim/clock';
import { RealWorld } from '../src/sim/realWorld';
import { Simulation } from '../src/sim/simulation';
import { offsetM } from '../src/util/geo';

const START = mockStartEpochMs(Date.UTC(2026, 10, 16, 3, 0, 0));
const MFC = DEFAULT_PARAMS.mfcLocation;
const p401 = () => new ApiProblem(401, { status: 401, code: 'UNAUTHENTICATED' });

/** 부를 때마다 차례로 답하는 가짜 라이더 창구(필요한 메서드만) */
function fakeApi(script: { getMe: (() => RiderProfile | ApiProblem)[]; getOperatingState: (() => unknown)[] }) {
  const calls: string[] = [];
  const next = <T>(name: keyof typeof script) => {
    calls.push(name);
    const f = script[name].shift();
    if (!f) throw new Error(`${name} 답 없음`);
    const v = f();
    return v instanceof ApiProblem ? Promise.reject(v) : Promise.resolve(v as T);
  };
  const api = { riderId: 'RD-sim-01', getMe: () => next('getMe'), getOperatingState: () => next('getOperatingState') } as unknown as RiderApi;
  return { api, calls };
}

describe('RR-01 조건 7 — 401 → 계정 제한 확인 → 정지면 멈춤', () => {
  it('제한 없으면 원래 호출을 한 번만 다시', async () => {
    const { api, calls } = fakeApi({
      getMe: [() => ({ restriction: { state: 'NORMAL' } })],
      getOperatingState: [() => p401(), () => ({ status: 'ON_DUTY' })],
    });
    await expect(withAuthRecovery(api).getOperatingState()).resolves.toEqual({ status: 'ON_DUTY' });
    expect(calls).toEqual(['getOperatingState', 'getMe', 'getOperatingState']);
  });

  it('정지·계약 종료면 RiderRestrictedError', async () => {
    for (const state of ['SUSPENDED', 'TERMINATED'] as const) {
      const { api } = fakeApi({ getMe: [() => ({ restriction: { state } })], getOperatingState: [() => p401()] });
      await expect(withAuthRecovery(api).getOperatingState()).rejects.toBeInstanceOf(RiderRestrictedError);
    }
  });

  it('다시 해도 401 이면 그대로 던진다(반복하지 않음), 401 아닌 오류는 손대지 않는다', async () => {
    const a = fakeApi({ getMe: [() => ({ restriction: { state: 'NORMAL' } })], getOperatingState: [() => p401(), () => p401()] });
    await expect(withAuthRecovery(a.api).getOperatingState()).rejects.toMatchObject({ status: 401 });
    expect(a.calls).toHaveLength(3);
    const b = fakeApi({ getMe: [], getOperatingState: [() => new ApiProblem(409, { code: 'INVALID_STATE' })] });
    await expect(withAuthRecovery(b.api).getOperatingState()).rejects.toMatchObject({ status: 409 });
    expect(b.calls).toEqual(['getOperatingState']);
  });
});

describe('가상 라이더 — 가입 잠금·정지 라이더', () => {
  it('가입이 허용되지 않으면 미가입 라이더는 가입하지 않고 멈춘다', async () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS }, { startEpochMs: START });
    sim.backend.autoOrders = false;
    const { VirtualRider } = await import('../src/sim/rider');
    const v = new VirtualRider(0, sim.backend.asRider('RD-sim-01'), sim.backend.observer, sim.clock, sim.params, MFC, MFC,
      { onTripDone: () => undefined, onNote: () => undefined }, { allowSignup: false });
    void v.run();
    await sim.runFor(2);
    expect(v.phase).toBe('STOPPED');
    expect(v.note).toContain('RR-02');
    expect(sim.backend.riders.get('RD-sim-01')?.signedUp ?? false).toBe(false);
    expect(sim.apiLog.filter((r) => r.method !== 'GET')).toEqual([]); // 쓰기 없음
  });

  it('이미 정지된 라이더는 운행을 켜지 않는다', async () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS }, { startEpochMs: START });
    sim.backend.autoOrders = false;
    const [r] = sim.startRiders(1, () => offsetM(MFC, 300, 0));
    await sim.runFor(5);
    expect(r!.phase).toBe('IDLE');
    // 운영자가 정지(MOCK 에서 직접)한 뒤 새 라이더 창으로 다시 준비
    sim.backend.riders.get('RD-sim-01')!.restriction = 'SUSPENDED';
    const { VirtualRider } = await import('../src/sim/rider');
    const again = new VirtualRider(0, sim.backend.asRider('RD-sim-01'), sim.backend.observer, sim.clock, sim.params, MFC, MFC, {
      onTripDone: () => undefined,
      onNote: () => undefined,
    });
    void again.run();
    await sim.runFor(2);
    expect(again.phase).toBe('STOPPED');
    expect(again.note).toContain('SUSPENDED');
  });
});

describe('탈퇴(rider-service 0.6.0 계약 흉내 — 백엔드 회신 RR-07)', () => {
  it('진행 중 배송·확정 전 수행료(완료 5시간 안)면 409 + blockers, 5시간 뒤 바로 완료(APPLIED·LOGOUT), 같은 ID 재가입은 RIDER_WITHDRAWN', async () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS, acceptProbability: 1 }, { startEpochMs: START });
    sim.backend.autoOrders = false;
    sim.startRiders(1, () => offsetM(MFC, 300, 0));
    await sim.runFor(5);
    const api = sim.backend.asRider('RD-sim-01');
    sim.backend.createOrder({ pickSec: 1, packMinutes: 20, packages: 1, customer: offsetM(MFC, 900, 0) });
    await sim.runFor(60);
    expect(sim.backend.activeDeliveryCount('RD-sim-01')).toBe(1);
    await expect(api.withdraw({}, { idempotencyKey: 'w1' })).rejects.toMatchObject({ status: 409, code: 'INVALID_STATE' });
    expect(sim.backend.withdrawalBlockers('RD-sim-01')).toContain('ACTIVE_DELIVERY');
    expect(await api.getWithdrawal('w1')).toMatchObject({ state: 'REJECTED', blockers: ['ACTIVE_DELIVERY'] });
    await sim.runFor(40 * 60); // 배송을 끝낸다
    expect(sim.backend.activeDeliveryCount('RD-sim-01')).toBe(0);
    sim.riders[0]!.done = true;
    // 완료 5시간 안 — 확정 전 수행료가 막는다
    await expect(api.withdraw({}, { idempotencyKey: 'w1b' })).rejects.toMatchObject({ status: 409, problem: { details: [{ field: 'blockers', reason: 'UNCONFIRMED_EARNING' }] } });
    await sim.runFor(5 * 3600);
    expect(sim.backend.withdrawalBlockers('RD-sim-01')).toEqual([]);
    const res = await api.withdraw({ reason: '시험 정리' }, { idempotencyKey: 'w2' });
    expect(res).toMatchObject({ status: 'APPLIED', nextAction: 'LOGOUT' });
    expect(await api.getWithdrawal('w2')).toMatchObject({ state: 'COMPLETED' });
    await expect(api.getMe()).rejects.toMatchObject({ status: 404 });
    await expect(
      api.signup({ phone: '01099990001', vehicleType: 'MOTORCYCLE', deliveryAreas: [{ mfcId: 'MFC-SEED-01' }], consents: [] }, { idempotencyKey: 's' }),
    ).rejects.toMatchObject({ status: 409, code: 'RIDER_WITHDRAWN' });
    // 전화번호는 지워졌다 — 같은 전화로 새 ID 는 가입된다
    await expect(
      sim.backend.asRider('RD-sim-09').signup({ phone: '01000000001', vehicleType: 'MOTORCYCLE', deliveryAreas: [{ mfcId: 'MFC-SEED-01' }], consents: [] }, { idempotencyKey: 's9' }),
    ).resolves.toMatchObject({ riderId: 'RD-sim-09' });
  });
});

describe('탈퇴 — 산정 불가 조정 대기(EARNING_ADJUSTMENT_PENDING)', () => {
  it('고객 사유가 아닌 전달 실패 확정은 막고, 고객 사유(부재 등)는 막지 않는다', async () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS, acceptProbability: 1 }, { startEpochMs: START });
    sim.backend.autoOrders = false;
    sim.startRiders(1, () => offsetM(MFC, 300, 0));
    await sim.runFor(5);
    sim.backend.createOrder({ pickSec: 1, packMinutes: 20, packages: 1, customer: offsetM(MFC, 900, 0) });
    await sim.runFor(60);
    const del = [...sim.backend.deliveries.values()][0]!;
    // 흐름 생략 — 확정된 실패 상태만 만든다(목 내부 상태)
    del.x.riderId = 'RD-sim-01';
    del.x.state = 'FAILED';
    del.x.helps = [];
    del.x.failure = { reason: 'GOODS_DAMAGED', photoRefs: [], contactAttempts: 0, reportedAt: sim.clock.iso() };
    expect(sim.backend.withdrawalBlockers('RD-sim-01')).toContain('EARNING_ADJUSTMENT_PENDING');
    del.x.failure = { reason: 'CUSTOMER_ABSENT', photoRefs: [], contactAttempts: 2, reportedAt: sim.clock.iso() };
    expect(sim.backend.withdrawalBlockers('RD-sim-01')).not.toContain('EARNING_ADJUSTMENT_PENDING');
  });
});
describe('실서버 운행 잠금(REAL_RIDER_GATE)', () => {
  it('사용자 결정(2026-11-16 "시험 번호로 시작") — 2명, 시험 번호 010-0000-00NN', () => {
    expect(REAL_RIDER_GATE).toEqual({ operationAllowed: true, signupAllowed: true, riderCount: 2 });
    expect(new RealWorld({ ...DEFAULT_PARAMS, mode: 'http' }).riders.map((r) => r.id)).toEqual(['RD-sim-01', 'RD-sim-02']);
    expect(simRiderPhone(0)).toBe('01000000001');
    expect(simRiderPhone(1)).toBe('01000000002');
    expect(/^01[0-9]{8,9}$/.test(simRiderPhone(19))).toBe(true);
  });

  it('잠겨 있으면 운행을 시작하지 않는다 — 라이더는 읽기 전용으로 남는다', () => {
    const w = new RealWorld({ ...DEFAULT_PARAMS, mode: 'http' }, { operationAllowed: false, signupAllowed: false, riderCount: 2 });
    expect(w.operationLock).toContain('잠김');
    w.startOperation();
    expect(w.operating).toBe(false);
    expect(w.riders.every((r) => r.phase === 'REMOTE')).toBe(true);
  });
});

describe('운행 종료 — OFF_DUTY', () => {
  it('대기 중이면 곧 OFF_DUTY, 배송 중이면 끝낸 뒤 OFF_DUTY', async () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS, acceptProbability: 1 }, { startEpochMs: START });
    sim.backend.autoOrders = false;
    const [a, b] = sim.startRiders(2, (i) => offsetM(MFC, i === 0 ? 200 : 2500, 0));
    await sim.runFor(10);
    sim.backend.createOrder({ pickSec: 1, packMinutes: 3, packages: 1, customer: offsetM(MFC, 800, 0) });
    await sim.runFor(60);
    expect(a!.deliveryId).not.toBeNull(); // 가까운 a 가 받음
    a!.requestStop();
    b!.requestStop();
    await sim.runFor(20);
    expect(b!.phase).toBe('STOPPED');
    expect(sim.backend.riders.get(b!.id)?.operating.status).toBe('OFF_DUTY');
    expect(sim.backend.riders.get(a!.id)?.operating.status).toBe('ON_DUTY'); // 아직 배송 중
    await sim.runFor(30 * 60);
    expect(sim.deliveryCards()[0]?.executionState).toBe('COMPLETED');
    expect(a!.phase).toBe('STOPPED');
    expect(sim.backend.riders.get(a!.id)?.operating.status).toBe('OFF_DUTY');
  });
});
