/** 서울 시각 HH:MM:SS */
export function seoulTime(epochMs: number): string {
  const d = new Date(epochMs + 9 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** 초 → "3분 20초" · "2시간 5분" · "2일 17시간 9분" (null 이면 —) */
export function dur(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return '—';
  const s = Math.round(sec);
  if (s < 60) return `${s}초`;
  if (s < 3600) return `${Math.floor(s / 60)}분 ${s % 60}초`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h < 24) return `${h}시간 ${m}분`;
  return `${Math.floor(h / 24)}일 ${h % 24}시간 ${m}분`;
}
