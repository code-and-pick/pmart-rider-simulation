// 좌표 평면 대체 화면 — 카카오 키가 없거나 SDK 를 못 불러올 때(docs/design.md §6-1).
// MFC 를 원점으로 한 미터 격자(캔버스) 위에 카카오 화면과 같은 HTML 마커를 올린다. 휠 = 확대, 끌기 = 이동.

import { ROUTE_COLOR } from './colors';
import { createCustomerEl, createMfcEl, createRiderEl, updateCustomerEl, updateRiderEl } from './markers';
import type { CustomerPinState, MapSurface, RiderMarkerState, RouteKind } from './surface';
import type { LatLng } from '../util/geo';

const M_PER_DEG_LAT = 111_320;

export class PlaneSurface implements MapSurface {
  readonly kind = 'plane' as const;
  private readonly canvas: HTMLCanvasElement;
  private readonly layer: HTMLDivElement;
  private readonly ctx: CanvasRenderingContext2D;
  private origin: LatLng;
  private mfcLabelEl: HTMLElement | null = null;
  private radii: readonly number[] = [];
  /** 화면 중심이 가리키는 원점 기준 미터 */
  private cx = 0;
  private cy = 0;
  private pxPerM = 0.12;
  private readonly riders = new Map<string, { el: HTMLElement; pos: LatLng }>();
  private readonly customers = new Map<string, { el: HTMLElement; pos: LatLng }>();
  private readonly routes = new Map<string, { points: LatLng[]; kind: RouteKind; road: boolean }>();
  private readonly cleanup: (() => void)[] = [];

  constructor(
    private readonly container: HTMLElement,
    center: LatLng,
    private readonly onRiderClick: (id: string) => void,
  ) {
    this.origin = { ...center };
    container.classList.add('plane');
    this.canvas = document.createElement('canvas');
    this.layer = document.createElement('div');
    this.layer.className = 'plane-layer';
    container.append(this.canvas, this.layer);
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      this.pxPerM = Math.min(2, Math.max(0.02, this.pxPerM * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    };
    let drag: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('.mk-rider')) return;
      drag = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      this.cx -= (e.clientX - drag.x) / this.pxPerM;
      this.cy += (e.clientY - drag.y) / this.pxPerM;
      drag = { x: e.clientX, y: e.clientY };
    };
    const onUp = () => {
      drag = null;
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    this.cleanup.push(
      () => container.removeEventListener('wheel', onWheel),
      () => container.removeEventListener('pointerdown', onDown),
      () => window.removeEventListener('pointermove', onMove),
      () => window.removeEventListener('pointerup', onUp),
    );
  }

  /** 위경도 → 원점 기준 미터 */
  private toM(p: LatLng): { x: number; y: number } {
    return {
      x: (p.lng - this.origin.lng) * M_PER_DEG_LAT * Math.cos((this.origin.lat * Math.PI) / 180),
      y: (p.lat - this.origin.lat) * M_PER_DEG_LAT,
    };
  }

  screenPoint(pos: LatLng): { x: number; y: number } | null {
    return this.toPx(pos);
  }

  private toPx(p: LatLng): { x: number; y: number } {
    const m = this.toM(p);
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    return { x: w / 2 + (m.x - this.cx) * this.pxPerM, y: h / 2 - (m.y - this.cy) * this.pxPerM };
  }

  setMfc(pos: LatLng, label: string, radiiKm: readonly number[]): void {
    this.origin = { ...pos };
    this.radii = radiiKm;
    this.mfcLabelEl?.remove();
    this.mfcLabelEl = createMfcEl(label);
    this.mfcLabelEl.classList.add('plane-anchor', 'anchor-bottom');
    this.layer.appendChild(this.mfcLabelEl);
  }

  upsertRider(id: string, s: RiderMarkerState): void {
    let r = this.riders.get(id);
    if (!r) {
      const el = createRiderEl(s.vehicle);
      el.classList.add('plane-anchor', 'anchor-rider');
      el.addEventListener('click', () => this.onRiderClick(id));
      this.layer.appendChild(el);
      r = { el, pos: s.pos };
      this.riders.set(id, r);
    }
    r.pos = s.pos;
    r.el.style.zIndex = s.selected ? '20' : '10';
    updateRiderEl(r.el, s.color, s.label, s.heading, s.selected, s.title, s.offline, s.vehicle, s.offset);
  }

  removeRider(id: string): void {
    this.riders.get(id)?.el.remove();
    this.riders.delete(id);
  }

