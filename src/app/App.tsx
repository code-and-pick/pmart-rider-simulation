import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AnalyzePage } from '../ui/AnalyzePage';
import { ConsoleHeader } from '../ui/ConsoleHeader';
import { ConsolePanel, LogsPage } from '../ui/ConsolePanel';
import { KpiCards } from '../ui/KpiCards';
import { MapDetail } from '../ui/MapDetail';
import { RiderControlPage } from '../ui/RiderControlPage';
import { ScenarioBar } from '../ui/ScenarioBar';
import { PHASE_COLOR } from '../render/colors';
import type { AppController } from './controller';

const Ctx = createContext<AppController | null>(null);

export function useApp(): AppController {
  const c = useContext(Ctx);
  if (!c) throw new Error('AppController 없음');
  // 약 4Hz 박자로 다시 그린다 — 라이더 위치(매 프레임)는 지도가 직접 옮긴다
  useSyncExternalStore(c.ticker.subscribe, c.ticker.getVersion);
  return c;
}

/** 왼쪽 메뉴 화면 — 지도는 숨기기만 한다(떼지 않음 — 시뮬레이션은 계속 돈다). */
export type View = 'field' | 'riders' | 'analyze' | 'logs';

/** 이 브라우저에 기억하는 편의 설정(못 읽으면 기본값) */
function useStored<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key) as T | null;
      return s && allowed.includes(s) ? s : fallback;
    } catch {
      return fallback;
    }
  });
  const set = (n: T) => {
    setV(n);
    try {
      localStorage.setItem(key, n);
    } catch {
      /* 저장 못 해도 이번 화면에선 바뀐다 */
    }
  };
  return [v, set];
}

const RAIL: readonly (readonly [View, string, string])[] = [
  ['field', '🗺', '지도 관제'],
  ['riders', '☰', '목록 관제'],
  ['analyze', '▥', '분석'],
  ['logs', '⧉', '기록'],
];

/**
 * 관제 화면 뼈대(Onfleet 대시보드·바로고 허브컨트롤룸을 참고 — docs/worklog 2026-11-19):
 *   [왼쪽 아이콘 메뉴 | 머리 → (지도 관제) 숫자 카드 → [지도 | 오른쪽 관제 패널] / 목록 관제 / 분석 / 기록]
 * 기본 어두운 테마(전환 가능). 패널은 ] 키나 지도 오른쪽 가장자리 버튼으로 접는다.
 */
export function App({ controller }: { controller: AppController }) {
  const [panel, setPanel] = useStored<'open' | 'closed'>('rider-sim.panel', 'open', ['open', 'closed']);
  const [theme, setTheme] = useStored<'dark' | 'light'>('rider-sim.theme', 'dark', ['dark', 'light']);
  const panelOpen = panel === 'open';
  const togglePanel = () => setPanel(panelOpen ? 'closed' : 'open');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === ']') togglePanel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <Ctx.Provider value={controller}>
      <div className="c-app" data-theme={theme}>
        <Rail theme={theme} onTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
        <div className="c-shell">
          <ConsoleHeader />
          <Views panelOpen={panelOpen} onPanel={togglePanel} />
        </div>
      </div>
    </Ctx.Provider>
  );
}

/** 왼쪽 아이콘 메뉴(Onfleet) — 화면 바꾸기, 맨 아래 테마 */
function Rail({ theme, onTheme }: { theme: 'dark' | 'light'; onTheme: () => void }) {
  const app = useApp();
  const alerts = app.board().alerts.length;
  return (
    <nav className="c-rail" aria-label="화면">
      <span className="c-logo" aria-hidden>
        P
      </span>
      {RAIL.map(([v, icon, label]) => (
        <button key={v} className={app.view === v ? 'on' : ''} aria-current={app.view === v ? 'page' : undefined} onClick={() => app.setView(v)} title={label}>
          <span className="c-rail-i" aria-hidden>
            {icon}
          </span>
          <span className="c-rail-l">{label}</span>
          {v === 'field' && alerts > 0 && <span className="c-rail-badge">{alerts}</span>}
        </button>
      ))}
      <button className="c-rail-theme" onClick={onTheme} title={theme === 'dark' ? '밝은 화면으로' : '어두운 화면으로'}>
        <span className="c-rail-i" aria-hidden>
          {theme === 'dark' ? '☀' : '☾'}
        </span>
        <span className="c-rail-l">{theme === 'dark' ? '밝게' : '어둡게'}</span>
      </button>
    </nav>
  );
}

function Views({ panelOpen, onPanel }: { panelOpen: boolean; onPanel: () => void }) {
  const app = useApp();
  const view = app.view;
  return (
    <>
      {view === 'field' && <KpiCards />}
      {view === 'field' && <ScenarioSlot />}
      <div className={`c-main ${panelOpen ? '' : 'closed'}`} hidden={view !== 'field'}>
        <MapView panelOpen={panelOpen} onPanel={onPanel} />
        {panelOpen && <ConsolePanel />}
      </div>
      {view === 'riders' && <RiderControlPage onShowOnMap={() => app.setView('field')} />}
      {view === 'analyze' && <AnalyzePage />}
      {view === 'logs' && <LogsPage />}
    </>
  );
}

function ScenarioSlot() {
  const app = useApp();
  return app.scenarioOpen && app.sim.tunable ? <ScenarioBar /> : null;
}

/** 지도 범례 — 라이더 단계 색(지도 마커 고리)과 경로선 */
const LEGEND: readonly (readonly [string, string])[] = [
  ['대기', PHASE_COLOR.IDLE],
  ['MFC로', PHASE_COLOR.TO_STORE],
  ['가게', PHASE_COLOR.AT_STORE_WAIT_READY],
  ['고객에게', PHASE_COLOR.TO_CUSTOMER],
  ['전달', PHASE_COLOR.AT_CUSTOMER],
];

function MapView(p: { panelOpen: boolean; onPanel: () => void }) {
  const app = useApp();
  const b = app.board();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    void app.attachMap(el);
    return () => app.detachMap();
  }, [app]);
  const st = app.mapStatus;
  const f = app.filter;
  return (
    <section className="c-map-wrap" aria-label="지도">
      <div ref={ref} className="map" />
      <div className="c-legend" aria-label="지도 범례">
        {LEGEND.map(([l, c]) => (
          <span key={l}>
            <i style={{ background: c }} />
            {l}
          </span>
        ))}
        <span className="c-legend-line" title="도로 경로(카카오모빌리티) — 점선이면 직선(도로 경로를 못 받음)">
          <i className="solid" />
          경로
        </span>
        {f && f !== 'failedCalls' && <span className="c-legend-f">핀: {filterName(f)}만</span>}
        {st.kind === 'plane' && <span className="c-legend-f">좌표 평면 대체 화면</span>}
      </div>
      <MapDetail />
      <button className={`c-panel-toggle ${p.panelOpen ? 'open' : ''}`} onClick={p.onPanel} aria-expanded={p.panelOpen} title={p.panelOpen ? '패널 접기 — 지도 넓게 ( ] )' : '패널 펴기 ( ] )'}>
        {p.panelOpen ? '›' : (
          <>
            ‹ 패널{b.alerts.length > 0 && <span className="c-pill red">{b.alerts.length}</span>}
          </>
        )}
      </button>
    </section>
  );
}

function filterName(f: string): string {
  return { active: '진행 중', searching: '찾는 중', delivering: '배송 중', delayed: '지연', done: '완료', failed: '실패', dispatchFailed: '배차 실패', deliveryFailed: '전달 실패' }[f] ?? f;
}
