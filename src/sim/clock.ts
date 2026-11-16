/**
 * 시뮬레이션 시계. now = 시작부터 지난 초. 계약 필드(시각)는 iso() 로 만든다.
 * MOCK 은 배속을 쓰고, 실서버(P2)는 실제 시각 1×(MFC 시뮬레이터 SIM-1 과 같게).
 */
export class SimClock {
  now = 0;
  constructor(
    /** now = 0 의 실제 시각(epoch ms) */
    readonly startEpochMs: number,
  ) {}

  epochMs(t: number = this.now): number {
    return this.startEpochMs + t * 1000;
  }

  iso(t: number = this.now): string {
    return new Date(this.epochMs(t)).toISOString();
  }

  /** Asia/Seoul 시(0~24, 소수) — 배차 가능 시간 판정용 */
  seoulHour(t: number = this.now): number {
    const d = new Date(this.epochMs(t) + 9 * 3600_000);
    return d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  }
}

/** MOCK 시작 시각: 오늘(서울) 10:00 [시뮬] — 배차 가능 08~24시 안에서 시작한다. */
export function mockStartEpochMs(nowMs: number = Date.now()): number {
  const seoul = new Date(nowMs + 9 * 3600_000);
  const day = Date.UTC(seoul.getUTCFullYear(), seoul.getUTCMonth(), seoul.getUTCDate());
  return day + 10 * 3600_000 - 9 * 3600_000;
}
