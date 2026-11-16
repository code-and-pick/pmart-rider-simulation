// 라이더 메모를 쉬운 말로 — 백엔드 용어(ALREADY_ASSIGNED 등)는 화면 목록에서 풀어 쓰고, 원문은 "기록" 탭에 그대로 둔다.

const LATE: Record<string, string> = {
  ALREADY_ASSIGNED: '다른 라이더가 먼저 가져감',
  EXPIRED: '응답 시간(1분)이 지남',
  INELIGIBLE: '지금은 받을 수 없는 상태',
  ORDER_CANCELLED: '주문이 취소됨',
};

const REJECT: Record<string, string> = {
  TOO_FAR: '너무 멂',
  OVER_CAPACITY: '짐이 많음',
  PERSONAL: '개인 사정',
  OTHER: '기타',
};

export function friendlyNote(note: string): string {
  if (!note) return '';
  let m = /^늦은 수락: ([A-Z_]+)/.exec(note);
  if (m) return `늦은 수락 — ${LATE[m[1] as string] ?? m[1]}`;
  m = /^거절\(([A-Z_]*)\)/.exec(note);
  if (m) return `제안 거절(${REJECT[m[1] as string] ?? (m[1] || '사유 없음')})`;
  if (note.startsWith('제안을 받을 수 없는 상태')) return '지금은 제안을 받을 수 없음';
  if (note.startsWith('제안 응답 거절됨')) return '응답하려 했지만 제안이 이미 닫힘(다른 라이더 배정 등)';
  if (note.startsWith('응답 없음 — 같은 키로 다시 보냄')) return '응답이 끊김 — 같은 요청을 다시 보내는 중(중복 처리 안 됨)';
  m = /^포장 대기\(출고 ([A-Z_]+)\)/.exec(note);
  if (m) return m[1] === 'PREPARING' ? '포장이 끝나길 기다리는 중' : `포장 대기(출고 ${m[1]})`;
  m = /^제안 (\S+) 무응답/.exec(note);
  if (m) return `제안 ${m[1]} 에 응답 안 함(만료되게 둠)`;
  m = /^수락 → 배정 (\S+)/.exec(note);
  if (m) return `${m[1]} 수락 — 배정됨`;
  if (note === '대기 — 제안 조회' || note === '운행 시작') return '제안 기다리는 중';
  return note;
}
