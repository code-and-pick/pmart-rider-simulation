// 지도 위 HTML 마커 — 카카오 커스텀 오버레이와 평면 대체 화면이 같은 DOM 을 쓴다.
// 라이더는 "입체처럼 그린 그림"(그림자·광택·진행 방향 좌우 뒤집기). 8방향 그림은 다음 단계.

export function createRiderEl(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'mk-rider';
  el.innerHTML = `
    <div class="mk-rider-shadow"></div>
    <div class="mk-rider-ring"></div>
    <svg class="mk-rider-body" viewBox="0 0 40 28" width="34" height="24" aria-hidden="true">
      <circle cx="9" cy="21" r="5.2" fill="#2a2f3a"/><circle cx="9" cy="21" r="2.2" fill="#9aa4b5"/>
      <circle cx="31" cy="21" r="5.2" fill="#2a2f3a"/><circle cx="31" cy="21" r="2.2" fill="#9aa4b5"/>
      <path d="M8 20 L15 12 L26 12 L31 20 Z" fill="#e9eef6" stroke="#59657a" stroke-width="1"/>
      <rect class="mk-rider-box" x="6" y="4" width="11" height="9" rx="1.5" stroke="#3b4456" stroke-width="1"/>
      <path d="M26 12 L29 6 L33 6" fill="none" stroke="#3b4456" stroke-width="1.6" stroke-linecap="round"/>
      <circle cx="21" cy="7" r="3.2" fill="#3b4456"/>
    </svg>
    <div class="mk-rider-label"></div>`;
  return el;
}

export function updateRiderEl(el: HTMLElement, color: string, label: string, heading: number, selected: boolean): void {
  el.style.setProperty('--rider-color', color);
  // 진행 방향이 서쪽이면 그림을 좌우로 뒤집는다
  el.classList.toggle('mk-west', heading > 180 && heading < 360);
  el.classList.toggle('mk-selected', selected);
  const lab = el.querySelector('.mk-rider-label') as HTMLElement;
  if (lab.textContent !== label) lab.textContent = label;
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

export function updateCustomerEl(el: HTMLElement, color: string, label: string): void {
  el.style.setProperty('--cust-color', color);
  const lab = el.querySelector('.mk-cust-label') as HTMLElement;
  if (lab.textContent !== label) lab.textContent = label;
}
