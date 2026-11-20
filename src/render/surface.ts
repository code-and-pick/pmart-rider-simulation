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
  /** 등록한 운송수단(그림) */
  vehicle?: string | null;
  /** 같은 자리에 겹친 라이더를 화면에서 비켜 그릴 만큼(px) — 실제 위치는 pos 그대로 */
  offset?: { x: number; y: number } | null;
  /** 많이 모인 라이더는 묶음("n명")으로만 보이고 낱개는 숨긴다 */
  hidden?: boolean;
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
  /** 라이더 묶음 "n명"(같은 자리 라이더) — 누르면 onClusterClick(펼쳐 고르기), false 면 그 자리로 확대 */
  upsertCluster(id: string, pos: LatLng, count: number, title: string, members?: readonly import('./markers').ClusterMember[], aside?: boolean): void;
  removeCluster(id: string): void;
  /** 겹친 라이더 고르기 창 — 그 자리 위에 띄움(하나만, 다시 부르면 바꿈). 고르거나 닫으면 onPick/onClose */
  showPicker(pos: LatLng, members: readonly import('./markers').ClusterMember[], onPick: (id: string) => void, onClose: () => void): void;
  hidePicker(): void;
  /** 그 자리를 가운데로 두고 확대 */
  zoomInAt(pos: LatLng): void;
  panTo(pos: LatLng): void;
  /** 지도 칸 안의 화면 좌표(px) — 겹친 라이더 벌리기에 쓴다. 지도가 아직 없으면 null */
  screenPoint(pos: LatLng): { x: number; y: number } | null;
  /** 점들이 다 보이게 지도 범위를 맞춘다(배송을 누르면 MFC·고객·라이더) */
  fitTo(points: LatLng[]): void;
  /**
   * 그 점을 화면 가운데보다 offsetLeftPx 만큼 왼쪽에 둔다(오른쪽에 뜨는 상세 카드에 가리지 않게 — 사용자 2026-11-18).
   * 너무 멀리 보고 있으면 동네가 보이게 당긴다.
   */
  focusOn(pos: LatLng, offsetLeftPx: number, zoomIn?: boolean): void;
  /** 매 프레임 끝(평면은 여기서 다시 그린다) */
  frame(): void;
  destroy(): void;
}
