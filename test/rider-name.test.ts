import { describe, expect, it } from 'vitest';
import { riderName, setRiderDisplayName } from '../src/domain/riderId';

describe('라이더 화면 표기(ADR-0070, rider 0.18.0 display-names)', () => {
  it('서버 표기를 받으면 "가린 이름 · 번호", 모르면 대체 → 짧은 ID', () => {
    const id = 'RD-claude-97fb21e37325';
    expect(riderName(id)).toBe('claude-97fb21e37325');
    expect(riderName(id, '대체')).toBe('대체');
    setRiderDisplayName(id, '148281', '시***더');
    expect(riderName(id, '대체')).toBe('시***더 · 148281');
  });
  it('탈퇴로 이름이 지워지면 번호만, 둘 다 없으면 등록하지 않는다', () => {
    setRiderDisplayName('RD-x1', '123456', null);
    expect(riderName('RD-x1')).toBe('123456');
    setRiderDisplayName('RD-x2', null, null);
    expect(riderName('RD-x2')).toBe('x2');
  });
});
