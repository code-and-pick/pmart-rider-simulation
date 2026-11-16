// Vite 개발 서버 플러그인 (docs/design.md §6-4·§6-5). /api 프록시보다 먼저 돈다(configureServer 에서 바로 use).
//
// 하는 일
//  1. LAN 다른 기기 가드(lanPolicy) — GET·HEAD 허용 목록만, 토큰 경로는 루프백만.
//  2. 토큰 붙이기 — 브라우저는 토큰을 받지 않는다(2026-11-16 결정, RR-01 조건 1 보다 엄격).
//     브라우저는 `X-Sim-Rider: RD-sim-NN`(라이더 본인 API) 또는 `X-Sim-Actor: observer`(관찰 직원 조회)만 보내고,
//     개발 서버가 시험 라이더 토큰을 서명하거나(조건 3·4) 관찰 계정으로 로그인해 Authorization 을 붙인 뒤 X-Sim-* 를 지운다.
//  3. 401 이면 그 토큰을 버린다 → 다음 요청에서 새로(조건 7 의 앞부분. 정지 라이더 멈춤은 엔진 몫 — P3).
//  4. GET /sim-auth/status(루프백만) — 비밀 파일이 있는지만(값 없음).
// 로그에는 라이더 ID·경로·상태 코드만(조건 6). 토큰·비밀번호·고객 정보는 남기지 않는다.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpProxy, Plugin } from 'vite';
import { decideLanRequest, isListedSimRider, isLoopback } from './lanPolicy';
import { makeSigner, NotSimRiderError, RiderTokenCache } from './riderToken';
import { Secrets, SECRET_FILES, secretsDir } from './secrets';
import { fetchStaffToken, OBSERVER_ACCOUNT, staffAuthEndpoints, StaffTokenCache } from './staffToken';

type Next = (err?: unknown) => void;
type Actor = { kind: 'rider'; riderId: string } | { kind: 'observer' };

interface AuthDeps {
  secrets: Secrets;
  riders: RiderTokenCache | null;
  staff: StaffTokenCache | null;
}

const ACTOR = Symbol('simActor');
let deps: AuthDeps | null = null;

function initDeps(root: string): AuthDeps {
  const secrets = new Secrets(secretsDir(root));
  const st = secrets.status();
  const riders = st.riderSigning
    ? new RiderTokenCache(makeSigner(secrets.read(SECRET_FILES.riderKey), secrets.read(SECRET_FILES.riderKid)))
    : null;
  const staff = st.observer
    ? new StaffTokenCache(() => fetchStaffToken(staffAuthEndpoints(), OBSERVER_ACCOUNT, secrets.read(SECRET_FILES.observerPassword)))
    : null;
  console.info(
    `[sim-auth] 비밀 파일 — 라이더 서명키 ${st.riderSigning ? '있음' : '없음'}, 관찰 계정 ${st.observer ? '있음' : '없음'} (실서버 모드 ${
      st.riderSigning && st.observer ? '가능' : '일부/불가'
    })`,
  );
  return { secrets, riders, staff };
}

function problem(res: ServerResponse, status: number, code: string, title: string) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/problem+json');
  res.end(JSON.stringify({ type: 'about:blank', title, status, code }));
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

