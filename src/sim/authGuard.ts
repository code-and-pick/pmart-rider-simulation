// RR-01 회신 조건 7: 세션 차단(라이더 정지 등)으로 401 이면 새 토큰을 만들되, 같은 라이더가 정지 상태면 운행하지 않는다.
// 새 토큰은 개발 서버가 만든다(401 을 보면 그 토큰을 버림 — server/devServer.ts). 여기서는 순서만:
//   401 → GET /riders/me(새 토큰)로 제한 확인 → SUSPENDED·TERMINATED 면 RiderRestrictedError(라이더 멈춤)
//        → 아니면 원래 호출을 한 번만 다시. 또 401 이면 그대로 던진다(반복하지 않음).
// 같은 Idempotency-Key 로 다시 보내므로 쓰기도 안전하다(401 은 서버가 처리하지 않은 요청).

import type { RiderApi } from '../backend/port';
import { ApiProblem, type AccountRestriction } from '../domain/contract';

export class RiderRestrictedError extends Error {
  constructor(
    readonly riderId: string,
    readonly restriction: AccountRestriction,
  ) {
    super(`${riderId} 계정 제한 ${restriction} — 운행 중지`);
    this.name = 'RiderRestrictedError';
  }
}

export const STOP_RESTRICTIONS: readonly AccountRestriction[] = ['SUSPENDED', 'TERMINATED'];

const is401 = (e: unknown) => e instanceof ApiProblem && e.status === 401;

export function withAuthRecovery(api: RiderApi, onNote: (text: string) => void = () => undefined): RiderApi {
  const recover = async <T>(name: string, call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (e) {
      if (!is401(e)) throw e;
      onNote(`401(${name}) — 새 토큰으로 계정 제한 확인`);
      if (name !== 'getMe') {
        const me = await api.getMe(); // 401 이면 여기서 그대로 던진다
        const r = me.restriction?.state;
        if (r && STOP_RESTRICTIONS.includes(r)) throw new RiderRestrictedError(api.riderId, r);
      }
      return call(); // 한 번만
    }
  };
  const wrapped: Record<string, unknown> = { riderId: api.riderId };
  for (const [key, value] of Object.entries(api)) {
    if (typeof value !== 'function') continue;
    wrapped[key] = (...args: unknown[]) => recover(key, () => (value as (...a: unknown[]) => Promise<unknown>)(...args));
  }
  return wrapped as unknown as RiderApi;
}
