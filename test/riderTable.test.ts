// 라이더 관제 표 — 백오피스 라이더 관제와 같은 칸.
import { describe, expect, it } from 'vitest';
import { isSimRiderId } from '../src/config';
import { rowMatchesRider, rowsFromControl, rowsFromRiders } from '../src/ui/riderTable';

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
    expect(rows.filter((r) => rowMatchesRider(r, 'stale')).map((r) => r.id)).toEqual(['RD-sim-01']);
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
});
