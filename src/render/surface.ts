// 지도 화면 추상화 — 카카오 지도(KakaoSurface)와 좌표 평면 대체(PlaneSurface)가 같은 모양을 따른다(docs/design.md §6).
// 매 프레임 MapSync 가 이 메서드들을 부른다. React 상태를 거치지 않는다.

import type { LatLng } from '../util/geo';

export interface RiderMarkerState {
  pos: LatLng;
  heading: number;
  color: string;
  label: string;
  selected: boolean;
}

export interface CustomerPinState {
  pos: LatLng;
  color: string;
  label: string;
}

export type RouteKind = 'TO_STORE' | 'TO_CUSTOMER';

export interface MapSurface {
  readonly kind: 'kakao' | 'plane';
  setMfc(pos: LatLng, label: string, radiiKm: readonly number[]): void;
  upsertRider(id: string, s: RiderMarkerState): void;
  removeRider(id: string): void;
  upsertCustomer(id: string, s: CustomerPinState): void;
  removeCustomer(id: string): void;
  /** 직선 경로선 — 도로 경로가 아니다(§6-3). 점선으로 그린다 */
  upsertRoute(id: string, from: LatLng, to: LatLng, kind: RouteKind): void;
  removeRoute(id: string): void;
  panTo(pos: LatLng): void;
  /** 매 프레임 끝(평면은 여기서 다시 그린다) */
  frame(): void;
  destroy(): void;
}
