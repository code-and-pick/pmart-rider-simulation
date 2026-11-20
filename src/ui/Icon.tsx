/**
 * 선 아이콘(24px 격자, 선 1.8) — 메뉴·카드 머리·숫자 타일. 글자(이모지) 대신 같은 굵기 선으로 통일(사용자 2026-11-20 시안).
 * 색은 currentColor — 쓰는 곳에서 정한다.
 */
export type IconName =
  | 'live'
  | 'truck'
  | 'list'
  | 'chart'
  | 'log'
  | 'sun'
  | 'moon'
  | 'check'
  | 'clock'
  | 'bolt'
  | 'alert'
  | 'layers'
  | 'steps'
  | 'user'
  | 'map';

const PATHS: Record<IconName, string> = {
  // 실시간 관제 — 위치 핀 + 신호
  live: 'M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10z M12 8.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5z',
  truck: 'M3 6h11v9H3z M14 9h4l3 3v3h-7z M7 18.5a1.5 1.5 0 1 0 0-3a1.5 1.5 0 0 0 0 3z M17 18.5a1.5 1.5 0 1 0 0-3a1.5 1.5 0 0 0 0 3z',
  list: 'M9 6h11 M9 12h11 M9 18h11 M4.5 6h.01 M4.5 12h.01 M4.5 18h.01',
  chart: 'M5 20V12 M10 20V6 M15 20v-9 M20 20V4',
  log: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7',
  sun: 'M12 16a4 4 0 1 0 0-8a4 4 0 0 0 0 8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  check: 'M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18z M8 12.5l2.7 2.7L16 9.8',
  clock: 'M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18z M12 7v5l3 2',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  alert: 'M12 3l10 18H2z M12 10v4 M12 17.5h.01',
  layers: 'M12 3l9 5-9 5-9-5z M3 13l9 5 9-5 M3 17.5l9 5 9-5',
  steps: 'M4 7h10 M4 12h7 M4 17h10 M17 5l3 2-3 2 M14 10l3 2-3 2',
  user: 'M12 12a4 4 0 1 0 0-8a4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z M9 4v14 M15 6v14',
};

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`ico ${className ?? ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
