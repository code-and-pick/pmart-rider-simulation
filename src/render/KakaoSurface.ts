// 카카오 지도 위에 그리기 — 라이더·MFC·고객은 커스텀 오버레이(HTML), 반경은 Circle, 경로는 Polyline(점선).
// 라이더 위치는 매 프레임 setPosition 으로 직접 옮긴다(React 상태 아님). 카카오 로고·저작권 표기는 지우지 않는다.

import { ROUTE_COLOR } from './colors';
import type { KakaoMaps, KCircle, KCustomOverlay, KMap, KPolyline } from './kakao';
import { clusterClick, createClusterEl, createCustomerEl, createMfcEl, createRiderEl, updateClusterEl, updateCustomerEl, updateRiderEl , type ClusterMember } from './markers';
import type { CustomerPinState, MapSurface, RiderMarkerState, RouteKind } from './surface';
import type { LatLng } from '../util/geo';

/** 배송·라이더에 맞출 때 이보다 멀리 보고 있으면 당기는 레벨 [시뮬] — 카카오 레벨 5 ≈ 축척 250m(사용자 2026-11-18 캡처와 같은 배율) */
const FOCUS_LEVEL = 5;

interface Marker {
  ov: KCustomOverlay;
  el: HTMLElement;
  lat: number;
  lng: number;
}

export class KakaoSurface implements MapSurface {
  readonly kind = 'kakao' as const;
  private readonly map: KMap;
  private readonly riders = new Map<string, Marker>();
  private readonly customers = new Map<string, Marker>();
  private readonly clusters = new Map<string, Marker & { pos: LatLng }>();
  private readonly routes = new Map<string, { line: KPolyline; kind: RouteKind; road: boolean; points: LatLng[] }>();
  private mfc: KCustomOverlay | null = null;
  private circles: KCircle[] = [];
  private readonly ro: ResizeObserver;

  constructor(
    private readonly k: KakaoMaps,
    private readonly container: HTMLElement,
    center: LatLng,
    private readonly onRiderClick: (id: string) => void,
    private readonly onClusterClick: (id: string) => boolean = () => false,
  ) {
    this.map = new k.Map(container, { center: new k.LatLng(center.lat, center.lng), level: 6 });
    this.ro = new ResizeObserver(() => this.map.relayout());
    this.ro.observe(container);
  }

  private ll(p: LatLng) {
    return new this.k.LatLng(p.lat, p.lng);
  }

  setMfc(pos: LatLng, label: string, radiiKm: readonly number[]): void {
    this.mfc?.setMap(null);
    for (const c of this.circles) c.setMap(null);
    this.circles = radiiKm.map(
      (km) =>
        new this.k.Circle({
          center: this.ll(pos),
          radius: km * 1000,
          strokeWeight: 1.5,
          strokeColor: '#2b3a55',
          strokeOpacity: 0.55,
          strokeStyle: 'dash',
          fillColor: '#4c8dff',
          fillOpacity: 0.03,
          map: this.map,
        }),
    );
    this.mfc = new this.k.CustomOverlay({ position: this.ll(pos), content: createMfcEl(label), xAnchor: 0.5, yAnchor: 0.85, zIndex: 3, map: this.map });
  }

  upsertRider(id: string, s: RiderMarkerState): void {
    let m = this.riders.get(id);
    if (!m) {
      const el = createRiderEl(s.vehicle);
      el.addEventListener('click', () => this.onRiderClick(id));
      const ov = new this.k.CustomOverlay({ position: this.ll(s.pos), content: el, xAnchor: 0.5, yAnchor: 0.8, zIndex: 10, map: this.map, clickable: true });
      m = { ov, el, lat: s.pos.lat, lng: s.pos.lng };
      this.riders.set(id, m);
    }
    if (m.lat !== s.pos.lat || m.lng !== s.pos.lng) {
      m.ov.setPosition(this.ll(s.pos));
      m.lat = s.pos.lat;
      m.lng = s.pos.lng;
    }
    m.ov.setZIndex(s.selected ? 30 : 10); // 고른 라이더는 같은 자리 묶음(25) 위에
    updateRiderEl(m.el, s.color, s.label, s.heading, s.selected, s.title, s.offline, s.vehicle, s.offset, s.hidden);
  }

  removeRider(id: string): void {
    this.riders.get(id)?.ov.setMap(null);
    this.riders.delete(id);
  }

  upsertCustomer(id: string, s: CustomerPinState): void {
    let m = this.customers.get(id);
    if (!m) {
      const el = createCustomerEl();
      const ov = new this.k.CustomOverlay({ position: this.ll(s.pos), content: el, xAnchor: 0.5, yAnchor: 1, zIndex: 5, map: this.map });
      m = { ov, el, lat: s.pos.lat, lng: s.pos.lng };
      this.customers.set(id, m);
    }
    updateCustomerEl(m.el, s.color, s.label, s.highlight);
    m.ov.setZIndex(s.highlight ? 15 : 5);
  }

