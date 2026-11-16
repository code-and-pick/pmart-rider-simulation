import { describe, expect, it } from 'vitest';
import { decideLanRequest, isListedSimRider, isLoopback } from '../../server/lanPolicy';

const LAN = '192.168.0.55';
const ME = '127.0.0.1';

describe('LAN 다른 기기 가드 (docs/design.md §6-4)', () => {
  it('루프백 판정', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopback(LAN)).toBe(false);
    expect(isLoopback('::ffff:192.168.0.55')).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
  });

  it('이 PC 는 쓰기도 그대로 넘긴다', () => {
    expect(decideLanRequest('POST', '/api/v1/offers/OF-1/responses', ME)).toEqual({
      allow: true,
      stripAuthorization: false,
      token: null,
    });
  });

  it('다른 기기의 쓰기는 LAN_READ_ONLY', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(decideLanRequest(m, '/api/v1/offers/OF-1/responses', LAN)).toMatchObject({ allow: false, code: 'LAN_READ_ONLY' });
    }
  });

  it('다른 기기의 허용 목록 조회는 Authorization 을 지우고 넘긴다', () => {
    expect(decideLanRequest('GET', '/api/v1/deliveries?mfcId=MFC-SEED-01', LAN)).toEqual({
      allow: true,
      stripAuthorization: true,
      token: 'OBSERVER',
    });
    expect(decideLanRequest('GET', '/api/v1/deliveries/DL-1/dispatch', LAN)).toMatchObject({ allow: true, token: 'OBSERVER' });
    expect(decideLanRequest('HEAD', '/api/v1/shipments/SH-1', LAN)).toMatchObject({ allow: true, token: 'OBSERVER' });
    expect(decideLanRequest('GET', '/api/v1/riders/me/locations/latest', LAN)).toMatchObject({ allow: true, token: 'SIM_RIDER' });
    expect(decideLanRequest('GET', '/api/v1/offers', LAN)).toMatchObject({ allow: true, token: 'SIM_RIDER' });
  });

  it('개인정보 경로(전달지·회수 연락처·증빙 사진)는 다른 기기에서 막는다', () => {
    for (const p of [
      '/api/v1/deliveries/DL-1/drop-info',
      '/api/v1/deliveries/DL-1/recovery-contact',
      '/api/v1/deliveries/DL-1/evidence-photos/PH-1',
    ]) {
      expect(decideLanRequest('GET', p, LAN)).toMatchObject({ allow: false, code: 'LAN_PATH_BLOCKED' });
    }
  });

  it('허용 목록 밖 조회·/api/v1 밖 /api 경로도 막는다', () => {
    expect(decideLanRequest('GET', '/api/v1/offers/OF-1', LAN)).toMatchObject({ allow: false, code: 'LAN_PATH_BLOCKED' });
    expect(decideLanRequest('GET', '/api/v1/riders/me/settings', LAN)).toMatchObject({ allow: false, code: 'LAN_PATH_BLOCKED' });
    expect(decideLanRequest('GET', '/api/internal/x', LAN)).toMatchObject({ allow: false, code: 'LAN_PATH_BLOCKED' });
    expect(decideLanRequest('GET', '/api/v1/deliveries/DL-1/dispatch/extra', LAN)).toMatchObject({ allow: false });
  });

  it('다른 기기의 X-Sim-Rider 는 시뮬레이터 라이더 목록(RD-sim-01~20)만', () => {
    expect(isListedSimRider('RD-sim-01')).toBe(true);
    expect(isListedSimRider('RD-sim-20')).toBe(true);
    for (const id of ['RD-sim-00', 'RD-sim-21', 'RD-sim-1', 'RD-sim-001', 'RD-claude-01', 'RD-0001', undefined]) {
      expect(isListedSimRider(id), String(id)).toBe(false);
    }
  });

  it('토큰 경로는 루프백만', () => {
    expect(decideLanRequest('POST', '/sim-auth/tokens', LAN)).toMatchObject({ allow: false, code: 'LOOPBACK_ONLY' });
    expect(decideLanRequest('POST', '/sim-auth/tokens', ME)).toMatchObject({ allow: true });
  });

  it('/api·/sim-auth 밖(화면 파일)은 손대지 않는다', () => {
    expect(decideLanRequest('GET', '/src/main.tsx', LAN)).toEqual({ allow: true, stripAuthorization: false, token: null });
    expect(decideLanRequest('GET', '/apiary', LAN)).toEqual({ allow: true, stripAuthorization: false, token: null });
  });
});
