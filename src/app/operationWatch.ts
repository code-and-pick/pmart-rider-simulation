// 실서버 운행 지킴이의 브라우저 쪽(개발 서버 server/operationWatch.ts, config OPERATION_WATCH).
// 운행 중이면 박자마다 맥박을 보내고, 페이지가 떠나면(pagehide — 탭 닫기·새로 고침·HMR 전체 새로 고침) 떠남을 알린다.
// 개발 서버가 "이미 멈춤 처리함"이라고 답하면(창이 멈춰 있던 동안 맥박이 끊김) 이 페이지도 운행 종료로 들어간다.
// 라이더 ID 만 보낸다(토큰 없음). 이 PC 만 — 다른 기기 요청은 개발 서버가 막는다.

import { OPERATION_WATCH } from '../config';
import { startTicker } from './controller';

export interface WatchedWorld {
  readonly operatingRiderIds: string[];
  stopByWatch(): void;
}

export function startOperationWatch(world: WatchedWorld, beatSec: number = OPERATION_WATCH.beatSec): () => void {
  const session = crypto.randomUUID();
  let watching = false;
  let stoppedByServer = false;
  let inFlight = false;
  const post = (kind: 'beat' | 'release', riders: string[]) =>
    fetch(`/sim-operation/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session, riders }) });

  const beat = () => {
    if (inFlight) return;
    const ids = world.operatingRiderIds;
    if (ids.length === 0) {
      if (!watching) return;
      watching = false;
      stoppedByServer = false;
      inFlight = true;
      void post('release', []).catch(() => undefined).finally(() => (inFlight = false));
      return;
    }
    watching = true;
    inFlight = true;
    void post('beat', ids)
      .then((r) => (r.ok ? (r.json() as Promise<{ stopped?: boolean }>) : null))
      .then((v) => {
        if (v?.stopped && !stoppedByServer) {
          stoppedByServer = true;
          world.stopByWatch();
        }
      })
      .catch(() => undefined) // 개발 서버가 꺼져 있으면 지킴이도 없다 — 운행은 그대로
      .finally(() => (inFlight = false));
  };

  const leave = () => {
    if (!watching) return;
    navigator.sendBeacon('/sim-operation/end', new Blob([JSON.stringify({ session })], { type: 'application/json' }));
  };

  // 박자는 Worker 타이머(가려진 탭에서 덜 늦춰짐) — 첫 맥박은 운행을 켠 뒤 다음 박자
  const stop = startTicker(beat, beatSec * 1000);
  window.addEventListener('pagehide', leave);
  return () => {
    stop();
    window.removeEventListener('pagehide', leave);
  };
}
