// 운행 지킴이 브라우저 쪽 — 맥박 ID(src/app/operationWatch.ts)
import { describe, expect, it } from 'vitest';
import { sessionId } from '../src/app/operationWatch';
import { parseWatchBody } from '../server/operationWatch';

describe('페이지 맥박 ID — LAN 주소(보안 출처 아님)에서도', () => {
  it('randomUUID 없이 만들고, 개발 서버 검사를 통과', () => {
    const saved = (crypto as { randomUUID?: unknown }).randomUUID;
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      const a = sessionId();
      expect(a).not.toBe(sessionId());
      expect(parseWatchBody(JSON.stringify({ session: a, riders: ['RD-sim-01'] }))).toEqual({ session: a, riders: ['RD-sim-01'] });
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: saved, configurable: true });
    }
  });
});
