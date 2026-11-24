// Vite 개발 서버 플러그인 (docs/design.md §6-4·§6-5). /api 프록시보다 먼저 돈다(configureServer 에서 바로 use).
//
// 하는 일
//  1. LAN 다른 기기 가드(lanPolicy) — GET·HEAD 허용 목록만, 토큰 경로는 루프백만.
//  2. 토큰 붙이기 — 브라우저는 토큰을 받지 않는다(2026-11-16 결정, RR-01 조건 1 보다 엄격).
//     브라우저는 `X-Sim-Rider: RD-sim-NN`(라이더 본인 API) 또는 `X-Sim-Actor: observer`(관찰 직원 조회)만 보내고,
//     개발 서버가 시험 라이더 토큰을 서명하거나(조건 3·4) 관찰 계정으로 로그인해 Authorization 을 붙인 뒤 X-Sim-* 를 지운다.
//  3. 401 이면 그 토큰을 버린다 → 다음 요청에서 새로(조건 7 의 앞부분. 정지 라이더 멈춤은 엔진 몫 — P3).
//  4. GET /sim-auth/status(루프백만) — 비밀 파일이 있는지만(값 없음).
//  6. /sim-operation/beat·end·release(루프백만) — 실서버 운행 지킴이(operationWatch.ts): 맥박이 끊기거나 페이지가 떠나면 라이더 OFF_DUTY.
//  5. /sim-route(도로 경로)·/sim-geocode(주소 → 좌표, POST 본문 — 다시 배송 전달지에 핀이 없어서)(루프백만). 주소·좌표는 로그에 남기지 않는다.
// 로그에는 라이더 ID·경로·상태 코드만(조건 6). 토큰·비밀번호·고객 정보는 남기지 않는다.

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpProxy, Plugin } from 'vite';
import { decideLanRequest, isControlRequest, isListedSimRider, isLoopback } from './lanPolicy';
import { makeSigner, NotSimRiderError, RiderTokenCache } from './riderToken';
import { DEFAULT_PARAMS, OPERATION_WATCH } from '../src/config';
import { GeocodeService, parseAddressBody } from './geocode';
import { OperationWatch, parseWatchBody, type SendState } from './operationWatch';
import { parsePoint, RouteService } from './routing';
import { Secrets, SECRET_FILES, secretsDir } from './secrets';
import { CONTROL_ACCOUNT, fetchStaffToken, OBSERVER_ACCOUNT, staffAuthEndpoints, StaffTokenCache } from './staffToken';

type Next = (err?: unknown) => void;
type Actor = { kind: 'rider'; riderId: string } | { kind: 'observer' } | { kind: 'control' };

interface AuthDeps {
  secrets: Secrets;
  riders: RiderTokenCache | null;
  staff: StaffTokenCache | null;
  /** 관제 계정(RR-08) — 이 PC 의 GET /rider-locations 에만 */
  control: StaffTokenCache | null;
  routes: RouteService;
  geocoder: GeocodeService;
  /** 실서버 운행 지킴이 — 라이더 서명키가 있을 때만 */
  watch: OperationWatch | null;
}

const ACTOR = Symbol('simActor');
let deps: AuthDeps | null = null;

function initDeps(root: string, kakaoRestKey: string | null, kakaoLocalKey: string | null, gateway: string): AuthDeps {
  const secrets = new Secrets(secretsDir(root));
  const st = secrets.status();
  const riders = st.riderSigning
    ? new RiderTokenCache(makeSigner(secrets.read(SECRET_FILES.riderKey), secrets.read(SECRET_FILES.riderKid)))
    : null;
  const staff = st.observer
    ? new StaffTokenCache(() => fetchStaffToken(staffAuthEndpoints(), OBSERVER_ACCOUNT, secrets.read(SECRET_FILES.observerPassword)))
    : null;
  // 비밀번호가 거절되면 다시 시도하지 않는다(같이 쓰는 관리자 계정이 잠기지 않게)
  const control = st.control
    ? new StaffTokenCache(() => fetchStaffToken(staffAuthEndpoints(), CONTROL_ACCOUNT, secrets.read(SECRET_FILES.controlPassword)), 60, true)
    : null;
  console.info(
    `[sim-auth] 비밀 파일 — 라이더 서명키 ${st.riderSigning ? '있음' : '없음'}, 관찰 계정 ${st.observer ? '있음' : '없음'}, 관제 계정 ${st.control ? '있음' : '없음'} (실서버 모드 ${
      st.riderSigning && st.observer ? '가능' : '일부/불가'
    })`,
  );
  console.info(`[sim-route] 카카오모빌리티 REST 키 ${kakaoRestKey ? '있음 — 도로 경로' : '없음 — 직선으로'}`);
  const localKey = kakaoLocalKey ?? kakaoRestKey;
  console.info(`[sim-geocode] 카카오 주소 검색 키 ${localKey ? (kakaoLocalKey ? '있음(KAKAO_LOCAL_REST_KEY)' : '있음(모빌리티 키와 같은 앱 키)') : '없음 — 실서버 다시 배송은 거절'}`);
  const watch = riders ? new OperationWatch(riderStateSender(riders, gateway), OPERATION_WATCH.timeoutSec * 1000) : null;
  if (watch) setInterval(() => void watch.check().catch(() => undefined), OPERATION_WATCH.checkSec * 1000).unref();
  return { secrets, riders, staff, control, routes: new RouteService(kakaoRestKey), geocoder: new GeocodeService(localKey), watch };
}

