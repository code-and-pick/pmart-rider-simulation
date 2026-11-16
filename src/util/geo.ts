// 위경도 계산 — 시내 몇 km 범위라 평면 근사로 충분하다(거리 판정은 하버사인).
// 화면 이동은 직선 보간이다. 도로 경로가 아니다(docs/design.md §6-3).

export interface LatLng {
  lat: number;
  lng: number;
}

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** 두 점 사이 직선거리(m). */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** origin 에서 동쪽 eastM, 북쪽 northM 만큼 옮긴 점. */
export function offsetM(origin: LatLng, eastM: number, northM: number): LatLng {
  return {
    lat: origin.lat + (northM / R) * (180 / Math.PI),
    lng: origin.lng + (eastM / (R * Math.cos(rad(origin.lat)))) * (180 / Math.PI),
  };
}

/** origin 에서 bearing(도, 북=0·동=90) 방향으로 distM 만큼 간 점. */
export function destination(origin: LatLng, bearingDeg: number, distM: number): LatLng {
  return offsetM(origin, Math.sin(rad(bearingDeg)) * distM, Math.cos(rad(bearingDeg)) * distM);
}

/** a → b 방향(도, 북=0·동=90). */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const y = (b.lng - a.lng) * Math.cos(rad((a.lat + b.lat) / 2));
  const x = b.lat - a.lat;
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** from 에서 to 쪽으로 stepM 만큼 간 점. 넘치면 to. */
export function moveToward(from: LatLng, to: LatLng, stepM: number): { pos: LatLng; arrived: boolean } {
  const d = distanceM(from, to);
  if (d <= stepM || d === 0) return { pos: { ...to }, arrived: true };
  const f = stepM / d;
  return { pos: { lat: from.lat + (to.lat - from.lat) * f, lng: from.lng + (to.lng - from.lng) * f }, arrived: false };
}
