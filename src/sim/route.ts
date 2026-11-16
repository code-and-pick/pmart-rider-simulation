// 라이더 이동 경로 — 도로(카카오모빌리티, 개발 서버 /sim-route 경유) 또는 직선(docs/design.md §6-3).
// 화면에는 둘을 구분해 그린다(도로 = 실선, 직선 = 점선 "도로 경로 아님"). 도로를 못 받으면 직선으로 가고 이유를 남긴다.

import { distanceM, type LatLng } from '../util/geo';

export type RouteKind = 'ROAD' | 'STRAIGHT';

export interface Route {
  kind: RouteKind;
  /** 처음 = 출발(지금 위치), 끝 = 도착(정확한 목적지) */
  points: LatLng[];
  /** STRAIGHT 인 이유(도로 경로를 못 받았을 때) */
  note?: string;
}

export interface RouteProvider {
  route(from: LatLng, to: LatLng): Promise<Route>;
}

/** 직선 — 시험·키 없음·실패 때 */
export const straightRoutes: RouteProvider = {
  async route(from, to) {
    return { kind: 'STRAIGHT', points: [{ ...from }, { ...to }] };
  },
};

const REASON: Record<string, string> = {
  NO_KEY: '길찾기 키 없음',
  KEY_REJECTED: '길찾기 키 거절',
  QUOTA: '카카오 사용량 소진',
  DAILY_CAP: '시뮬레이터 하루 상한',
  NO_ROUTE: '경로 없음',
  UNAVAILABLE: '길찾기 응답 없음',
};

/** 개발 서버 /sim-route(이 PC 만) — 키는 서버에만 있다. */
export class DevServerRoutes implements RouteProvider {
  constructor(private readonly doFetch: typeof fetch = (...a) => fetch(...a)) {}

  async route(from: LatLng, to: LatLng): Promise<Route> {
    try {
      const q = `from=${from.lat},${from.lng}&to=${to.lat},${to.lng}`;
      const res = await this.doFetch(`/sim-route?${q}`, { cache: 'no-store', signal: AbortSignal.timeout(12_000) });
      const body = (await res.json()) as { kind?: string; points?: LatLng[]; reason?: string };
      if (res.ok && body.kind === 'ROAD' && body.points && body.points.length >= 2) {
        return { kind: 'ROAD', points: stitch(from, body.points, to) };
      }
      return { kind: 'STRAIGHT', points: [{ ...from }, { ...to }], note: REASON[body.reason ?? ''] ?? `길찾기 실패(${res.status})` };
    } catch {
      return { kind: 'STRAIGHT', points: [{ ...from }, { ...to }], note: '길찾기 응답 없음' };
    }
  }
}

/** 도로 경로 앞뒤를 지금 위치·정확한 목적지에 잇는다(도로 위로 맞춘 점과 몇 m 떨어질 수 있다). */
export function stitch(from: LatLng, road: LatLng[], to: LatLng): LatLng[] {
  const pts = road.map((p) => ({ lat: p.lat, lng: p.lng }));
  if (distanceM(from, pts[0] as LatLng) > 1) pts.unshift({ ...from });
  if (distanceM(pts[pts.length - 1] as LatLng, to) > 1) pts.push({ ...to });
  return pts;
}
