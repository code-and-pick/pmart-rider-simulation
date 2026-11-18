// 카카오맵 웹 JS SDK 불러오기 (docs/design.md §6-1). 서드파티 React 래퍼는 쓰지 않는다(2026-11-16 결정 — 의존성·라이선스 줄이기).
// 아래 타입은 이 시뮬레이터가 쓰는 부분만 손으로 적은 것이다 — SDK 문서로 다시 확인하지 않았다 [미검증].
// 키(JavaScript 키)는 .env.local VITE_KAKAO_JS_KEY. 브라우저에 노출되는 키라 카카오 콘솔 Web 플랫폼 등록 주소로 제한한다.

export interface KLatLng {
  getLat(): number;
  getLng(): number;
}
export interface KLatLngBounds {
  extend(p: KLatLng): void;
}
export interface KMap {
  setCenter(p: KLatLng): void;
  panTo(p: KLatLng): void;
  relayout(): void;
  getLevel(): number;
  setLevel(level: number): void;
  /** 범위가 다 보이게(여백 px: 위·오른쪽·아래·왼쪽) */
  setBounds(b: KLatLngBounds, paddingTop?: number, paddingRight?: number, paddingBottom?: number, paddingLeft?: number): void;
  /** 화면 픽셀 ↔ 좌표(지도 컨테이너 기준) */
  getProjection(): KProjection;
}
export interface KPoint {
  x: number;
  y: number;
}
export interface KProjection {
  containerPointFromCoords(p: KLatLng): KPoint;
  coordsFromContainerPoint(p: KPoint): KLatLng;
}
export interface KCustomOverlay {
  setPosition(p: KLatLng): void;
  setMap(map: KMap | null): void;
  setZIndex(z: number): void;
}
export interface KCircle {
  setMap(map: KMap | null): void;
}
export interface KPolyline {
  setPath(path: KLatLng[]): void;
  setOptions(o: Record<string, unknown>): void;
  setMap(map: KMap | null): void;
}
export interface KakaoMaps {
  load(cb: () => void): void;
  LatLng: new (lat: number, lng: number) => KLatLng;
  LatLngBounds: new () => KLatLngBounds;
  Point: new (x: number, y: number) => KPoint;
  Map: new (el: HTMLElement, opts: { center: KLatLng; level: number }) => KMap;
  CustomOverlay: new (opts: {
    position: KLatLng;
    content: HTMLElement | string;
    xAnchor?: number;
    yAnchor?: number;
    zIndex?: number;
    map?: KMap;
    clickable?: boolean;
  }) => KCustomOverlay;
  Circle: new (opts: Record<string, unknown>) => KCircle;
  Polyline: new (opts: Record<string, unknown>) => KPolyline;
}

declare global {
  interface Window {
    kakao?: { maps: KakaoMaps };
  }
}

let loading: Promise<KakaoMaps> | null = null;

/** SDK 를 한 번만 불러온다. 키가 없거나 실패하면 거절(→ 좌표 평면 대체 화면). */
export function loadKakaoMaps(appKey: string | undefined, timeoutMs = 8000): Promise<KakaoMaps> {
  if (!appKey) return Promise.reject(new Error('VITE_KAKAO_JS_KEY 없음'));
  if (loading) return loading;
  loading = new Promise<KakaoMaps>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('카카오 SDK 응답 없음(시간 초과)')), timeoutMs);
    const script = document.createElement('script');
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false`;
    script.async = true;
    script.onload = () => {
      const maps = window.kakao?.maps;
      if (!maps) {
        window.clearTimeout(timer);
        reject(new Error('카카오 SDK 를 불러왔지만 kakao.maps 가 없음(키·등록 주소 확인)'));
        return;
      }
      maps.load(() => {
        window.clearTimeout(timer);
        resolve(maps);
      });
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('카카오 SDK 를 불러오지 못함(네트워크·키·Web 플랫폼 등록 주소 확인)'));
    };
    document.head.appendChild(script);
  });
  loading.catch(() => {
    loading = null;
  });
  return loading;
}
