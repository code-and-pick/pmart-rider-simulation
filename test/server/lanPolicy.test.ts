import { describe, expect, it } from 'vitest';
import { decideLanRequest, isListedSimRider, isLoopback, isOperatorDevice, isPrivateLan } from '../../server/lanPolicy';

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
    expect(decideLanRequest('GET', '/api/v1/deliveries?mfcId=MFC-BJG-01', LAN)).toEqual({
      allow: true,
      stripAuthorization: true,
      token: 'OBSERVER',
    });
    expect(decideLanRequest('GET', '/api/v1/deliveries/DL-1/dispatch', LAN)).toMatchObject({ allow: true, token: 'OBSERVER' });
    expect(decideLanRequest('HEAD', '/api/v1/shipments/SH-1', LAN)).toMatchObject({ allow: true, token: 'OBSERVER' });
    expect(decideLanRequest('GET', '/api/v1/centers/MFC-BJG-01', LAN)).toMatchObject({ allow: true, token: 'OBSERVER' });
    expect(decideLanRequest('GET', '/api/v1/centers/MFC-BJG-01/calendar', LAN)).toMatchObject({ allow: false });
    expect(decideLanRequest('GET', '/api/v1/mfc-pickup-points', LAN)).toMatchObject({ allow: true, token: 'SIM_RIDER' });
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

describe('운행 기기 — 다른 PC 에서 가상 라이더 운행 (사용자 2026-11-26)', () => {
  const OP = { device: true };
  it('LAN 사설 주소만, 허용 IP 가 있으면 그 안만', () => {
    expect(isPrivateLan('192.168.0.55')).toBe(true);
    expect(isPrivateLan('::ffff:10.1.2.3')).toBe(true);
    expect(isPrivateLan('172.20.0.1')).toBe(true);
    expect(isPrivateLan('172.32.0.1')).toBe(false);
    expect(isPrivateLan('8.8.8.8')).toBe(false);
    expect(isOperatorDevice(LAN, [])).toBe(true);
    expect(isOperatorDevice(ME, [])).toBe(false); // 이 PC 는 원래 다 됨
    expect(isOperatorDevice('8.8.8.8', [])).toBe(false);
    expect(isOperatorDevice(LAN, ['192.168.0.77'])).toBe(false);
    expect(isOperatorDevice(`::ffff:${LAN}`, ['192.168.0.77', LAN])).toBe(true);
  });

  it('시뮬레이터 라이더 본인 호출은 쓰기·모든 경로, 도구 경로도 열린다', () => {
    const r = { ...OP, simRider: 'RD-sim-01' };
    expect(decideLanRequest('PUT', '/api/v1/riders/me/state', LAN, r)).toEqual({ allow: true, stripAuthorization: true, token: 'SIM_RIDER' });
    expect(decideLanRequest('POST', '/api/v1/offers/OF-1/responses', LAN, r)).toMatchObject({ allow: true, token: 'SIM_RIDER' });
    expect(decideLanRequest('GET', '/api/v1/deliveries/D-1/drop-info', LAN, r)).toMatchObject({ allow: true, token: 'SIM_RIDER' });
    for (const p of ['/sim-auth/status', '/sim-operation/beat', '/sim-route', '/sim-geocode']) {
      expect(decideLanRequest('POST', p, LAN, OP), p).toMatchObject({ allow: true });
    }
  });

  it('라이더가 아니거나 운행 기기가 아니면 그대로 막힌다 — 관제 계정 전달지·주문도', () => {
    expect(decideLanRequest('PUT', '/api/v1/riders/me/state', LAN, { ...OP, simRider: 'RD-real-1' })).toMatchObject({ allow: false, code: 'LAN_READ_ONLY' });
    expect(decideLanRequest('PUT', '/api/v1/riders/me/state', LAN, { device: false, simRider: 'RD-sim-01' })).toMatchObject({ allow: false, code: 'LAN_READ_ONLY' });
    expect(decideLanRequest('POST', '/sim-operation/beat', LAN)).toMatchObject({ allow: false, code: 'LOOPBACK_ONLY' });
    expect(decideLanRequest('GET', '/api/v1/deliveries/D-1/drop-location', LAN, OP)).toMatchObject({ allow: false, code: 'LAN_PATH_BLOCKED' });
    expect(decideLanRequest('POST', '/api/v1/orders/lookups/OR-1/pii-reveals', LAN, OP)).toMatchObject({ allow: false, code: 'LAN_READ_ONLY' });
  });
});
