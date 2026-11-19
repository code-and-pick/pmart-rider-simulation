// 관제 계정(claude-dev, OPERATOR_ADMIN — RR-08): 이 PC 의 GET /rider-locations 에만, 비밀번호 거절 뒤엔 다시 시도하지 않음.
import { describe, expect, it } from 'vitest';
import { decideLanRequest, isControlRequest } from '../../server/lanPolicy';
import { StaffAuthError, StaffTokenCache } from '../../server/staffToken';

describe('관제 계정 (RR-08)', () => {
  it('붙여도 되는 요청은 GET /api/v1/rider-locations 하나', () => {
    expect(isControlRequest('GET', '/api/v1/rider-locations?mfcId=MFC-SEED-01')).toBe(true);
    expect(isControlRequest('HEAD', '/api/v1/rider-locations')).toBe(true);
    expect(isControlRequest('GET', '/api/v1/deliveries/DLV-1/drop-location')).toBe(true);
    expect(isControlRequest('GET', '/api/v1/rider-operating-time?riderId=RD-1&from=2026-11-18&to=2026-11-18')).toBe(false); // 뺐음(2026-11-18)
    expect(isControlRequest('POST', '/api/v1/rider-operating-time')).toBe(false);
    expect(isControlRequest('GET', '/api/v1/riders/me/operating-time')).toBe(false);
    expect(decideLanRequest('GET', '/api/v1/rider-operating-time?riderId=RD-1', '192.168.0.55')).toMatchObject({ allow: false });
    for (const [m, u] of [
      ['POST', '/api/v1/rider-locations'],
      ['GET', '/api/v1/rider-locations/x'],
      ['GET', '/api/v1/riders/RD-1/restrictions'],
      ['GET', '/api/v1/deliveries/DL-1/drop-info'],
      ['POST', '/api/v1/deliveries/DL-1/drop-location'],
      ['GET', '/api/v1/deliveries/DL-1/drop-location/x'],
      ['GET', '/api/v1/deliveries/DL-1/dispatch'],
      ['GET', '/api/v1/internal/rider-locations'],
      ['GET', '/rider-locations'],
    ] as const) {
      expect(isControlRequest(m, u), `${m} ${u}`).toBe(false);
    }
  });

  it('주문 상세(GET)·원문 열람(POST)은 이 경로만 — 사용자 2026-11-19 "여기서 다 열람할 수 있게 해"', () => {
    expect(isControlRequest('GET', '/api/v1/orders/lookups/OR-1')).toBe(true);
    expect(isControlRequest('POST', '/api/v1/orders/lookups/OR-1/pii-reveals')).toBe(true);
    for (const [m, u] of [
      ['GET', '/api/v1/orders/lookups'], // 검색(목록)은 안 붙임
      ['GET', '/api/v1/orders/lookups/OR-1/pii-reveals'],
      ['PUT', '/api/v1/orders/lookups/OR-1/pii-reveals'],
      ['POST', '/api/v1/orders/lookups/OR-1'],
      ['POST', '/api/v1/orders/lookups/OR-1/hides'],
      ['GET', '/api/v1/orders/OR-1'],
      ['POST', '/api/v1/orders/OR-1/hides'],
      ['GET', '/api/v1/internal/orders/OR-1/drop-info'],
    ] as const) {
      expect(isControlRequest(m, u), `${m} ${u}`).toBe(false);
    }
    // 다른 기기는 둘 다 막힘(개인정보·관리자 권한)
    expect(decideLanRequest('GET', '/api/v1/orders/lookups/OR-1', '192.168.0.55')).toMatchObject({ allow: false });
    expect(decideLanRequest('POST', '/api/v1/orders/lookups/OR-1/pii-reveals', '192.168.0.55')).toMatchObject({ allow: false });
  });

  it('다른 기기는 라이더 관제 경로 자체가 막힌다', () => {
    expect(decideLanRequest('GET', '/api/v1/rider-locations?mfcId=MFC-SEED-01', '192.168.0.55')).toMatchObject({ allow: false, code: 'LAN_PATH_BLOCKED' });
    expect(decideLanRequest('GET', '/api/v1/deliveries/DLV-1/drop-location', '192.168.0.55')).toMatchObject({ allow: false, code: 'LAN_PATH_BLOCKED' });
  });

  it('비밀번호가 거절되면(400·401) 다시 로그인하지 않는다 — 같이 쓰는 계정이 잠기지 않게', async () => {
    let calls = 0;
    const cache = new StaffTokenCache(
      async () => {
        calls++;
        throw new StaffAuthError('거절', 401);
      },
      60,
      true,
    );
    await expect(cache.get()).rejects.toThrow('거절');
    await expect(cache.get()).rejects.toThrow('거절');
    expect(calls).toBe(1);
  });

  it('네트워크 오류(상태 없음)·5xx 는 다음 요청에서 다시 시도', async () => {
    let calls = 0;
    const cache = new StaffTokenCache(
      async () => {
        calls++;
        if (calls === 1) throw new StaffAuthError('교환 실패', 503);
        return { token: 't', exp: Math.floor(Date.now() / 1000) + 900 };
      },
      60,
      true,
    );
    await expect(cache.get()).rejects.toThrow();
    await expect(cache.get()).resolves.toBe('t');
    expect(calls).toBe(2);
  });
});
