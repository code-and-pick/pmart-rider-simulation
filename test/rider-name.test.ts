import { describe, expect, it } from 'vitest';
import { riderName, setRiderDisplayName } from '../src/domain/riderId';

describe('라이더 화면 표기(ADR-0085 번호만, rider 0.18.0 display-names)', () => {
  it('서버 표기를 받으면 번호(R4785)만, 모르면 대체 → 짧은 ID', () => {
    const id = 'RD-claude-97fb21e37325';
    expect(riderName(id)).toBe('claude-97fb21e37325');
    expect(riderName(id, '대체')).toBe('대체');
    setRiderDisplayName(id, 'R4828', '시***더');
    expect(riderName(id, '대체')).toBe('R4828');
    setRiderDisplayName('RD-x3', null, '김*수');
    expect(riderName('RD-x3')).toBe('김*수'); // 번호 없는 옛 기록은 가린 이름
  });
  it('탈퇴로 이름이 지워지면 번호만, 둘 다 없으면 등록하지 않는다', () => {
    setRiderDisplayName('RD-x1', 'R1234', null);
    expect(riderName('RD-x1')).toBe('R1234');
    setRiderDisplayName('RD-x2', null, null);
    expect(riderName('RD-x2')).toBe('x2');
  });
});
