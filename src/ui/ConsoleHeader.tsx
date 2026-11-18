import { useApp, type View } from '../app/App';
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

/**
 * 관제 머리(어두운 띠) — 왼쪽 이름·센터·데이터 출처, 가운데 보기(관제·운영 화면), 오른쪽 실시간 시각.
 * 시뮬레이터 조작(모드·정지·배속·라이더·시나리오·가상 라이더 운행)은 오른쪽 끝 한 묶음으로 — 관제 화면을 가리지 않게.
 */
export function ConsoleHeader({ view, onView }: { view: View; onView: (v: View) => void }) {
  const app = useApp();
  const { sim } = app;
  const real = sim.mode === 'http';
  const st = app.mapStatus;
  return (
    <header className="c-head">
      <div className="c-brand">
        <span className="c-logo" aria-hidden>
          P
        </span>
        <span className="c-title">PMart 배송 관제</span>
        <span className="c-center" title={`센터 ${sim.params.mfcId}`}>
          부산진구 MFC
        </span>
        <span className={`c-src ${real ? 'real' : 'mock'}`} title={real ? '실서버(LAN 백엔드)에서 읽은 값' : '가상(MOCK) — 시뮬레이터가 흉내 낸 값'}>
          {real ? '실서버' : '가상(MOCK)'}
        </span>
      </div>
      <nav className="c-views" role="tablist" aria-label="보기">
        <button role="tab" aria-selected={view === 'field'} className={view === 'field' ? 'on' : ''} onClick={() => onView('field')}>
          지도 관제
        </button>
        <button role="tab" aria-selected={view === 'riders'} className={view === 'riders' ? 'on' : ''} onClick={() => onView('riders')} title="라이더 관제 표 — 라이더 백오피스 라이더 관제와 같은 내용">
          라이더 관제
        </button>
      </nav>
      <div className="c-right">
        <span className="c-clock" title={real ? '실제 시각(서울)' : '시뮬레이션 시각(서울)'}>
          <span className={`c-live ${sim.paused ? 'paused' : ''}`} />
          {seoulTime(sim.clock.epochMs())}
          {!real && sim.speed !== 1 && <span className="c-speed">{sim.speed}×</span>}
        </span>
        <div className="c-sim" role="group" aria-label="시뮬레이터 조작">
          <div className="c-seg" role="group" aria-label="모드">
            <button className={real ? '' : 'on'} aria-pressed={!real} onClick={() => real && switchMode('mock')} title="가상 현장(MOCK)">
              MOCK
            </button>
            <button className={real ? 'on' : ''} aria-pressed={real} onClick={() => !real && switchMode('http')} title="실서버 읽기">
              실서버
            </button>
          </div>
          <button className="c-btn" onClick={() => app.togglePause()} title={sim.paused ? '다시 진행' : '멈춤(화면 갱신·시뮬레이션)'}>
            {sim.paused ? '▶' : '❚❚'}
          </button>
          {sim.canChangeSpeed && (
            <div className="c-seg" role="group" aria-label="배속">
              {SPEEDS.map((x) => (
                <button key={x} className={sim.speed === x ? 'on' : ''} aria-pressed={sim.speed === x} onClick={() => app.setSpeed(x)}>
                  {x}×
                </button>
              ))}
            </div>
          )}
          {!real && (
            <button className="c-btn" onClick={() => app.addRider()} title="가상 라이더 한 명 더">
              + 라이더
            </button>
          )}
          {sim.tunable && (
            <button
              className={`c-btn ${app.scenarioOpen ? 'on' : ''}`}
              aria-pressed={app.scenarioOpen}
              onClick={() => app.toggleScenario()}
              title="주문량·수락률·포장 시간·고객 부재·라이더 취소·위치 끊김·응답 끊김을 바꿔 실패 장면을 본다"
            >
              시나리오
            </button>
          )}
          {real && !sim.operating && (
            <button
              className="c-btn"
              disabled={sim.operationLock !== null}
              title={sim.operationLock ?? '가상 라이더를 실서버에서 움직인다(가입·운행·수락·인계·완료 = 쓰기)'}
              onClick={() => app.startOperation()}
            >
              가상 라이더 운행
            </button>
          )}
          {real && sim.operating && (
            <button className="c-btn warn" title="진행 중 배송은 끝낸 뒤 OFF_DUTY" onClick={() => app.stopOperation()}>
              운행 종료
            </button>
          )}
        </div>
        <span className={`c-map ${st.kind}`} title={st.kind === 'plane' ? `좌표 평면 대체 화면(${st.reason})` : undefined}>
          {st.kind === 'kakao' ? '카카오 지도' : st.kind === 'plane' ? '좌표 평면' : '지도 불러오는 중'}
        </span>
      </div>
    </header>
  );
}