/**
 * 지킴이가 쓰는 라이더 본인 운행 상태 쓰기 — 게이트웨이에 바로(브라우저 거치지 않음). 응답 본문은 읽지 않는다.
 * 응답이 없으면 결과 불명 — 같은 Idempotency-Key·같은 본문으로 다시(세 번까지). 401 이면 토큰을 버리고 새 토큰·같은 키로 한 번 더.
 */
function riderStateSender(riders: RiderTokenCache, gateway: string): SendState {
  const url = `${gateway.replace(/\/$/, '')}/api/v1/riders/me/state`;
  return async (riderId, body) => {
    const key = randomUUID();
    const payload = JSON.stringify(body);
    let last: number | 'ERR' = 'ERR';
    let renewed = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      let token: string;
      try {
        token = riders.get(riderId);
      } catch {
        return 'ERR'; // RD-sim- 가 아니면 서명하지 않음
      }
      try {
        const res = await fetch(url, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key, 'X-Source-System': DEFAULT_PARAMS.sourceSystem },
          body: payload,
          signal: AbortSignal.timeout(10_000),
        });
        await res.body?.cancel();
        last = res.status;
        if (res.status === 401 && !renewed) {
          riders.invalidate(riderId);
          renewed = true;
          continue;
        }
        return last;
      } catch {
        last = 'ERR';
      }
    }
    return last;
  };
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
    const st = deps?.secrets.status() ?? { riderSigning: false, observer: false, control: false };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ ...st, secretsDir: deps ? '설정됨' : '없음' }));
    return;
  }
  if (path === '/sim-auth' || path.startsWith('/sim-auth/')) return problem(res, 404, 'NOT_FOUND', '없는 경로');
  if (path === '/sim-route') {
    // 도로 경로(이 PC 만 — lanPolicy). 좌표는 로그에 남기지 않는다.
    const q = new URL(url, 'http://local').searchParams;
    const from = parsePoint(q.get('from'));
    const to = parsePoint(q.get('to'));
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (!from || !to) return problem(res, 400, 'VALIDATION_FAILED', 'from·to = lat,lng');
    const result = deps ? await deps.routes.route(from, to) : { kind: 'NONE', reason: 'NO_KEY' };
    res.end(JSON.stringify(result));
    return;
  }
  if (path === '/sim-geocode/status') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(deps ? deps.geocoder.status() : { ready: false, reason: 'NO_KEY' }));
    return;
  }
  if (path === '/sim-geocode') {
    // 주소 → 좌표(이 PC 만 — lanPolicy). 주소는 POST 본문으로만 받고, 주소·좌표를 로그에 남기지 않는다.
    if (method !== 'POST') return problem(res, 405, 'METHOD_NOT_ALLOWED', 'POST 만');
    const raw = await readBody(req, 2048);
    const address = raw === null ? null : parseAddressBody(raw);
    if (!address) return problem(res, 400, 'VALIDATION_FAILED', '{"address": 도로명 주소}');
    const result = deps ? await deps.geocoder.geocode(address) : { kind: 'NONE', reason: 'NO_KEY' };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(result));
    return;
  }
  if (path === '/sim-geocode/' || path.startsWith('/sim-geocode/')) return problem(res, 404, 'NOT_FOUND', '없는 경로');
  if (path === '/sim-operation' || path.startsWith('/sim-operation/')) {
    // 실서버 운행 지킴이(이 PC 만 — lanPolicy). 맥박이 끊기거나 페이지가 떠나면 라이더를 OFF_DUTY
    const kind = path.slice('/sim-operation/'.length);
    if (method !== 'POST' || !['beat', 'end', 'release'].includes(kind)) return problem(res, 404, 'NOT_FOUND', '없는 경로');
    const raw = await readBody(req, 2048);
    const body = raw === null ? null : parseWatchBody(raw);
    if (!body) return problem(res, 400, 'VALIDATION_FAILED', '{"session": …, "riders": [RD-sim-NN]}');
    if (!deps?.watch) return problem(res, 503, 'SIM_AUTH_UNAVAILABLE', '라이더 서명키가 없는 PC');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (kind === 'beat') return void res.end(JSON.stringify(deps.watch.beat(body.session, body.riders)));
    if (kind === 'release') {
      deps.watch.release(body.session);
      return void res.end('{}');
    }
    const results = await deps.watch.end(body.session);
    return void res.end(JSON.stringify({ results }));
  }
  if (path !== '/api' && !path.startsWith('/api/')) return next();

  const loopback = isLoopback(req.socket.remoteAddress);
  const riderHdr = header(req, 'x-sim-rider');
  const actorHdr = header(req, 'x-sim-actor');
  delete req.headers['x-sim-rider'];
  delete req.headers['x-sim-actor'];
  if (decision.stripAuthorization) delete req.headers.authorization;
  // 브라우저는 POST·PUT 에 Origin(http://localhost:5181)을 붙이는데, 게이트웨이 CORS 검사가 이걸 본문 없는 403 으로 막는다
  // (2026-11-16 실측 — 같은 요청에서 Origin 만 빼면 통과). 브라우저 ↔ 개발 서버는 같은 출처이고 게이트웨이의 클라이언트는 개발 서버라 뺀다.
  delete req.headers.origin;
  delete req.headers.referer;

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
  } else if (actorHdr === 'control') {
    // 관리자 권한 토큰 — 이 PC 의 정한 넷만(lanPolicy.isControlRequest: 라이더 관제·직원용 전달지·주문 상세·주문 원문 열람)
    if (!isControlRequest(method, url)) return problem(res, 403, 'CONTROL_READ_ONLY', '관제 계정은 라이더 관제·직원용 전달지·직원용 주문 상세·주문 원문 열람에만');
    actor = { kind: 'control' };
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
  } else if (actor?.kind === 'control') {
    if (!deps?.control) return problem(res, 503, 'SIM_AUTH_UNAVAILABLE', '관제 계정 비밀번호 파일이 없는 PC');
    try {
      req.headers.authorization = `Bearer ${await deps.control.get()}`;
    } catch (e) {
      const st = (e as { status?: number }).status;
      console.warn(`[sim-auth] 관제 계정 로그인 실패${st ? ` (HTTP ${st})` : ''} — 비밀번호 거절이면 개발 서버를 다시 켤 때까지 다시 시도하지 않음`);
      return problem(res, 502, 'CONTROL_LOGIN_FAILED', '관제 계정 로그인 실패');
    }
  }
  (req as unknown as Record<symbol, Actor | null>)[ACTOR] = actor;
  next();
}

