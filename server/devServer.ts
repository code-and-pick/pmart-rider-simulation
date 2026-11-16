// Vite 개발 서버 플러그인 자리 (docs/design.md §6-4·§6-5).
// P0: LAN 다른 기기 요청 가드만 — /api 프록시보다 먼저 돈다(configureServer 에서 바로 use 하면 Vite 내부 미들웨어보다 앞).
// P2 에서 여기에 더한다: `/sim-auth/…` 토큰 경로(루프백만), 시험 라이더 토큰 서명(RR-01 — 서명키는 PMART_SECRETS_DIR 에서 읽기만),
//   다른 기기 조회에 관찰 계정 / 시뮬레이터 라이더 토큰 붙이기.
// 로그에는 토큰·주소·전화번호를 남기지 않는다(조건 6) — 이 파일은 지금 아무것도 로그하지 않는다.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { decideLanRequest } from './lanPolicy';

type Next = (err?: unknown) => void;

function lanGuard(req: IncomingMessage, res: ServerResponse, next: Next): void {
  const decision = decideLanRequest(req.method ?? 'GET', req.url ?? '/', req.socket.remoteAddress);
  if (!decision.allow) {
    res.statusCode = decision.status;
    res.setHeader('Content-Type', 'application/problem+json');
    res.end(
      JSON.stringify({
        type: 'about:blank',
        title: '다른 기기에서는 허용하지 않는 요청',
        status: decision.status,
        code: decision.code,
      }),
    );
    return;
  }
  if (decision.stripAuthorization) {
    // 다른 기기가 보낸 토큰은 넘기지 않는다. 붙일 토큰은 P2 에서 개발 서버가 정한다(decision.token).
    delete req.headers.authorization;
  }
  next();
}

export function pmartDevServer(): Plugin {
  return {
    name: 'pmart-rider-dev-server',
    configureServer(server) {
      server.middlewares.use(lanGuard);
    },
    configurePreviewServer(server) {
      // vite preview 도 server.host·server.proxy 를 물려받으므로 같은 가드를 건다.
      server.middlewares.use(lanGuard);
    },
  };
}
