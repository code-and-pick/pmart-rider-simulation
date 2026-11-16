import { useApp } from '../app/App';
import { seoulTime } from './format';

const SPEEDS = [1, 5, 20, 60];

export function TopBar() {
  const app = useApp();
  const { sim } = app;
  const st = app.mapStatus;
  return (
    <header className="topbar">
      <h1>PMart 배송·라이더 가상 현장</h1>
      <div className="seg" role="group" aria-label="모드">
        <button className="on" aria-pressed="true">MOCK</button>
        <button disabled title="실서버 모드는 P2">실서버</button>
      </div>
      <button className="btn" onClick={() => app.togglePause()}>
        {sim.paused ? '▶ 재생' : '⏸ 정지'}
      </button>
      <div className="seg" role="group" aria-label="배속">
        {SPEEDS.map((x) => (
          <button key={x} className={sim.speed === x ? 'on' : ''} aria-pressed={sim.speed === x} onClick={() => app.setSpeed(x)}>
            {x}×
          </button>
        ))}
      </div>
      <button className="btn" onClick={() => app.addRider()}>
        + 라이더
      </button>
      <span className="clock" title="시뮬레이션 시각(서울)">
        {seoulTime(sim.clock.epochMs())}
      </span>
      <span className={`chip ${st.kind}`}>{st.kind === 'kakao' ? '카카오 지도' : st.kind === 'plane' ? '좌표 평면' : '지도 불러오는 중'}</span>
    </header>
  );
}