/** 요청 본문(작은 JSON) — 넘치면 null */
function readBody(req: IncomingMessage, max: number): Promise<string | null> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= max) chunks.push(c);
    });
    req.on('end', () => resolve(size > max ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
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
    else if (actor.kind === 'control') deps.control?.invalidate();
    else deps.staff?.invalidate();
    const path = (req.url ?? '').split('?')[0];
    console.info(`[sim-auth] ${actor.kind === 'rider' ? actor.riderId : actor.kind} ${req.method} ${path} → 401, 토큰 버림(다음 요청에 새로)`);
  });
}

export function pmartDevServer(opts: { kakaoRestKey?: string | null; kakaoLocalKey?: string | null; gateway?: string } = {}): Plugin {
  const gateway = opts.gateway ?? 'http://192.168.0.40:8080';
  const restKey = opts.kakaoRestKey?.trim() || null;
  const localKey = opts.kakaoLocalKey?.trim() || null;
  return {
    name: 'pmart-rider-dev-server',
    configureServer(server) {
      if (process.env.VITEST) return; // 시험은 실제 비밀 파일·키를 읽지 않는다
      deps ??= initDeps(server.config.root, restKey, localKey, gateway);
      server.middlewares.use(apiMiddleware);
    },
    configurePreviewServer(server) {
      // vite preview 도 server.host·server.proxy 를 물려받으므로 같은 가드·토큰 붙이기
      deps ??= initDeps(server.config.root, restKey, localKey, gateway);
      server.middlewares.use(apiMiddleware);
    },
  };
}
