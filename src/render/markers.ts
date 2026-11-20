// 지도 위 HTML 마커 — 카카오 커스텀 오버레이와 평면 대체 화면이 같은 DOM 을 쓴다.
// 라이더는 "입체처럼 그린 그림"(그림자·광택·진행 방향 좌우 뒤집기). 8방향 그림은 다음 단계.

/**
 * 운송수단별 그림(viewBox 40×28) — 등록한 수단대로(사용자 2026-11-19 "도보, 자전거, 퀵보드, 자동차 등 각자 등록한 모양대로").
 * 배달 상자(mk-rider-box)는 라이더 색으로 칠한다. 모르는 수단은 오토바이.
 */
const WHEEL = (cx: number, r = 5.2) => `<circle cx="${cx}" cy="21" r="${r}" fill="#2a2f3a"/><circle cx="${cx}" cy="21" r="${(r * 0.42).toFixed(1)}" fill="#9aa4b5"/>`;
const THIN_WHEEL = (cx: number) => `<circle cx="${cx}" cy="20" r="5.4" fill="none" stroke="#2a2f3a" stroke-width="2"/>`;
const HEAD = (cx: number, cy: number) => `<circle cx="${cx}" cy="${cy}" r="3.2" fill="#3b4456"/>`;
const BOX = (x: number, y: number, w = 11, h = 9) => `<rect class="mk-rider-box" x="${x}" y="${y}" width="${w}" height="${h}" rx="1.5" stroke="#3b4456" stroke-width="1"/>`;

const VEHICLE_SVG: Record<string, string> = {
  MOTORCYCLE:
    WHEEL(9) +
    WHEEL(31) +
    `<path d="M8 20 L15 12 L26 12 L31 20 Z" fill="#e9eef6" stroke="#59657a" stroke-width="1"/>` +
    BOX(6, 4) +
    `<path d="M26 12 L29 6 L33 6" fill="none" stroke="#3b4456" stroke-width="1.6" stroke-linecap="round"/>` +
    HEAD(21, 7),
  BICYCLE:
    THIN_WHEEL(9) +
    THIN_WHEEL(31) +
    `<path d="M9 20 L17 11 L27 11 L31 20 M17 11 L21 20 L27 11 M27 11 L29 6 L32 6" fill="none" stroke="#59657a" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>` +
    BOX(4, 3, 10, 8) +
    HEAD(21, 5),
  E_BIKE:
    THIN_WHEEL(9) +
    THIN_WHEEL(31) +
    `<path d="M9 20 L17 11 L27 11 L31 20 M17 11 L21 20 L27 11 M27 11 L29 6 L32 6" fill="none" stroke="#59657a" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<rect x="17" y="14" width="7" height="4" rx="1" fill="#f2b84b" stroke="#3b4456" stroke-width="0.8"/>` +
    BOX(4, 3, 10, 8) +
    HEAD(21, 5),
  KICKBOARD:
    WHEEL(8, 3.6) +
    WHEEL(32, 3.6) +
    `<path d="M7 18 L30 18 M30 18 L33 4 M30 4 L36 4" fill="none" stroke="#59657a" stroke-width="2.2" stroke-linecap="round"/>` +
    `<path d="M19 18 L21 9" stroke="#3b4456" stroke-width="2" stroke-linecap="round"/>` +
    BOX(10, 7, 9, 7) +
    HEAD(22, 5),
  CAR:
    WHEEL(10, 4.6) +
    WHEEL(30, 4.6) +
    `<path d="M3 20 L3 14 Q4 11 8 11 L12 6 Q13 5 15 5 L27 5 Q29 5 30 6 L34 11 Q37 11 37 14 L37 20 Z" fill="var(--rider-color)" stroke="#3b4456" stroke-width="1"/>` +
    `<path d="M14 7 L26 7 L30 11 L11 11 Z" fill="#cfe3ff" stroke="#3b4456" stroke-width="0.8"/>`,
  WALK:
    HEAD(20, 4.5) +
    `<path d="M20 8 L20 16 M20 16 L15 25 M20 16 L25 25 M20 10 L14 15 M20 10 L26 13" fill="none" stroke="#3b4456" stroke-width="2.4" stroke-linecap="round"/>` +
    BOX(24, 12, 9, 7),
};

function vehicleSvg(v: string | null | undefined): string {
  return `<svg class="mk-rider-body" viewBox="0 0 40 28" width="34" height="24" aria-hidden="true">${VEHICLE_SVG[v ?? ''] ?? VEHICLE_SVG.MOTORCYCLE}</svg>`;
}