  upsertCluster(id: string, pos: LatLng, count: number, title: string, members: readonly ClusterMember[] = [], aside = false): void {
    let m = this.clusters.get(id);
    if (!m) {
      const el = createClusterEl();
      el.addEventListener('click', (e) => {
        const cur = this.clusters.get(id);
        if (!cur) return;
        // 이름 목록이 없으면(많이 모임 등) 예전처럼 확대
        if (!el.querySelector('[data-rid]')) {
          if (!this.onClusterClick(id)) this.zoomInAt(cur.pos);
          return;
        }
        const rid = clusterClick(el, e.target);
        if (rid) this.onRiderClick(rid);
      });
      const ov = new this.k.CustomOverlay({ position: this.ll(pos), content: el, xAnchor: 0.5, yAnchor: 0.5, zIndex: 25, map: this.map, clickable: true });
      m = { ov, el, lat: pos.lat, lng: pos.lng, pos };
      this.clusters.set(id, m);
    }
    if (m.lat !== pos.lat || m.lng !== pos.lng) {
      m.ov.setPosition(this.ll(pos));
      m.lat = pos.lat;
      m.lng = pos.lng;
      m.pos = pos;
    }
    updateClusterEl(m.el, count, title, members, aside);
  }

  removeCluster(id: string): void {
    this.clusters.get(id)?.ov.setMap(null);
    this.clusters.delete(id);
  }

  zoomInAt(pos: LatLng): void {
    this.map.setCenter(this.ll(pos));
    this.map.setLevel(Math.max(1, this.map.getLevel() - 2));
  }

  removeCustomer(id: string): void {
    this.customers.get(id)?.ov.setMap(null);
    this.customers.delete(id);
  }

  upsertRoute(id: string, points: LatLng[], kind: RouteKind, road: boolean): void {
    const r = this.routes.get(id);
    // 실선 = 도로 경로(카카오모빌리티), 점선 = 직선(도로 경로 아님, §6-3)
    const style = road ? 'solid' : 'shortdash';
    if (!r) {
      const line = new this.k.Polyline({
        path: points.map((p) => this.ll(p)),
        strokeWeight: road ? 4 : 3,
        strokeColor: ROUTE_COLOR[kind],
        strokeOpacity: road ? 0.75 : 0.85,
        strokeStyle: style,
        map: this.map,
      });
      this.routes.set(id, { line, kind, road, points });
      return;
    }
    if (r.kind !== kind || r.road !== road) {
      r.line.setOptions({ strokeColor: ROUTE_COLOR[kind], strokeStyle: style, strokeWeight: road ? 4 : 3 });
      r.kind = kind;
      r.road = road;
    }
    if (r.points !== points) {
      r.line.setPath(points.map((p) => this.ll(p)));
      r.points = points;
    }
  }

  removeRoute(id: string): void {
    this.routes.get(id)?.line.setMap(null);
    this.routes.delete(id);
  }

  fitTo(points: LatLng[]): void {
    if (!points.length) return;
    // 숨겼다 다시 보인 직후면 지도가 아는 크기가 낡았다(ResizeObserver 보다 먼저 불릴 수 있음) — 먼저 크기를 다시 잰다
    this.map.relayout();
    if (points.length === 1) {
      this.map.panTo(this.ll(points[0] as LatLng));
      return;
    }
    const b = new this.k.LatLngBounds();
    for (const p of points) b.extend(this.ll(p));
    this.map.setBounds(b, 60, 60, 60, 60);
  }

  screenPoint(pos: LatLng): { x: number; y: number } | null {
    const pt = this.map.getProjection().containerPointFromCoords(this.ll(pos));
    return { x: pt.x, y: pt.y };
  }

  focusOn(pos: LatLng, offsetLeftPx: number, zoomIn = true): void {
    this.map.relayout();
    // 너무 멀리 보고 있으면 동네가 보이게 당긴다(레벨 5 ≈ 축척 250m) — 더 가까이 보고 있으면 그대로
    if (zoomIn && this.map.getLevel() > FOCUS_LEVEL) this.map.setLevel(FOCUS_LEVEL);
    const p = this.ll(pos);
    this.map.setCenter(p);
    if (!offsetLeftPx) return;
    // 그 점이 화면 가운데보다 offsetLeftPx 만큼 왼쪽에 오게 — 중심을 그만큼 오른쪽 점으로
    const proj = this.map.getProjection();
    const pt = proj.containerPointFromCoords(p);
    this.map.setCenter(proj.coordsFromContainerPoint(new this.k.Point(pt.x + offsetLeftPx, pt.y)));
  }

  panTo(pos: LatLng): void {
    this.map.relayout();
    this.map.panTo(this.ll(pos));
  }

  frame(): void {
    /* 카카오 지도는 스스로 다시 그린다 */
  }

  destroy(): void {
    this.ro.disconnect();
    for (const id of [...this.riders.keys()]) this.removeRider(id);
    for (const id of [...this.customers.keys()]) this.removeCustomer(id);
    for (const id of [...this.clusters.keys()]) this.removeCluster(id);
    for (const id of [...this.routes.keys()]) this.removeRoute(id);
    this.mfc?.setMap(null);
    for (const c of this.circles) c.setMap(null);
    this.container.innerHTML = '';
  }
}