  upsertCustomer(id: string, s: CustomerPinState): void {
    let c = this.customers.get(id);
    if (!c) {
      const el = createCustomerEl();
      el.classList.add('plane-anchor', 'anchor-bottom');
      this.layer.appendChild(el);
      c = { el, pos: s.pos };
      this.customers.set(id, c);
    }
    updateCustomerEl(c.el, s.color, s.label, s.highlight);
    c.el.style.zIndex = s.highlight ? '15' : '5';
  }

  removeCustomer(id: string): void {
    this.customers.get(id)?.el.remove();
    this.customers.delete(id);
  }

  upsertRoute(id: string, points: LatLng[], kind: RouteKind, road: boolean): void {
    this.routes.set(id, { points, kind, road });
  }

  removeRoute(id: string): void {
    this.routes.delete(id);
  }

  fitTo(points: LatLng[]): void {
    if (!points.length) return;
    const ms = points.map((p) => this.toM(p));
    const xs = ms.map((m) => m.x);
    const ys = ms.map((m) => m.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    this.cx = (x0 + x1) / 2;
    this.cy = (y0 + y1) / 2;
    const w = Math.max(1, this.container.clientWidth - 120);
    const h = Math.max(1, this.container.clientHeight - 120);
    const span = Math.max(x1 - x0, 1) / w > Math.max(y1 - y0, 1) / h ? Math.max(x1 - x0, 1) / w : Math.max(y1 - y0, 1) / h;
    this.pxPerM = Math.min(2, Math.max(0.02, 1 / Math.max(span, 1e-6)));
  }

  panTo(pos: LatLng): void {
    const m = this.toM(pos);
    this.cx = m.x;
    this.cy = m.y;
  }

  focusOn(pos: LatLng, offsetLeftPx: number, zoomIn = true): void {
    // 평면은 가까이(1px ≈ 4m) — 너무 멀리 보고 있으면 당긴다
    if (zoomIn) this.pxPerM = Math.max(this.pxPerM, 0.25);
    const m = this.toM(pos);
    this.cx = m.x + offsetLeftPx / this.pxPerM;
    this.cy = m.y;
  }

  frame(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
    }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const styles = getComputedStyle(this.container);
    g.fillStyle = styles.getPropertyValue('--plane-bg').trim() || '#f4f6fa';
    g.fillRect(0, 0, w, h);

    // 500m 격자
    const grid = styles.getPropertyValue('--plane-grid').trim() || '#dde3ec';
    g.strokeStyle = grid;
    g.lineWidth = 1;
    const step = 500 * this.pxPerM;
    const o = this.toPx(this.origin);
    for (let x = ((o.x % step) + step) % step; x < w; x += step) line(g, x, 0, x, h);
    for (let y = ((o.y % step) + step) % step; y < h; y += step) line(g, 0, y, w, y);

    // 반경 원
    g.setLineDash([6, 5]);
    g.strokeStyle = styles.getPropertyValue('--plane-radius').trim() || '#6b7a96';
    g.fillStyle = styles.getPropertyValue('--plane-ink').trim() || '#55627a';
    g.font = '11px system-ui, sans-serif';
    for (const km of this.radii) {
      g.beginPath();
      g.arc(o.x, o.y, km * 1000 * this.pxPerM, 0, Math.PI * 2);
      g.stroke();
      g.fillText(`${km}km`, o.x + km * 1000 * this.pxPerM + 4, o.y - 4);
    }

    // 경로 — 도로 경로 실선, 직선 점선(도로 경로 아님)
    g.lineWidth = 3;
    for (const r of this.routes.values()) {
      g.setLineDash(r.road ? [] : [6, 5]);
      g.strokeStyle = ROUTE_COLOR[r.kind];
      g.beginPath();
      r.points.forEach((p, i) => {
        const q = this.toPx(p);
        if (i === 0) g.moveTo(q.x, q.y);
        else g.lineTo(q.x, q.y);
      });
      g.stroke();
    }
    g.setLineDash([]);

    // 축척
    const barM = 1000;
    g.strokeStyle = styles.getPropertyValue('--plane-ink').trim() || '#55627a';
    g.lineWidth = 2;
    line(g, 16, h - 18, 16 + barM * this.pxPerM, h - 18);
    g.fillText('1km', 16, h - 24);

    place(this.mfcLabelEl, o);
    for (const r of this.riders.values()) place(r.el, this.toPx(r.pos));
    for (const c of this.customers.values()) place(c.el, this.toPx(c.pos));
  }

  destroy(): void {
    for (const f of this.cleanup) f();
    this.container.classList.remove('plane');
    this.container.innerHTML = '';
  }
}

function line(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
}

function place(el: HTMLElement | null, p: { x: number; y: number }) {
  if (!el) return;
  el.style.transform = `translate(${p.x}px, ${p.y}px)`;
}
