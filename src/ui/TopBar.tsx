import { useApp } from '../app/App';
import { seoulTime } from './format';

const SPEEDS = [1, 5, 20, 60];

/** 모드는 주소(?mode=http)로 고른다 — 바꾸면 페이지를 새로 연다(브라우저 저장소에 두지 않음). */
function switchMode(mode: 'mock' | 'http') {
  const q = new URLSearchParams(window.location.search);
  if (mode === 'http') q.set('mode', 'http');
  else q.delete('mode');
  const s = q.toString();
  window.location.search = s ? `?${s}` : '';
}

export function TopBar() {
  const app = useApp();
  const { sim } = app;
  const st = app.mapStatus;
  const real = sim.mode === 'http';
  return (
    <header className="topbar">
      <h1>PMart 배송·라이더 가상 현장</h1>
      <div className="seg" role="group" aria-label="모드">
        <button className={real ? '' : 'on'} aria-pressed={!real} onClick={() => real && switchMode('mock')}>
          MOCK
        </button>
        <button className={real ? 'on' : ''} aria-pressed={real} onClick={() => !real && switchMode('http')} title="실서버 읽기(P2) — 쓰기는 P3">
          실서버
        </button>
      </div>
      <button className="btn" onClick={() => app.togglePause()}>
        {sim.paused ? '▶ 재생' : '⏸ 정지'}
      </button>
      <div className="seg" role="group" aria-label="배속">
        {SPEEDS.map((x) => (
          <button
            key={x}
            className={sim.speed === x ? 'on' : ''}
            aria-pressed={sim.speed === x}
            disabled={!sim.canChangeSpeed && x !== 1}
            title={sim.canChangeSpeed ? undefined : '실서버는 실제 시각 1×'}
            onClick={() => app.setSpeed(x)}
          >
            {x}×
          </button>
        ))}
      </div>
      {!real && (
        <button className="btn" onClick={() => app.addRider()}>
          + 라이더
        </button>
      )}
      <button
        className={`btn ${app.scenarioOpen ? 'on' : ''}`}
        aria-pressed={app.scenarioOpen}
        disabled={!sim.tunable}
        title={sim.tunable ? '주문량·수락률·포장 시간·고객 부재·응답 끊김을 바꿔 실패 장면을 본다' : '실서버는 실제 결과만 — 조절하지 않는다'}
        onClick={() => app.toggleScenario()}
      >
        ⚙ 시나리오
      </button>
      {real && !sim.operating && (
        <button
          className="btn"
          disabled={sim.operationLock !== null}
          title={sim.operationLock ?? '가상 라이더를 실서버에서 움직인다(가입·운행·수락·인계·완료 = 쓰기)'}
          onClick={() => app.startOperation()}
        >
          가상 라이더 운행
        </button>
      )}
      {real && sim.operating && (
        <button className="btn warn" title="진행 중 배송은 끝낸 뒤 OFF_DUTY" onClick={() => app.stopOperation()}>
          운행 종료
        </button>
      )}
      <span className="clock" title={real ? '실제 시각(서울)' : '시뮬레이션 시각(서울)'}>
        {seoulTime(sim.clock.epochMs())}
      </span>
      <span className={`chip ${st.kind}`}>{st.kind === 'kakao' ? '카카오 지도' : st.kind === 'plane' ? '좌표 평면' : '지도 불러오는 중'}</span>
    </header>
  );
}
