import { useApp, type View } from '../app/App';
import { seoulTime } from './format';
import { Icon } from './Icon';

const SPEEDS = [1, 5, 20, 60];

/** 모드는 주소(?mode=http)로 고른다 — 바꾸면 페이지를 새로 연다(브라우저 저장소에 두지 않음). */
function switchMode(mode: 'mock' | 'http') {
  const q = new URLSearchParams(window.location.search);
  if (mode === 'http') q.set('mode', 'http');
  else q.delete('mode');
  const s = q.toString();
  window.location.search = s ? `?${s}` : '';
}

const TITLE: Record<View, string> = { control: '실시간 관제', field: '배송 관리', riders: '목록 관리', analyze: '분석', logs: '기록' };

/**
 * 관제 머리 — 왼쪽 지금 화면 이름·센터·데이터 출처·라이더 수(바로고 리뷰 "전체 라이더 숫자"), 오른쪽 실시간 시각.
 * 화면 바꾸기는 왼쪽 아이콘 메뉴(App Rail). 시뮬레이터 조작은 오른쪽 끝 한 묶음 — 관제 화면을 가리지 않게.
 */
export function ConsoleHeader() {
  const app = useApp();
  const { sim } = app;
  const real = sim.mode === 'http';
  const st = app.mapStatus;
  const b = app.board();
  return (
    <header className="c-head">
      <div className="c-brand">
        <span className="c-title">{TITLE[app.view]}</span>
        <span className="c-crumb" aria-hidden>
          ›
        </span>
        <span className="c-center" title={`센터 ${sim.params.mfcId}`}>
          부산진구 MFC
        </span>
        <span className={`c-src ${real ? 'real' : 'mock'}`} title={real ? '실서버(LAN 백엔드)에서 읽은 값' : '가상(MOCK) — 시뮬레이터가 흉내 낸 값'}>
          {real ? '실서버' : '가상(MOCK)'}
        </span>
        <span className="c-head-stat" title="운행 화면에 보이는 라이더 — 배송 중 / 전체">
          라이더 <b>{b.riders.busy}</b>/{b.riders.total}
          {b.riders.stale > 0 && <em> · 끊김 {b.riders.stale}</em>}
        </span>
      </div>
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
          <Icon name="map" size={15} />
          {st.kind === 'kakao' ? '카카오 지도' : st.kind === 'plane' ? '좌표 평면' : '지도 불러오는 중'}
        </span>
      </div>
    </header>
  );
}
