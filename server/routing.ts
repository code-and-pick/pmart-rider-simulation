// 도로 경로 — 카카오모빌리티 길찾기(단일 경로 GET /v1/directions)를 Vite 개발 서버에서만 부른다(docs/design.md §6-3, RR-04 — 사용자 2026-11-16 "시뮬레이터용 REST 키 따로 받았어").
// 키는 .env.local KAKAO_MOBILITY_REST_KEY(VITE_ 아님 — 브라우저로 가지 않는다). 백엔드 tracking 과 키를 나눠 쓰지 않는다(백엔드 배차 계산의 사용량을 지키려고).
// 응답 모양(2026-11-16 실제 호출로 확인): routes[0].result_code(0 = 성공)·summary.distance(m)·duration(초)·sections[].roads[].vertexes = [x(경도), y(위도), …].
// 경로는 자동차 기준이다(오토바이 경로가 아님). 좌표(고객 위치일 수 있음)는 로그에 남기지 않는다 — 횟수·결과 코드만.

export interface Point {
  lat: number;
  lng: number;
}

export type RouteResult =
  | { kind: 'ROAD'; points: Point[]; distanceM: number; durationSec: number }
  | { kind: 'NONE'; reason: RouteFailReason };

/** NO_KEY 키 없음 · KEY_REJECTED 401/403 · QUOTA 카카오 일 사용량(400 code -10)·429 · DAILY_CAP 이 시뮬레이터 하루 상한 · NO_ROUTE 경로 없음 · UNAVAILABLE 장애·시간 초과 */
export type RouteFailReason = 'NO_KEY' | 'KEY_REJECTED' | 'QUOTA' | 'DAILY_CAP' | 'NO_ROUTE' | 'UNAVAILABLE';

const BASE = 'https://apis-navi.kakaomobility.com';
/** 같은 출발·도착으로 보는 반올림(소수 4자리 ≈ 11m) [시뮬] */
const ROUND = 1e4;
/** 보관 경로 수 [시뮬] */
const CACHE_MAX = 500;
/** 하루(서울 날짜) 카카오 호출 상한 [시뮬] — 카카오 무료 사용량은 확인하지 않았다 [미검증] */
export const DAILY_CAP = 1000;

const key4 = (p: Point) => `${Math.round(p.lat * ROUND)},${Math.round(p.lng * ROUND)}`;
const seoulDay = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);

export class RouteService {
  private readonly cache = new Map<string, RouteResult & { kind: 'ROAD' }>();
  private day = '';
  private calls = 0;
  /** 키가 거절됐거나 사용량이 끝났으면 그날은 다시 부르지 않는다 */
  private blocked: { day: string; reason: RouteFailReason } | null = null;

  constructor(
    private readonly restKey: string | null,
    private readonly doFetch: typeof fetch = (...a) => fetch(...a),
    private readonly now: () => number = () => Date.now(),
    private readonly dailyCap: number = DAILY_CAP,
  ) {}

  stats() {
    return { day: this.day, calls: this.calls, cached: this.cache.size, blocked: this.blocked?.reason ?? null, hasKey: Boolean(this.restKey) };
  }

  async route(from: Point, to: Point): Promise<RouteResult> {
    if (!this.restKey) return { kind: 'NONE', reason: 'NO_KEY' };
    const k = `${key4(from)}|${key4(to)}`;
    const hit = this.cache.get(k);
    if (hit) {
      this.cache.delete(k); // 최근 사용을 뒤로
      this.cache.set(k, hit);
      return hit;
    }
    const today = seoulDay(this.now());
    if (this.day !== today) {
      this.day = today;
      this.calls = 0;
    }
    if (this.blocked?.day === today) return { kind: 'NONE', reason: this.blocked.reason };
    if (this.calls >= this.dailyCap) return { kind: 'NONE', reason: 'DAILY_CAP' };
    this.calls++;

    const url = `${BASE}/v1/directions?origin=${from.lng},${from.lat}&destination=${to.lng},${to.lat}&priority=RECOMMEND`;
    let res: Response;
    try {
      res = await this.doFetch(url, { headers: { Authorization: `KakaoAK ${this.restKey}` }, signal: AbortSignal.timeout(10_000) });
    } catch {
      return { kind: 'NONE', reason: 'UNAVAILABLE' };
    }
    const body = (await res.json().catch(() => ({}))) as {
      code?: number;
      routes?: { result_code?: number; summary?: { distance?: number; duration?: number }; sections?: { roads?: { vertexes?: number[] }[] }[] }[];
    };
    if (res.status === 401 || res.status === 403) return this.block(today, 'KEY_REJECTED');
    if (res.status === 429 || (res.status === 400 && body.code === -10)) return this.block(today, 'QUOTA');
    if (!res.ok) return { kind: 'NONE', reason: 'UNAVAILABLE' };
    const r = body.routes?.[0];
    if (!r || r.result_code !== 0) return { kind: 'NONE', reason: 'NO_ROUTE' };
    const points: Point[] = [];
    for (const s of r.sections ?? []) {
      for (const road of s.roads ?? []) {
        const v = road.vertexes ?? [];
        for (let i = 0; i + 1 < v.length; i += 2) {
          const p = { lng: v[i] as number, lat: v[i + 1] as number };
          const last = points[points.length - 1];
          if (!last || last.lat !== p.lat || last.lng !== p.lng) points.push(p);
        }
      }
    }
    if (points.length < 2) return { kind: 'NONE', reason: 'NO_ROUTE' };
    const result = { kind: 'ROAD' as const, points, distanceM: r.summary?.distance ?? 0, durationSec: r.summary?.duration ?? 0 };
    this.cache.set(k, result);
    if (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
    return result;
  }

  private block(day: string, reason: RouteFailReason): RouteResult {
    this.blocked = { day, reason };
    console.warn(`[sim-route] 카카오모빌리티 ${reason} — 오늘은 직선으로`);
    return { kind: 'NONE', reason };
  }
}

/** `lat,lng` 한 쌍 읽기 — 한국 둘레 밖·숫자 아님은 null */
export function parsePoint(s: string | null): Point | null {
  if (!s) return null;
  const [a, b] = s.split(',');
  const lat = Number(a);
  const lng = Number(b);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < 32 || lat > 39.5 || lng < 124 || lng > 132) return null;
  return { lat, lng };
}