export function createRiderEl(vehicle?: string | null): HTMLElement {
  const el = document.createElement('div');
  el.className = 'mk-rider';
  el.dataset.vehicle = vehicle ?? 'MOTORCYCLE';
  el.innerHTML = `
    <i class="mk-leg"></i><i class="mk-origin"></i>
    <div class="mk-rider-shadow"></div>
    <div class="mk-rider-ring"></div>
    ${vehicleSvg(vehicle)}
    <div class="mk-rider-label"></div>`;
  return el;
}

export function updateRiderEl(
  el: HTMLElement,
  color: string,
  label: string,
  heading: number,
  selected: boolean,
  title = '',
  offline = false,
  vehicle?: string | null,
  offset?: { x: number; y: number } | null,
  hidden = false,
): void {
  // 많이 모인 라이더는 묶음("n명")으로만 — 낱개는 숨긴다(떼지 않음 — 다시 흩어지면 바로 보이게)
  const disp = hidden ? 'none' : '';
  if (el.style.display !== disp) el.style.display = disp;
  // 수단이 바뀌면(관제 응답을 읽은 뒤 등) 그림만 바꾼다
  const v = vehicle ?? 'MOTORCYCLE';
  if (el.dataset.vehicle !== v) {
    el.dataset.vehicle = v;
    el.querySelector('.mk-rider-body')?.remove();
    el.querySelector('.mk-rider-ring')?.insertAdjacentHTML('afterend', vehicleSvg(v));
  }
  // 같은 자리에 겹친 라이더는 둥글게 벌려 그린다(실제 위치는 그대로 — 화면에서만 비켜 둠, controller.syncMap)
  const tr = offset && (offset.x || offset.y) ? `${Math.round(offset.x)}px ${Math.round(offset.y)}px` : '';
  if (el.style.translate !== tr) el.style.translate = tr;
  el.classList.toggle('mk-spread', !!tr);
  // 벌린 라이더 — 그림 가운데(22,20)에서 실제 자리(기준점 22,35 를 비킨 만큼 되돌린 곳)까지 가는 선 + 자리 점(사용자 2026-11-20 "위치가 너무 동떨어지게")
  if (tr && offset) {
    const dx = -offset.x;
    const dy = 15 - offset.y;
    const leg = el.querySelector('.mk-leg') as HTMLElement | null;
    const org = el.querySelector('.mk-origin') as HTMLElement | null;
    if (leg) {
      leg.style.width = `${Math.hypot(dx, dy).toFixed(1)}px`;
      leg.style.transform = `rotate(${Math.atan2(dy, dx).toFixed(3)}rad)`;
    }
    if (org) org.style.translate = `${(dx).toFixed(1)}px ${(dy).toFixed(1)}px`;
  }
  el.style.setProperty('--rider-color', color);
  el.classList.toggle('offline', offline);
  if (el.title !== title) el.title = title;
  // 진행 방향이 서쪽이면 그림을 좌우로 뒤집는다
  el.classList.toggle('mk-west', heading > 180 && heading < 360);
  el.classList.toggle('mk-selected', selected);
  const lab = el.querySelector('.mk-rider-label') as HTMLElement;
  if (lab.textContent !== label) lab.textContent = label;
}

/** 라이더 묶음(한 자리에 많이 모임) — "n명" 원. 누르면 그 자리로 확대(surface.zoomInAt) */
export function createClusterEl(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'mk-cluster';
  el.innerHTML = '<b></b><span>명</span>';
  return el;
}

export function updateClusterEl(el: HTMLElement, count: number, title: string): void {
  const b = el.querySelector('b') as HTMLElement;
  if (b.textContent !== String(count)) b.textContent = String(count);
  if (el.title !== title) el.title = title;
}

export function createMfcEl(label: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'mk-mfc';
  el.innerHTML = `
    <svg viewBox="0 0 32 30" width="34" height="32" aria-hidden="true">
      <path d="M3 13 L16 4 L29 13 L29 27 L3 27 Z" fill="#2b3a55" stroke="#ffffff" stroke-width="1.5"/>
      <rect x="7" y="16" width="7" height="11" fill="#f2b84b"/>
      <rect x="17" y="16" width="8" height="5" fill="#4fd1c5"/>
    </svg>
    <div class="mk-mfc-label"></div>`;
  (el.querySelector('.mk-mfc-label') as HTMLElement).textContent = label;
  return el;
}

export function createCustomerEl(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'mk-cust';
  el.innerHTML = `<div class="mk-cust-pin"></div><div class="mk-cust-label"></div>`;
  return el;
}

export function updateCustomerEl(el: HTMLElement, color: string, label: string, highlight = false): void {
  el.style.setProperty('--cust-color', color);
  el.classList.toggle('mk-hl', highlight);
  const lab = el.querySelector('.mk-cust-label') as HTMLElement;
  if (lab.textContent !== label) lab.textContent = label;
}
