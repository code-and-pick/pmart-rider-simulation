// 라이더별로 보기 — 오른쪽 탭(배송·사건·API·기록) 거르기.
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/config';
import { mockStartEpochMs } from '../src/sim/clock';
import { Simulation } from '../src/sim/simulation';
import { apiFor, cardsFor, eventsFor, notesFor, roleOf } from '../src/ui/riderFilter';

const START = mockStartEpochMs(Date.UTC(2026, 10, 16, 3, 0, 0));

describe('라이더별로 거르기', () => {
  it('1시간 MOCK 운영 뒤 RD-sim-02 로 거르면 그 라이더 것만', async () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS }, { startEpochMs: START });
    sim.startRiders(5);
    await sim.runFor(3600);
    const me = 'RD-sim-02';
    const all = sim.deliveryCards();

    // 배송: 제안을 받았거나 배정된 것만, 역할 표시
    const cards = cardsFor(all, me);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThan(all.length);
    expect(cards.every((c) => c.riderIds.includes(me))).toBe(true);
    const assigned = cards.filter((c) => roleOf(c, me) === '배정');
    expect(assigned.every((c) => c.riderId === me)).toBe(true);

    // 사건: 라이더가 적힌 사건 + 배정된 배송의 배송 단위 사건
    const events = eventsFor(sim.eventLog, all, me);
    expect(events.some((e) => e.type === 'DispatchOfferSent' && e.riderId === me)).toBe(true);
    expect(events.every((e) => e.riderId === me || (e.riderId === undefined && assigned.some((c) => c.deliveryId === e.deliveryId)))).toBe(true);
    if (assigned.some((c) => c.executionState === 'COMPLETED')) {
      expect(events.some((e) => e.type === 'DeliveryCompleted')).toBe(true);
      expect(events.some((e) => e.type === 'ShipmentReady')).toBe(true); // 배송 단위 사건도 들어온다
    }
    expect(events.some((e) => e.riderId !== undefined && e.riderId !== me)).toBe(false);

    // API: 그 라이더 토큰 호출만(관찰 계정 조회는 빠짐)
    const api = apiFor(sim.apiLog, me);
    expect(api.length).toBeGreaterThan(0);
    expect(api.every((r) => r.actor === me)).toBe(true);

    // 기록
    const notes = notesFor(sim.notes, me);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((n) => n.riderId === me)).toBe(true);

    // 선택 안 함 = 전체
    expect(cardsFor(all, null)).toHaveLength(all.length);
    expect(apiFor(sim.apiLog, null)).toHaveLength(sim.apiLog.length);
  }, 60_000);
});
