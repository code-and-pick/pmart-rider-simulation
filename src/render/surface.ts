// 지도 화면 추상화 — 카카오 지도(KakaoSurface)와 좌표 평면 대체(PlaneSurface)가 같은 모양을 따른다(docs/design.md §6).
// 매 프레임 MapSync 가 이 메서드들을 부른다. React 상태를 거치지 않는다.

import type { LatLng } from '../util/geo';

export interface RiderMarkerState {
  pos: LatLng;
  heading: number;
  color: string;
  label: string;
  selected: boolean;
  /** 마우스를 올리면 보이는 설명(단계·배송) */
  title: string;
  /** 위치 끊김 장면 중 — 흐리게 */
  offline?: boolean;
}

export interface CustomerPinState {
  pos: LatLng;
  color: string;
  label: string;
  /** 고른 배송이면 크게·강조 */
  highlight: boolean;
}

export type RouteKind = 'TO_STORE' | 'TO_CUSTOMER';

export interface MapSurface {
  readonly kind: 'kakao' | 'plane';
  setMfc(pos: LatLng, label: string, radiiKm: readonly number[]): void;
  upsertRider(id: string, s: RiderMarkerState): void;
  removeRider(id: string): void;
  upsertCustomer(id: string, s: CustomerPinState): void;
  removeCustomer(id: string): void;
  /**
   * 경로선(§6-3). road = 카카오모빌리티 도로 경로 → 실선, 아니면 직선 → 점선("도로 경로 아님").
   * points 가 같은 배열이면 다시 그리지 않는다(매 프레임 불림).
   */
  upsertRoute(id: string, points: LatLng[], kind: RouteKind, road: boolean): void;
  removeRoute(id: string): void;
  panTo(pos: LatLng): void;
  /** 점들이 다 보이게 지도 범위를 맞춘다(배송을 누르면 MFC·고객·라이더) */
  fitTo(points: LatLng[]): void;
  /** 매 프레임 끝(평면은 여기서 다시 그린다) */
  frame(): void;
  destroy(): void;
}