async function handle(req: IncomingMessage, res: ServerResponse, next: Next): Promise<void> {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';
  const decision = decideLanRequest(method, url, req.socket.remoteAddress);
  if (!decision.allow) return problem(res, decision.status, decision.code, '다른 기기에서는 허용하지 않는 요청');

  const path = url.split('?')[0] ?? '';
  if (path === '/sim-auth/status') {
    const st = deps?.secrets.status() ?? { riderSigning: false, observer: false };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ ...st, secretsDir: deps ? '설정됨' : '없음' }));
    return;
  }
  if (path === '/sim-auth' || path.startsWith('/sim-auth/')) return problem(res, 404, 'NOT_FOUND', '없는 경로');
  if (path !== '/api' && !path.startsWith('/api/')) return next();

  const loopback = isLoopback(req.socket.remoteAddress);
  const riderHdr = header(req, 'x-sim-rider');
  const actorHdr = header(req, 'x-sim-actor');
  delete req.headers['x-sim-rider'];
  delete req.headers['x-sim-actor'];
  if (decision.stripAuthorization) delete req.headers.authorization;

  let actor: Actor | null = null;
  if (!loopback) {
    // 다른 기기: 경로가 정한 종류만(§6-4)
    if (decision.token === 'SIM_RIDER') {
      if (!isListedSimRider(riderHdr)) return problem(res, 403, 'LAN_SIM_RIDER_REQUIRED', '시뮬레이터 라이더 목록의 X-Sim-Rider 필요');
      actor = { kind: 'rider', riderId: riderHdr as string };
    } else if (decision.token === 'OBSERVER') {
      actor = { kind: 'observer' };
    }
  } else if (riderHdr) {
    actor = { kind: 'rider', riderId: riderHdr };
  } else if (actorHdr === 'observer') {
    actor = { kind: 'observer' };
  }

  if (actor?.kind === 'rider') {
    if (!deps?.riders) return problem(res, 503, 'SIM_AUTH_UNAVAILABLE', '라이더 서명키가 없는 PC — 실서버 라이더 호출 불가');
    try {
      req.headers.authorization = `Bearer ${deps.riders.get(actor.riderId)}`;
    } catch (e) {
      if (e instanceof NotSimRiderError) return problem(res, 403, 'NOT_SIM_RIDER', '시뮬레이터 라이더(RD-sim-)만 서명한다');
      throw e;
    }
  } else if (actor?.kind === 'observer') {
    if (!deps?.staff) return problem(res, 503, 'SIM_AUTH_UNAVAILABLE', '관찰 계정 비밀번호 파일이 없는 PC');
    try {
      req.headers.authorization = `Bearer ${await deps.staff.get()}`;
    } catch (e) {
      const st = (e as { status?: number }).status;
      console.warn(`[sim-auth] 관찰 계정 로그인 실패${st ? ` (HTTP ${st})` : ''}`);
      return problem(res, 502, 'OBSERVER_LOGIN_FAILED', '관찰 계정 로그인 실패');
    }
  }
  (req as unknown as Record<symbol, Actor | null>)[ACTOR] = actor;
  next();
}

function apiMiddleware(req: IncomingMessage, res: ServerResponse, next: Next): void {
  handle(req, res, next).catch((e: unknown) => {
    console.warn(`[sim-auth] 처리 오류: ${e instanceof Error ? e.name : 'unknown'}`);
    if (!res.headersSent) problem(res, 500, 'SIM_AUTH_ERROR', '개발 서버 토큰 처리 오류');
  });
}

/** vite.config.ts 의 /api proxy.configure — 401 이면 그 토큰을 버린다(조건 7). */
export function configureApiProxy(proxy: HttpProxy.Server): void {
  proxy.on('proxyRes', (proxyRes, req) => {
    if (proxyRes.statusCode !== 401) return;
    const actor = (req as unknown as Record<symbol, Actor | null>)[ACTOR];
    if (!actor || !deps) return;
    if (actor.kind === 'rider') deps.riders?.invalidate(actor.riderId);
    else deps.staff?.invalidate();
    const path = (req.url ?? '').split('?')[0];
    console.info(`[sim-auth] ${actor.kind === 'rider' ? actor.riderId : 'observer'} ${req.method} ${path} → 401, 토큰 버림(다음 요청에 새로)`);
  });
}

export function pmartDevServer(): Plugin {
  return {
    name: 'pmart-rider-dev-server',
    configureServer(server) {
      if (process.env.VITEST) return; // 시험은 실제 비밀 파일을 읽지 않는다
      deps ??= initDeps(server.config.root);
      server.middlewares.use(apiMiddleware);
    },
    configurePreviewServer(server) {
      // vite preview 도 server.host·server.proxy 를 물려받으므로 같은 가드·토큰 붙이기
      deps ??= initDeps(server.config.root);
      server.middlewares.use(apiMiddleware);
    },
  };
}
