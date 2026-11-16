import { describe, expect, it } from 'vitest';
import { CONTRACT, isSimRiderId, simRiderId } from '../src/config';

describe('시뮬레이터 라이더 ID (RR-01 조건 3)', () => {
  it('RD-sim- 접두어로 만든다', () => {
    expect(simRiderId(0)).toBe('RD-sim-01');
    expect(simRiderId(11)).toBe('RD-sim-12');
    expect(isSimRiderId(simRiderId(3))).toBe(true);
  });

  it('실제 라이더 ID·접두어만 있는 값은 시뮬레이터 라이더가 아니다', () => {
    expect(isSimRiderId('RD-claude-01')).toBe(false);
    expect(isSimRiderId('RD-0001')).toBe(false);
    expect(isSimRiderId('rd-sim-01')).toBe(false);
    expect(isSimRiderId(CONTRACT.simRiderPrefix)).toBe(false);
  });
});
