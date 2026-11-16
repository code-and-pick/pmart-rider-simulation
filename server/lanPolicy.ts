// LAN 다른 기기에서 들어온 /api 요청을 어디까지 넘길지 정하는 규칙 (docs/design.md §6-4, RR-01 회신 조건 5).
// 화면·Node 에 의존하지 않는 순수 함수 — vitest 로 검사한다(test/lanPolicy.test.ts).
//
// - 이 PC(루프백)는 그대로 넘긴다(가상 라이더 운행 = 읽기·쓰기).
// - 다른 기기는 GET·HEAD 이고 아래 허용 목록에 있는 경로만. 그 밖 메서드는 403 LAN_READ_ONLY, 목록 밖 경로는 403 LAN_PATH_BLOCKED.
//   특히 전달지(`/deliveries/{id}/drop-info` — 고객 주소·전화)·회수 연락처·증빙 사진은 목록에 넣지 않는다.
// - 토큰 경로(`/sim-auth/…`)는 루프백만(LOOPBACK_ONLY) — P2 에서 만든다.
// - 다른 기기가 보낸 Authorization 은 지우고, 붙일 토큰(관찰 계정 / 시뮬레이터 라이더)은 P2 에서 개발 서버가 정한다.

export const API_PREFIX = '/api/v1';
export const SIM_AUTH_PREFIX = '/sim-auth';

/** 다른 기기 요청에 개발 서버가 붙일 토큰 종류. P0 에서는 아직 붙이지 않는다(백엔드가 401 로 답한다). */
export type LanTokenKind = 'OBSERVER' | 'SIM_RIDER';

interface LanRoute {
  pattern: RegExp;
  token: LanTokenKind;
}

const SEG = '[^/]+';

/** 다른 기기에서 조회만 허용하는 경로 (`/api/v1` 뒤). 여기에 없는 경로는 막는다. */
export const LAN_READ_ROUTES: readonly LanRoute[] = [
  // 직원 조회 — 관찰 직원 계정 토큰 (§6-4)
  { pattern: /^\/deliveries$/, token: 'OBSERVER' }, // execution 직원 배송 찾기 (?mfcId=)
  { pattern: new RegExp(`^/deliveries/${SEG}$`), token: 'OBSERVER' }, // execution 수행 조회
  { pattern: new RegExp(`^/deliveries/${SEG}/dispatch$`), token: 'OBSERVER' }, // dispatch 배차 조회
  { pattern: new RegExp(`^/shipments/${SEG}$`), token: 'OBSERVER' }, // mfc-fulfillment 출고 조회
  // 라이더 본인 조회 — X-Sim-Rider 가 시뮬레이터 라이더 목록에 있을 때만 그 라이더 토큰 (RR-01 조건 5)
  { pattern: /^\/riders\/me$/, token: 'SIM_RIDER' },
  { pattern: /^\/riders\/me\/state$/, token: 'SIM_RIDER' },
  { pattern: /^\/riders\/me\/locations\/latest$/, token: 'SIM_RIDER' },
  { pattern: /^\/riders\/me\/deliveries$/, token: 'SIM_RIDER' },
  { pattern: /^\/offers$/, token: 'SIM_RIDER' },
];

export type LanDecision =
  | { allow: true; stripAuthorization: boolean; token: LanTokenKind | null }
  | { allow: false; status: 403; code: 'LAN_READ_ONLY' | 'LAN_PATH_BLOCKED' | 'LOOPBACK_ONLY' };

export function isLoopback(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  return (
    remoteAddress === '::1' ||
    remoteAddress === '127.0.0.1' ||
    remoteAddress.startsWith('127.') ||
    remoteAddress.startsWith('::ffff:127.')
  );
}

/** 요청 URL 에서 쿼리를 떼고 `/api/v1` 뒤 경로를 돌려준다. `/api/v1` 아래가 아니면 null. */
export function apiSubPath(url: string): string | null {
  const path = url.split('?')[0] ?? '';
  if (path === API_PREFIX) return '/';
  if (!path.startsWith(`${API_PREFIX}/`)) return null;
  return path.slice(API_PREFIX.length);
}

/**
 * 개발 서버로 들어온 요청 하나를 판정한다.
 * `/api` 아래도 `/sim-auth` 아래도 아니면 이 규칙과 상관없다(allow, 손대지 않음).
 */
export function decideLanRequest(method: string, url: string, remoteAddress: string | undefined): LanDecision {
  const path = url.split('?')[0] ?? '';
  const loopback = isLoopback(remoteAddress);

  if (path === SIM_AUTH_PREFIX || path.startsWith(`${SIM_AUTH_PREFIX}/`)) {
    return loopback ? { allow: true, stripAuthorization: false, token: null } : { allow: false, status: 403, code: 'LOOPBACK_ONLY' };
  }
  if (path !== '/api' && !path.startsWith('/api/')) return { allow: true, stripAuthorization: false, token: null };
  if (loopback) return { allow: true, stripAuthorization: false, token: null };

  const m = method.toUpperCase();
  if (m !== 'GET' && m !== 'HEAD') return { allow: false, status: 403, code: 'LAN_READ_ONLY' };

  const sub = apiSubPath(url);
  const route = sub === null ? undefined : LAN_READ_ROUTES.find((r) => r.pattern.test(sub));
  if (!route) return { allow: false, status: 403, code: 'LAN_PATH_BLOCKED' };
  return { allow: true, stripAuthorization: true, token: route.token };
}
