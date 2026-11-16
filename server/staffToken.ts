// 관찰 직원 계정 토큰 — pmart-backend deploy/lan/checks/staff_auth.py 와 같은 흐름(읽기만 쓰는 계정):
//   Keycloak 비밀번호 로그인(realm pmart-staff, 개발 클라이언트 pmart-dev-cli, LAN 전용)
//   → employee-auth-service 시험용 토큰 교환(/api/v1/internal/dev-token-exchange — 게이트웨이에 없음) → PMart 직원 토큰(15분).
// 계정은 MFC 시뮬레이터와 같은 claude-mfc-wrk(docs/design.md §6-4). 비밀번호는 비밀 파일에서 읽기만, 토큰·비밀번호는 로그에 남기지 않는다.

import { randomUUID } from 'node:crypto';

export const OBSERVER_ACCOUNT = 'claude-mfc-wrk';
const MAIL_DOMAIN = '@pmart.com';
const REALM = 'pmart-staff';

export interface StaffAuthEndpoints {
  keycloak: string;
  employeeAuth: string;
}

/** staff_auth.py 기본값(PC 5 = 192.168.0.101) — 다른 PC 는 PMART_KEYCLOAK·PMART_EMPLOYEE_AUTH 로 바꾼다 */
export function staffAuthEndpoints(): StaffAuthEndpoints {
  return {
    keycloak: process.env.PMART_KEYCLOAK ?? 'http://192.168.0.101:8180',
    employeeAuth: process.env.PMART_EMPLOYEE_AUTH ?? 'http://192.168.0.101:8511',
  };
}

export class StaffAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'StaffAuthError';
  }
}

type Fetch = typeof fetch;

/** 토큰 하나를 받는다. 돌려주는 exp 는 JWT 를 열지 않고 받은 시각 + 14분으로 잡는다(15분 토큰 — 보수적으로). */
export async function fetchStaffToken(
  ep: StaffAuthEndpoints,
  username: string,
  password: string,
  doFetch: Fetch = fetch,
): Promise<{ token: string; exp: number }> {
  const kcUser = username.includes('@') ? username : username + MAIL_DOMAIN;
  const kc = await doFetch(`${ep.keycloak}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'pmart-dev-cli', username: kcUser, password }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (kc.status !== 200) throw new StaffAuthError(`${username} Keycloak 로그인 실패`, kc.status);
  const kcBody = (await kc.json()) as { access_token?: string };
  if (!kcBody.access_token) throw new StaffAuthError(`${username} Keycloak 응답에 토큰 없음`);
  const ex = await doFetch(`${ep.employeeAuth}/api/v1/internal/dev-token-exchange`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Idempotency-Key': randomUUID(),
      'X-Source-System': 'rider-simulator',
      'X-Device-Id': 'rider-simulator',
    },
    body: JSON.stringify({ keycloakAccessToken: kcBody.access_token }),
    signal: AbortSignal.timeout(15_000),
  });
  if (ex.status !== 200) throw new StaffAuthError(`${username} 직원 토큰 교환 실패`, ex.status);
  const b = (await ex.json()) as { tokens?: { accessToken?: string }; accessToken?: string };
  const token = b.tokens?.accessToken ?? b.accessToken;
  if (!token) throw new StaffAuthError(`${username} 교환 응답에 토큰 없음`);
  return { token, exp: Math.floor(Date.now() / 1000) + 14 * 60 };
}

/** 관찰 계정 토큰 보관 — 만료 전이면 같은 토큰, 동시에 여러 요청이 와도 로그인은 한 번. 401 이면 버린다. */
export class StaffTokenCache {
  private cur: { token: string; exp: number } | null = null;
  private pending: Promise<string> | null = null;

  constructor(
    private readonly login: () => Promise<{ token: string; exp: number }>,
    private readonly renewBeforeSec = 60,
  ) {}

  async get(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.cur && this.cur.exp - now > this.renewBeforeSec) return this.cur.token;
    if (!this.pending) {
      this.pending = this.login()
        .then((t) => {
          this.cur = t;
          return t.token;
        })
        .finally(() => {
          this.pending = null;
        });
    }
    return this.pending;
  }

  invalidate(): void {
    this.cur = null;
  }
}
