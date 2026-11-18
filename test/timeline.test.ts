// 배송 한 건의 흐름·시간 — 서버 기록 시각으로 단계가 순서대로 나오는지.
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, type SimParams } from '../src/config';
import type { Delivery } from '../src/domain/contract';
import { mockStartEpochMs } from '../src/sim/clock';
import { Simulation } from '../src/sim/simulation';
import { assemble, dispatchSteps, summarySteps } from '../src/sim/timeline';
import { offsetM } from '../src/util/geo';

const START = mockStartEpochMs(Date.UTC(2026, 10, 16, 3, 0, 0));
const MFC = DEFAULT_PARAMS.mfcLocation;
const params = (over: Partial<SimParams> = {}): SimParams => ({ ...DEFAULT_PARAMS, ...over, mock: { ...DEFAULT_PARAMS.mock, ...(over.mock ?? {}) } });

describe('배송 흐름·시간', () => {
  it('MOCK 1건 — 생성 → 첫 제안 → 배정 → 가게 도착 → 픽업 → 고객 도착 → 완료, 진행 중엔 끝 시각 없음', async () => {
    const sim = new Simulation(params({ acceptProbability: 1 }), { startEpochMs: START });
    sim.backend.autoOrders = false;
    sim.startRiders(1, () => offsetM(MFC, 500, 0));
    await sim.runFor(10);
    sim.backend.createOrder({ pickSec: 5, packMinutes: 4, packages: 1, customer: offsetM(MFC, 0, 1500) });
    await sim.runFor(60);
    const id = sim.deliveryCards()[0]!.deliveryId;
    const mid = sim.deliveryTimeline(id)!;
    expect(mid.endMs).toBeNull();
    expect(mid.steps[0]!.key).toBe('created'); // 같은 순간 첫 제안보다 앞
    expect(mid.orderId).toBeTruthy();

    await sim.runFor(30 * 60);
    const t = sim.deliveryTimeline(id)!;
    expect(t.steps.map((s) => s.key.replace(/-\d+$/, ''))).toEqual([
      'created',
      'firstOffer',
      'assigned',
      'x-ARRIVED_AT_STORE',
      'x-PICKED_UP',
      'x-ARRIVED_AT_CUSTOMER',
      'x-COMPLETED',
    ]);
    expect(t.steps.every((s, i) => i === 0 || s.atMs >= t.steps[i - 1]!.atMs)).toBe(true);
    expect(t.steps[2]!.detail).toBe('RD-sim-01');
    expect(t.endMs).toBe(t.steps.at(-1)!.atMs);
    // 전체 = 지표의 배송 한 건 합(같은 시작·끝)
    expect((t.endMs! - t.steps[0]!.atMs) / 1000).toBeCloseTo(sim.metrics().phases!.totalSec, 0);
    expect(sim.deliveryTimeline('DL-없음')).toBeNull();
  });

  it('실서버 모양 — 배차 관점 + 직원 목록 시각, 배차 실패는 끝으로', () => {
    const d: Delivery = {
      state: 'ASSIGNED',
      attempts: [
        {
          attemptId: 'A1',
          trigger: 'STORE_STAFF',
          offers: [
            { riderId: 'RD-x', state: 'REJECTED', sentAt: '2026-11-18T01:00:10Z' },
            { riderId: 'RD-sim-01', state: 'ACCEPTED', sentAt: '2026-11-18T01:00:40Z' },
          ],
        },
      ],
      assignment: { riderId: 'RD-sim-01', assignedAt: '2026-11-18T01:00:50Z' },
    };
    const steps = dispatchSteps(d, Date.parse('2026-11-18T01:00:00Z'));
    steps.push(...summarySteps({ assignedAt: '2026-11-18T01:00:50Z', pickedUpAt: '2026-11-18T01:12:00Z' }, true));
    const t = assemble({ deliveryId: 'DL-1', orderId: 'O-1', purpose: null, basis: 'real', gaps: [] }, steps, false);
    expect(t.steps.map((s) => s.label)).toEqual(['배차 요청(배송 생성)', '첫 제안 보냄', '배정(라이더 수락)', '픽업 완료(QR 인계)']);
    expect(t.steps[1]!.detail).toBe('제안 2번 · 거절·만료 1');
    expect(t.endMs).toBeNull();

    const failed = dispatchSteps({ state: 'DISPATCH_FAILED', updatedAt: '2026-11-18T01:10:00Z', attempts: [{ failureReason: 'NO_RIDER' }] }, Date.parse('2026-11-18T01:00:00Z'));
    const f = assemble({ deliveryId: 'DL-2', orderId: null, purpose: null, basis: 'real', gaps: [] }, failed, false);
    expect(f.steps.at(-1)).toMatchObject({ key: 'dispatchFailed', bad: true, detail: 'NO_RIDER' });
    expect(f.endMs).toBe(Date.parse('2026-11-18T01:10:00Z'));
  });
});
