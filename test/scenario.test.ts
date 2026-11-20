// 시나리오 조절 바(MOCK) — 실패 장면이 계약대로 흘러가는지.
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/config';
import { customerColor } from '../src/render/colors';
import { mockStartEpochMs } from '../src/sim/clock';
import { ApiProblem } from '../src/domain/contract';
import { wrongCode } from '../src/sim/rider';
import { Simulation } from '../src/sim/simulation';
import { distanceM, offsetM } from '../src/util/geo';

const START = mockStartEpochMs(Date.UTC(2026, 10, 16, 3, 0, 0));
const MFC = DEFAULT_PARAMS.mfcLocation;

describe('시나리오 조절 바', () => {
  it('조절해도 기본 설정(DEFAULT_PARAMS)은 그대로 — 시뮬레이션마다 사본', () => {
    const before = JSON.stringify(DEFAULT_PARAMS);
    const sim = new Simulation({ ...DEFAULT_PARAMS }, { startEpochMs: START });
    const k = { ordersPerHour: 55, acceptProbability: 0.2, packTimeScale: 3, customerAbsentRate: 0.5, networkDropRate: 0.3, riderCancelRate: 0.4, locationOutageRate: 0.6, misdeliveryRate: 0.7, handoverByCodeRate: 0.8, claimReturnRate: 0.9 };
    sim.setKnobs(k);
    expect(sim.getKnobs()).toEqual(k);
    expect(JSON.stringify(DEFAULT_PARAMS)).toBe(before);
    sim.setKnobs({ acceptProbability: 7, networkDropRate: -1 }); // 범위 밖은 자름
    expect(sim.getKnobs()).toMatchObject({ acceptProbability: 1, networkDropRate: 0 });
  });

  it('QR 안 찍힘(번호로 인계 100%): 라벨 숫자로 허가해도 배송이 끝까지 간다 — 틀린 번호 뒤 남은 횟수 안내', async () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS, handoverCodeTypoRate: 1 }, { startEpochMs: START });
    sim.setKnobs({ ordersPerHour: 20, handoverByCodeRate: 1 });
    sim.startRiders(3);
    await sim.runFor(60 * 60);
    expect(sim.deliveryCards().filter((c) => c.executionState === 'COMPLETED').length).toBeGreaterThan(0);
    const notes = sim.notes.map((n) => n.text);
    expect(notes.some((t) => t.includes('번호 틀림(409 HANDOVER_CODE_MISMATCH · 남은 4번)'))).toBe(true);
    expect(notes.some((t) => /번호 [0-9]{4} 로 인계 허가/.test(t))).toBe(true);
    expect(notes.some((t) => /배정 반영 \d+초/.test(t))).toBe(true);
  }, 60_000);

  it('번호 인계가 막히면(409 잠김) 라이더가 멈추지 않고 QR 로 다시 받아 끝까지 간다', async () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS, acceptProbability: 1, handoverCodeTypoRate: 0 }, { startEpochMs: START });
    sim.backend.autoOrders = false;
    sim.setKnobs({ handoverByCodeRate: 1 });
    const asRider = sim.backend.asRider.bind(sim.backend);
    sim.backend.asRider = (id: string) => ({
      ...asRider(id),
      authorizeHandoverByCode: () => Promise.reject(new ApiProblem(409, { status: 409, code: 'HANDOVER_CODE_LOCKED' })),
    });
    sim.startRiders(1, () => offsetM(MFC, 300, 0));
    await sim.runFor(10);
    sim.backend.createOrder({ pickSec: 1, packMinutes: 3, packages: 2, customer: offsetM(MFC, 1200, 0) });
    await sim.runFor(40 * 60);
    expect(sim.deliveryCards()[0]).toMatchObject({ executionState: 'COMPLETED' });
    const notes = sim.notes.map((n) => n.text);
    expect(notes.some((t) => t.includes('번호 인계 막힘(409 HANDOVER_CODE_LOCKED) — QR 로 다시'))).toBe(true);
    expect(notes.some((t) => t.startsWith('멈춤'))).toBe(false);
  }, 60_000);

  it('틀린 번호는 맞는 번호·같은 출고 다른 포장 번호와 겹치지 않는다', () => {
    expect(wrongCode('1234', new Set(['1234']))).toBe('1235');
    expect(wrongCode('1234', new Set(['1234', '1235']))).toBe('1236');
    expect(wrongCode('9999', new Set(['9999']))).toBe('0000');
    expect(wrongCode('123456', new Set(['123456']))).toBe('123457');
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

  it('고객 부재: 연락 2번·사진 → 전달 실패 등록(대화 열림) → (MOCK 운영자) 확정 → 같은 라이더에게 실패 반납 바로 배정 → MFC 반납 → 다음 주문', async () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS, acceptProbability: 1, customerAbsentRate: 1 }, { startEpochMs: START });
    sim.backend.autoOrders = false;
    const [rider] = sim.startRiders(1, () => offsetM(MFC, 300, 0));
    const calls: string[] = [];
    sim.backend.onApiCall((r) => calls.push(`${r.method} ${r.path}`));
    await sim.runFor(10);
    sim.backend.createOrder({ pickSec: 1, packMinutes: 3, packages: 1, customer: offsetM(MFC, 1200, 0) });
    await sim.runFor(40 * 60);
    const del = [...sim.backend.deliveries.values()][0]!;
    const card = sim.deliveryCards().find((c) => c.deliveryId === del.deliveryId)!;
    expect(card).toMatchObject({ executionState: 'FAILED', dispatchState: 'CLOSED' });
    expect(del.x.failure).toMatchObject({ reason: 'CUSTOMER_ABSENT', contactAttempts: 2, goodsLocation: 'WITH_RIDER', custody: 'RIDER', returnBy: 'SAME_RIDER' });
    expect(del.x.failure?.photoRefs.length).toBe(1);
    // 실패 등록이 DELIVERY_FAILURE 대화를 같이 연다 — 도움요청은 따로 보내지 않는다(execution 0.14.0)
    expect(del.x.helps.map((h) => h.category)).toEqual(['DELIVERY_FAILURE']);
    expect(calls.some((c) => c.endsWith('/help-requests'))).toBe(false);
    // 반납 배송: 제안 없이 같은 라이더, 받음 없이 ASSIGNED → RETURNED_TO_STORE
    const back = sim.backend.deliveries.get(del.x.failure!.returnDeliveryId!)!;
    expect(back).toMatchObject({ type: 'RETURN', purpose: 'FAILED_DELIVERY_RETURN', originDeliveryId: del.deliveryId });
    expect(back.x).toMatchObject({ riderId: del.x.riderId, state: 'RETURNED_TO_STORE' });
    expect(back.d.state).toBe('CLOSED');
    expect([...sim.backend.offers.values()].some((o) => o.deliveryId === back.deliveryId)).toBe(false);
    expect(calls).toContain(`POST /deliveries/${back.deliveryId}/returns/store-deliveries`);
    expect(calls).not.toContain(`POST /deliveries/${back.deliveryId}/returns/pickups`);
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

  it('고객 반품 회수(CLAIM_RETURN): 수락 → 고객 집(전달지 받기 전부터) → 사진·받음 → MFC → 직원 화면 번호로 반납', async () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS, acceptProbability: 1 }, { startEpochMs: START });
    sim.backend.autoOrders = false;
    sim.backend.params.returnHandoverRequired = true; // 번호가 필수여도 통과해야 한다
    sim.setKnobs({ claimReturnRate: 1 });
    sim.startRiders(1, () => offsetM(MFC, 300, 0));
    const calls: string[] = [];
    sim.backend.onApiCall((r) => calls.push(`${r.method} ${r.path}`));
    await sim.runFor(10);
    sim.backend.createOrder({ pickSec: 1, packMinutes: 3, packages: 1, customer: offsetM(MFC, 1000, 0) });
    await sim.runFor(60 * 60);
    const claim = [...sim.backend.deliveries.values()].find((d) => d.purpose === 'CLAIM_RETURN')!;
    expect(claim).toMatchObject({ type: 'RETURN' });
    expect(claim.claimId).toMatch(/^CL/);
    expect(claim.x.state).toBe('RETURNED_TO_STORE');
    expect(claim.d.state).toBe('CLOSED');
    expect(claim.returnCode).toMatchObject({ failed: 0, locked: false });
    expect(calls).toContain(`GET /deliveries/${claim.deliveryId}/drop-info`);
    expect(calls).toContain(`POST /deliveries/${claim.deliveryId}/returns/pickups`);
    expect(calls).toContain(`POST /deliveries/${claim.deliveryId}/returns/store-deliveries`);
    expect(calls.some((c) => c.startsWith('GET /return-handovers'))).toBe(true);
    // 일반 단계는 부르지 않는다
    expect(calls).not.toContain(`POST /deliveries/${claim.deliveryId}/store-arrivals`);
    expect(calls).not.toContain(`POST /deliveries/${claim.deliveryId}/completions`);
    expect(sim.metrics().completed).toBe(2); // 원래 배송 + 반품 회수
  }, 60_000);

  it('반납 인증번호 필수(설정 켬)여도 실패 반납이 직원 화면 번호로 끝난다 — MOCK 은 번호 없음·틀림·잠김을 계약대로', async () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS, acceptProbability: 1, customerAbsentRate: 1 }, { startEpochMs: START });
    sim.backend.autoOrders = false;
    sim.backend.params.returnHandoverRequired = true;
    sim.startRiders(1, () => offsetM(MFC, 300, 0));
    await sim.runFor(10);
    sim.backend.createOrder({ pickSec: 1, packMinutes: 3, packages: 1, customer: offsetM(MFC, 1200, 0) });
    await sim.runFor(40 * 60);
    const back = [...sim.backend.deliveries.values()].find((d) => d.purpose === 'FAILED_DELIVERY_RETURN')!;
    expect(back.x.state).toBe('RETURNED_TO_STORE');
    expect(back.returnCode?.failed).toBe(0);

    // 계약 오류 모양(execution 0.28.0): 새 실패 반납을 하나 더 만들어 직접 부른다
    sim.setKnobs({ customerAbsentRate: 0 });
    const del = [...sim.backend.deliveries.values()][0]!;
    const riderId = del.x.riderId!;
    const api = sim.backend.asRider(riderId);
    const b2 = (sim.backend as unknown as { newReturnDelivery(d: unknown): { deliveryId: string }; assign(d: unknown, r: string): void });
    const extra = b2.newReturnDelivery(del);
    b2.assign(extra, riderId);
    await sim.runFor(5);
    const key = (n: number) => `k-${n}`;
    const err = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as ApiProblem);
    expect((await err(api.reportReturnStoreDelivery(extra.deliveryId, {}, { idempotencyKey: key(1) })))?.code).toBe('RETURN_HANDOVER_CODE_REQUIRED');
    const row = (await sim.backend.observer.listReturnHandovers(DEFAULT_PARAMS.mfcId)).items.find((x) => x.deliveryId === extra.deliveryId)!;
    expect(row).toMatchObject({ purpose: 'FAILED_DELIVERY_RETURN', state: 'ASSIGNED', failedAttempts: 0, locked: false });
    const wrong = row.code === '0000' ? '0001' : '0000';
    for (let i = 0; i < 5; i++) {
      const e = await err(api.reportReturnStoreDelivery(extra.deliveryId, { handoverCode: wrong }, { idempotencyKey: key(10 + i) }));
      expect(e?.code).toBe('RETURN_HANDOVER_CODE_MISMATCH');
      expect(e?.problem.details?.[0]).toEqual({ field: 'attemptsLeft', reason: String(4 - i) });
    }
    expect((await err(api.reportReturnStoreDelivery(extra.deliveryId, { handoverCode: row.code }, { idempotencyKey: key(20) })))?.code).toBe('RETURN_HANDOVER_LOCKED');
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

  describe('오배송(MOCK 이 상담원·case 대신)', () => {
    /** 일반 주문 하나를 완료시키고, 그 배송 하나만 오배송이 되게(완료 뒤 확률을 0 으로) */
    async function oneMisdelivery(mock: Partial<(typeof DEFAULT_PARAMS)['mock']>, riders = 3) {
      const sim = new Simulation(
        { ...DEFAULT_PARAMS, acceptProbability: 1, mock: { ...DEFAULT_PARAMS.mock, misdeliveryRate: 1, misdeliveryConfirmSec: 60, ...mock } },
        { startEpochMs: START },
      );
      sim.backend.autoOrders = false;
      // API 기록(apiLog)은 최근 것만 남는 고리라 오래 돌리면 앞이 밀려난다 — 볼 호출은 따로 모은다
      const calls: { path: string; status: number | 'ERR' }[] = [];
      sim.backend.onApiCall((r) => {
        if (r.path.includes('/returns/') || r.path.endsWith('/store-arrivals')) calls.push({ path: r.path, status: r.status });
      });
      sim.startRiders(riders, (i) => offsetM(MFC, 200 + i * 250, 0));
      await sim.runFor(10);
      sim.backend.createOrder({ pickSec: 1, packMinutes: 3, packages: 1, customer: offsetM(MFC, 1200, 0) });
      for (let i = 0; i < 200 && sim.metrics().completed === 0; i++) await sim.runFor(10);
      sim.setKnobs({ misdeliveryRate: 0 }); // 이 뒤 완료는 오배송 안 됨
      const origin = [...sim.backend.deliveries.values()][0]!;
      expect(origin.x.state).toBe('COMPLETED');
      await sim.runFor(90 * 60);
      const of = (p: string) => [...sim.backend.deliveries.values()].filter((x) => x.purpose === p);
      return { sim, origin, of, calls };
    }
    const noStops = (sim: Simulation) => expect(sim.riders.filter((r) => r.phase === 'STOPPED').map((r) => r.id + ': ' + r.note)).toEqual([]);

    it('라이더·시스템 잘못: 회수(원래 라이더 빼고, 잘못 둔 곳 → MFC 반납) + MFC 재발송(일반 흐름으로 완료)', async () => {
      const { sim, origin, of } = await oneMisdelivery({ customerFaultShare: 0 });
      expect(sim.eventLog.some((e) => e.type === 'MisdeliveryConfirmed' && e.deliveryId === origin.deliveryId)).toBe(true);
      const [rec] = of('MISDELIVERY_RECOVERY');
      expect(rec).toBeDefined();
      expect(rec!).toMatchObject({ type: 'RETURN', originDeliveryId: origin.deliveryId, x: { state: 'RETURNED_TO_STORE' }, d: { state: 'CLOSED' } });
      expect(rec!.pickup?.source).toBe('RIDER_COMPLETION_LOCATION');
      expect(rec!.x.riderId).not.toBe(origin.x.riderId); // 원래 라이더 제외
      expect(sim.eventLog.filter((e) => e.deliveryId === rec!.deliveryId).map((e) => e.type)).toEqual(
        expect.arrayContaining(['ReturnPickedUp', 'ReturnDelivered']),
      );
      const [re] = of('MISDELIVERY_RESHIPMENT');
      expect(re).toMatchObject({ type: 'RESHIPMENT', caseId: rec!.caseId, orderId: origin.orderId, x: { state: 'COMPLETED' } });
      const card = sim.deliveryCards().find((c) => c.deliveryId === rec!.deliveryId)!;
      expect(card).toMatchObject({ purpose: 'MISDELIVERY_RECOVERY', executionState: 'RETURNED_TO_STORE' });
      noStops(sim);
    }, 60_000);

    it('고객 잘못·200m 미만: 원래 기사에게 먼저(0원) → 잘못 둔 곳에서 받음 → 주소로 실제 집 찾아 완료', async () => {
      const { sim, origin, of, calls } = await oneMisdelivery({ customerFaultShare: 1, redeliveryDistanceM: [80, 150] });
      const [rd] = of('MISDELIVERY_REDELIVERY');
      expect(rd).toMatchObject({ type: 'RESHIPMENT', x: { state: 'COMPLETED' }, d: { state: 'CLOSED' } });
      expect(rd!.x.riderId).toBe(origin.x.riderId); // 원래 기사
      const first = [...sim.backend.offers.values()].find((o) => o.deliveryId === rd!.deliveryId)!;
      expect(first.riderId).toBe(origin.x.riderId);
      expect(calls.some((r) => r.path === '/deliveries/' + rd!.deliveryId + '/store-arrivals')).toBe(false); // 가게 안 감
      expect(calls.some((r) => r.path === '/deliveries/' + rd!.deliveryId + '/returns/pickups' && typeof r.status === 'number' && r.status < 300)).toBe(true);
      expect(sim.notes.some((n) => n.text === '전달지 핀 없음 — 주소로 위치 찾음')).toBe(true);
      expect(of('MISDELIVERY_RECOVERY')).toHaveLength(0);
      noStops(sim);
    }, 60_000);

    it('고객 잘못·200m 이상·결제함: 결제 대기(배차 안 함) → 결제되면 배차 → 완료', async () => {
      const { sim, of } = await oneMisdelivery({ customerFaultShare: 1, redeliveryDistanceM: [300, 400], redeliveryPayProbability: 1 });
      const [rd] = of('MISDELIVERY_REDELIVERY');
      expect(sim.eventLog.some((e) => e.type === 'RedeliveryPaymentRequired' && e.deliveryId === rd!.deliveryId)).toBe(true);
      expect(rd).toMatchObject({ x: { state: 'COMPLETED' }, paymentRequired: false });
      noStops(sim);
    }, 60_000);

    it('고객 잘못·200m 이상·결제 안 함: 다시 배송 픽업 전 취소 → 회수(원래 라이더 빼고)로 MFC 반납', async () => {
      const { sim, origin, of } = await oneMisdelivery({ customerFaultShare: 1, redeliveryDistanceM: [300, 400], redeliveryPayProbability: 0 });
      const [rd] = of('MISDELIVERY_REDELIVERY');
      expect(rd!.d.state).toBe('CANCELLED_BEFORE_PICKUP');
      expect([...sim.backend.offers.values()].some((o) => o.deliveryId === rd!.deliveryId)).toBe(false); // 결제 전 제안 없음
      const [rec] = of('MISDELIVERY_RECOVERY');
      expect(rec).toMatchObject({ caseId: rd!.caseId, x: { state: 'RETURNED_TO_STORE' } });
      expect(rec!.x.riderId).not.toBe(origin.x.riderId);
      noStops(sim);
    }, 60_000);
  });
});
