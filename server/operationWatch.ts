// 실서버 운행 지킴이 (src/config.ts OPERATION_WATCH, 사용자 2026-11-24 "진행해").
//
// 운행은 브라우저 페이지가 돌린다. 창이 닫히거나 가려져 페이지가 멈추면 라이더가 ON_DUTY·신규배차 켬으로 남아
// 아무도 움직이지 않는 라이더에게 실제 제안이 간다(2026-11-24 두 번). 그래서:
//   - 운행 중인 페이지는 POST /sim-operation/beat {session, riders} 를 박자마다 보낸다(이 PC 만 — lanPolicy).
//   - 페이지가 떠나면(pagehide) POST /sim-operation/end {session} — 곧바로 멈춤 처리.
//   - 정상 "운행 종료"로 모두 OFF_DUTY 가 되면 POST /sim-operation/release {session} — 아무것도 안 함.
//   - 맥박이 timeoutSec 넘게 없으면 멈춤 처리.
// 멈춤 처리 = 그 라이더(RD-sim- 만)를 PUT /riders/me/state OFF_DUTY. 진행 중 배송이 있어 409 면
// ON_DUTY + newDispatchEnabled false(새 제안만 막음 — 배송 상태는 건드리지 않는다).
// 멈춘 세션이 다시 맥박을 보내면 {stopped: true} 로 답한다 → 페이지가 운행 종료로 들어간다.
// 로그에는 라이더 ID·상태 코드만. 토큰은 로그·응답에 넣지 않는다.

import { isListedSimRider } from './lanPolicy';

export interface StateWrite {
  status: 'OFF_DUTY' | 'ON_DUTY';
  newDispatchEnabled: boolean;
}

/** 라이더 본인 운행 상태 쓰기 — 상태 코드만 돌려준다(응답 없음·네트워크 오류는 'ERR') */
export type SendState = (riderId: string, body: StateWrite) => Promise<number | 'ERR'>;

interface Session {
  riders: string[];
  lastBeat: number;
  stopped: boolean;
}

export interface WatchResult {
  riderId: string;
  /** OFF = OFF_DUTY 됨, NO_DISPATCH = 진행 중 배송이라 신규배차만 끔, FAILED = 둘 다 못 함(화면·운영 확인 필요) */
  outcome: 'OFF' | 'NO_DISPATCH' | 'FAILED';
  status: number | 'ERR';
}

export class OperationWatch {
  private sessions = new Map<string, Session>();

  constructor(
    private readonly send: SendState,
    private readonly timeoutMs: number,
    private readonly now: () => number = Date.now,
    private readonly log: (line: string) => void = (l) => console.info(l),
  ) {}

  /** 맥박. 이미 멈춤 처리한 세션이면 stopped(페이지가 운행 종료로 들어가게) */
  beat(session: string, riders: string[]): { stopped: boolean } {
    const s = this.sessions.get(session);
    if (s?.stopped) return { stopped: true };
    const list = riders.filter((r) => isListedSimRider(r));
    this.sessions.set(session, { riders: list, lastBeat: this.now(), stopped: false });
    return { stopped: false };
  }

  /** 정상 운행 종료 — 지킴이에서 뺀다 */
  release(session: string): void {
    this.sessions.delete(session);
  }

  /** 페이지가 떠남 — 곧바로 멈춤 처리 */
  end(session: string): Promise<WatchResult[]> {
    const s = this.sessions.get(session);
    if (!s || s.stopped) return Promise.resolve([]);
    return this.trip(session, s, '페이지 떠남');
  }

  /** 맥박이 끊긴 세션을 멈춤 처리(개발 서버가 checkSec 마다 부름) */
  async check(): Promise<WatchResult[]> {
    const out: WatchResult[] = [];
    const t = this.now();
    for (const [id, s] of this.sessions) {
      if (!s.stopped && t - s.lastBeat > this.timeoutMs) out.push(...(await this.trip(id, s, `맥박 ${Math.round((t - s.lastBeat) / 1000)}초 없음`)));
      // 멈춘 세션은 하루 지나면 잊는다(다시 맥박이 와도 새 세션처럼)
      if (s.stopped && t - s.lastBeat > 24 * 3600_000) this.sessions.delete(id);
    }
    return out;
  }

  /** 지킴이가 보고 있는 라이더(시험·상태용) */
  watching(): string[] {
    return [...this.sessions.values()].filter((s) => !s.stopped).flatMap((s) => s.riders);
  }

  private async trip(id: string, s: Session, why: string): Promise<WatchResult[]> {
    s.stopped = true;
    // 같은 라이더를 다른 살아 있는 세션이 돌리고 있으면 건드리지 않는다(페이지를 새로 열어 다시 켠 경우)
    const live = new Set([...this.sessions.entries()].filter(([k, v]) => k !== id && !v.stopped).flatMap(([, v]) => v.riders));
    const out: WatchResult[] = [];
    for (const riderId of s.riders) {
      if (live.has(riderId)) continue;
      const off = await this.send(riderId, { status: 'OFF_DUTY', newDispatchEnabled: false });
      let r: WatchResult;
      if (off !== 'ERR' && off < 300) r = { riderId, outcome: 'OFF', status: off };
      else if (off === 409) {
        const nd = await this.send(riderId, { status: 'ON_DUTY', newDispatchEnabled: false });
        r = { riderId, outcome: nd !== 'ERR' && nd < 300 ? 'NO_DISPATCH' : 'FAILED', status: nd };
      } else r = { riderId, outcome: 'FAILED', status: off };
      this.log(`[sim-operation] ${why} → ${riderId} ${r.outcome === 'OFF' ? 'OFF_DUTY' : r.outcome === 'NO_DISPATCH' ? '진행 중 배송 — 신규배차만 끔' : '운행 상태를 못 바꿈 — 확인 필요'} (${r.status})`);
      out.push(r);
    }
    return out;
  }
}

/** 본문 {session, riders?} — 세션 ID 는 페이지가 만든 임의 문자열(영숫자·하이픈 64자 이하) */
export function parseWatchBody(raw: string): { session: string; riders: string[] } | null {
  try {
    const v = JSON.parse(raw) as { session?: unknown; riders?: unknown };
    if (typeof v.session !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(v.session)) return null;
    const riders = Array.isArray(v.riders) ? v.riders.filter((r): r is string => typeof r === 'string').slice(0, 20) : [];
    return { session: v.session, riders };
  } catch {
    return null;
  }
}
