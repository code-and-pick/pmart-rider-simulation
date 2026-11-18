/**
 * 라이더 번호를 화면용으로 짧게 — 전체 번호는 마우스 설명에.
 * 라이더 앱 계정은 백엔드 고유번호(`RD-5c41a0e7-2ac3-…`)라 앞 4자리 `5c41`, 시뮬레이터 라이더(`RD-sim-01`)는 `sim-01`.
 */
export function shortRiderId(id: string): string {
  const uuid = /^RD-([0-9a-f]{4})[0-9a-f]{4}-[0-9a-f-]+$/i.exec(id);
  if (uuid) return uuid[1] as string;
  return id.replace(/^RD-/, '');
}
