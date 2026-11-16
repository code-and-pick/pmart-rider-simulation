// 시험 라이더 토큰 — RR-01 회신 조건 3·4 (docs/design.md §6-5). 시험용 키를 새로 만들어 쓴다(실제 LAN 서명키는 읽지 않음).
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { makeSigner, NotSimRiderError, RiderTokenCache, signRiderToken } from '../../server/riderToken';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const signer = makeSigner(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), 'kid-test', 'http://rider-auth-service:8510');

function parts(token: string) {
  const [h, c, s] = token.split('.');
  return {
    header: JSON.parse(Buffer.from(h!, 'base64url').toString()),
    claims: JSON.parse(Buffer.from(c!, 'base64url').toString()),
    signing: `${h}.${c}`,
    sig: Buffer.from(s!, 'base64url'),
  };
}

describe('시험 라이더 토큰 (RR-01)', () => {
  it('RD-sim- 이 아니면 서명하지 않는다(조건 3)', () => {
    for (const id of ['RD-0001', 'RD-claude-1', 'rd-sim-01', 'RD-sim-', '', 'OP-1']) {
      expect(() => signRiderToken(signer, id), id).toThrow(NotSimRiderError);
    }
  });

  it('rider_e2e.py 와 같은 모양 — RS256·kid·iss·aud·typ·빈 roles/centers·sid sim-·15분·jti(조건 4)', () => {
    const now = 1_800_000_000;
    const t = signRiderToken(signer, 'RD-sim-01', now);
    const p = parts(t.token);
    expect(p.header).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'kid-test' });
    expect(p.claims).toMatchObject({
      iss: 'http://rider-auth-service:8510',
      sub: 'RD-sim-01',
      aud: ['pmart-api'],
      typ: 'RIDER',
      roles: [],
      centers: [],
      iat: now,
      exp: now + 900,
    });
    expect(p.claims.sid).toMatch(/^sim-[0-9a-f]{12}$/);
    expect(p.claims.jti).toMatch(/^[0-9a-f]{32}$/);
    expect(t.exp).toBe(now + 900);
    expect(createVerify('RSA-SHA256').update(p.signing).verify(publicKey, p.sig)).toBe(true);
    // 매번 새 sid·jti
    const t2 = parts(signRiderToken(signer, 'RD-sim-01', now).token);
    expect(t2.claims.sid).not.toBe(p.claims.sid);
    expect(t2.claims.jti).not.toBe(p.claims.jti);
  });

  it('보관: 만료 1분 전까지는 같은 토큰, 그 뒤·401 뒤에는 새로 서명(연장 아님)', () => {
    let now = 1_800_000_000;
    const cache = new RiderTokenCache(signer, 60, () => now);
    const a = cache.get('RD-sim-02');
    now += 800;
    expect(cache.get('RD-sim-02')).toBe(a);
    now += 50; // 남은 50초 < 60초
    const b = cache.get('RD-sim-02');
    expect(b).not.toBe(a);
    expect(parts(b).claims.exp).toBe(now + 900);
    cache.invalidate('RD-sim-02');
    expect(cache.get('RD-sim-02')).not.toBe(b);
    expect(() => cache.get('RD-real-1')).toThrow(NotSimRiderError);
  });
});
