// 시험 라이더 토큰 — Vite 개발 서버에서만 LAN rider-auth 서명키로 서명한다(RR-01 회신, docs/design.md §6-5).
// 모양은 pmart-backend deploy/lan/checks/rider_e2e.py rider_token() 과 같다:
//   RS256, kid = 서명키 ID, iss = LAN rider-auth 발급자, aud ["pmart-api"], typ RIDER, roles·centers 빈 배열,
//   sid = "sim-…" 새 값, iat, exp = iat + 900(15분), jti 새 값.
// 주체는 RD-sim- 시뮬레이터 라이더만(조건 3) — 이 키로는 어떤 라이더 토큰이든 만들 수 있으니 여기서 막는다.
// 만료 직전이면 새로 만든다. 같은 토큰을 연장하지 않는다(조건 4).

import { createPrivateKey, createSign, randomUUID, type KeyObject } from 'node:crypto';

export const SIM_RIDER_PREFIX = 'RD-sim-';
export const RIDER_TOKEN_TTL_SEC = 900;
/** LAN rider-auth 발급자 — rider_e2e.py 39행 기본값 */
export const DEFAULT_RIDER_ISSUER = 'http://rider-auth-service:8510';

export class NotSimRiderError extends Error {
  constructor(riderId: string) {
    super(`시뮬레이터 라이더가 아니라 서명하지 않음: ${riderId.slice(0, 32)}`);
    this.name = 'NotSimRiderError';
  }
}

export interface RiderSigner {
  readonly key: KeyObject;
  readonly kid: string;
  readonly issuer: string;
}

export function makeSigner(pem: string, kid: string, issuer: string = process.env.PMART_RIDER_ISSUER ?? DEFAULT_RIDER_ISSUER): RiderSigner {
  return { key: createPrivateKey(pem), kid, issuer };
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export interface SignedToken {
  token: string;
  exp: number;
}

/** 시험 라이더 토큰 하나. nowSec 은 시험용. */
export function signRiderToken(signer: RiderSigner, riderId: string, nowSec: number = Math.floor(Date.now() / 1000)): SignedToken {
  // 조건 3 — 첫 줄에서 거절
  if (!riderId.startsWith(SIM_RIDER_PREFIX) || riderId.length <= SIM_RIDER_PREFIX.length) throw new NotSimRiderError(riderId);
  const header = { alg: 'RS256', typ: 'JWT', kid: signer.kid };
  const exp = nowSec + RIDER_TOKEN_TTL_SEC;
  const claims = {
    iss: signer.issuer,
    sub: riderId,
    aud: ['pmart-api'],
    typ: 'RIDER',
    roles: [],
    centers: [],
    sid: `sim-${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    iat: nowSec,
    exp,
    jti: randomUUID().replace(/-/g, ''),
  };
  const signing = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const sig = createSign('RSA-SHA256').update(signing).sign(signer.key);
  return { token: `${signing}.${b64url(sig)}`, exp };
}

/** 라이더별 토큰 보관 — 만료 renewBeforeSec 전이면 새로 서명(연장 아님). 401 이면 버린다(조건 7). */
export class RiderTokenCache {
  private readonly tokens = new Map<string, SignedToken>();
  constructor(
    private readonly signer: RiderSigner,
    private readonly renewBeforeSec = 60,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  get(riderId: string): string {
    const cur = this.tokens.get(riderId);
    if (cur && cur.exp - this.now() > this.renewBeforeSec) return cur.token;
    const fresh = signRiderToken(this.signer, riderId, this.now());
    this.tokens.set(riderId, fresh);
    return fresh.token;
  }

  invalidate(riderId: string): void {
    this.tokens.delete(riderId);
  }
}
