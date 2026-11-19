// 라이더 관제 표 — 백오피스 라이더 관제와 같은 칸.
import { describe, expect, it } from 'vitest';
import { isSimRiderId } from '../src/config';
import { locStatus, rowMatchesRider, rowsFromControl, rowsFromRiders } from '../src/ui/riderTable';

describe('라이더 관제 표', () => {
  it('관제 응답 → 화면 번호 이름·위치 상태·진행 중 배송 단계', () => {
    const rows = rowsFromControl(
      [
        { riderId: 'RD-5c41a0e7-2ac3-4d85-9f03-fc4af8df85e9', nameMasked: '김*수', riderNumber: '482913', vehicleType: 'MOTORCYCLE', newDispatchEnabled: true, restriction: 'NORMAL', stale: false, staleSinceSeconds: 4, location: { lat: 1, lng: 2 }, activeDeliveries: [{ deliveryId: 'DLV-1', stage: 'TO_CUSTOMER', pickedUp: true, etaDrop: null }] },
        { riderId: 'RD-sim-01', stale: true, location: null, activeDeliveries: [] },
      ],
      isSimRiderId,
    );
    expect(rows[0]).toMatchObject({ name: '김*수 · 482913', external: true, sim: false, dispatchOn: true, restriction: null, loc: 'ok', sinceSec: 4 });
    expect(rows[0]!.deliveries[0]).toMatchObject({ deliveryId: 'DLV-1', stage: '고객에게 가는 중' });
    expect(rows[1]).toMatchObject({ name: 'sim-01', sim: true, loc: 'none' });
    // 배송 없고 신규배차 모름 → 쉬는 중(끊김 아님 — 2026-11-19 사용자 "신규배차 끈 사람은 위치끊겨도 되지 않아?")
    expect(locStatus(rows[1]!)).toBe('rest');
    expect(rows.filter((r) => rowMatchesRider(r, 'stale'))).toHaveLength(0);
    // 신규배차를 켠 라이더는 위치가 없으면 끊김
    expect(locStatus({ ...rows[1]!, dispatchOn: true })).toBe('none');
    expect(rows.filter((r) => rowMatchesRider(r, 'delivering'))).toHaveLength(1);
  });

  it('관제 응답이 없으면 화면 라이더로(모르는 칸은 null)', () => {
    const rows = rowsFromRiders(
      [{ id: 'RD-sim-02', pos: { lat: 1, lng: 2 }, heading: 0, phase: 'TO_STORE', note: '', deliveryId: 'DL-1', target: null, path: null, pathKind: null }],
      isSimRiderId,
    );
    expect(rows[0]).toMatchObject({ name: 'sim-02', loc: 'ok', dispatchOn: null, sinceSec: null });
    expect(rows[0]!.deliveries[0]!.stage).toBe('MFC 로 이동');
  });

  it('끊김 판단은 라이더의 locationOffline 하나만 — 숫자 카드와 상세가 어긋나지 않게(복구되면 바로 수신 중)', () => {
    const base = { id: 'RD-sim-01', label: 'sim-01', phase: 'IDLE', pos: { lat: 35.15, lng: 129.06 }, heading: 0, target: null, path: null, pathKind: null, deliveryId: null, note: '' } as const;
    // 예전엔 나이(locationAgeSec > 180)도 따로 봐서 숫자 카드(locationOffline)와 달랐다
    const recovered = rowsFromRiders([{ ...base, locationOffline: false, locationAgeSec: 999 }], isSimRiderId);
    expect(recovered[0]!.loc).toBe('ok');
    const stale = rowsFromRiders([{ ...base, locationOffline: true, locationAgeSec: 200 }], isSimRiderId);
    expect(stale[0]!.loc).toBe('stale');
  });

  it('대기 = 맡은 배송 없음 · 위치 끊김 아님(숫자 카드 "대기"를 누르면 이것만)', () => {
    const base = { id: 'RD-sim-01', label: 'sim-01', phase: 'IDLE', pos: { lat: 35.15, lng: 129.06 }, heading: 0, target: null, path: null, pathKind: null, deliveryId: null, note: '' } as const;
    const [idle, busy, stale] = rowsFromRiders(
      [
        { ...base, id: 'RD-sim-01', dispatchOn: true },
        { ...base, id: 'RD-sim-02', deliveryId: 'DL-1', phase: 'TO_STORE', dispatchOn: true },
        { ...base, id: 'RD-sim-03', locationOffline: true, dispatchOn: true },
        { ...base, id: 'RD-sim-04' }, // 배송 없고 신규배차 꺼짐·모름 = 쉬는 중(위치 공유 안 함) — 대기 아님
      ],
      isSimRiderId,
    );
    const rest = rowsFromRiders([{ ...base, id: 'RD-sim-04' }], isSimRiderId)[0]!;
    expect([idle, busy, stale, rest].map((r) => rowMatchesRider(r!, 'waiting'))).toEqual([true, false, false, false]);
    expect(locStatus(rest)).toBe('rest');
  });
});
