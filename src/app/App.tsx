import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AnalyzePage } from '../ui/AnalyzePage';
import { ConsoleHeader } from '../ui/ConsoleHeader';
import { DeliveryListPanel, LogsPage } from '../ui/ConsolePanel';
import { FlowBar } from '../ui/FlowBar';
import { FILTER_LABEL, type OpsFilter } from '../ui/ops';
import { MapDetail } from '../ui/MapDetail';
import { RiderHead, RiderList, RiderPanel } from '../ui/RiderBoard';
import { RecentDeliveries, RiderControlPage } from '../ui/RiderControlPage';
import { ScenarioBar } from '../ui/ScenarioBar';
import { PHASE_COLOR } from '../render/colors';
import type { AppController, AppView } from './controller';

const Ctx = createContext<AppController | null>(null);

export function useApp(): AppController {
  const c = useContext(Ctx);
  if (!c) throw new Error('AppController 없음');
  // 약 4Hz 박자로 다시 그린다 — 라이더 위치(매 프레임)는 지도가 직접 옮긴다
  useSyncExternalStore(c.ticker.subscribe, c.ticker.getVersion);
  return c;
}

/** 왼쪽 메뉴 화면 — 지도는 숨기기만 한다(떼지 않음 — 시뮬레이션은 계속 돈다). */
export type View = AppView;

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
  ['control', '🛵', '라이더 관제'],
  ['field', '🗺', '배송 관제'],
  ['riders', '☰', '목록 관제'],
  ['analyze', '▥', '분석'],
  ['logs', '⧉', '기록'],
];

/**
 * 관제 화면 뼈대(Onfleet 대시보드·바로고 허브컨트롤룸을 참고 — docs/worklog 2026-11-19):
 *   [왼쪽 아이콘 메뉴 | 머리 → (라이더 관제 — 기본) 숫자 카드 → [라이더 목록 | 지도 | 라이더 상세] / (배송 관제) 숫자 카드 → [지도 | 오른쪽 관제 패널] / 목록 관제 / 분석 / 기록]
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
  // 지도는 라이더 관제(기본)·배송 관제가 같이 쓴다 — 옆 칸만 바뀐다(지도를 떼지 않음)
  const control = view === 'control';
  return (
    <>
      {control && <RiderHead />}
      {view === 'field' && <FlowBar />}
      {(control || view === 'field') && <ScenarioSlot />}
      <div className={`c-main ${control ? 'rb-main' : 'dd-main'}`} hidden={!control && view !== 'field'}>
        {control ? <RiderList /> : <DeliveryListPanel />}
        <MapView panelOpen={panelOpen} onPanel={onPanel} noPanel mode={control ? 'rider' : 'delivery'} />
        {control ? <RiderPanel /> : <DeliveryDetailSlot />}
      </div>
      {control && (
        <section className="rb-recent" aria-label="최근 배송">
          <RecentDeliveries onOpen={(id) => app.selectDelivery(id, true)} />
        </section>
      )}
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

/** 라이더 관제 지도 범례 — 라이더 이름표 색(controller CONTROL_COLOR 와 같은 값) */
const CONTROL_LEGEND: readonly (readonly [string, string])[] = [
  ['대기', '#16a34a'],
  ['배송 중', '#2563eb'],
  ['위치 끊김', '#ea7a0c'],
  ['쉬는 중', '#94a3b8'],
];

/** 배송 관제 오른쪽 칸 — 고른 배송 상세를 크게(없으면 안내) */
function DeliveryDetailSlot() {
  const app = useApp();
  if (!app.selectedDelivery) {
    return (
      <aside className="rb-panel empty" aria-label="배송 상세">
        왼쪽 목록이나 지도에서 배송을 고르면 상세(주문·흐름·배차 제안·원래 상태)가 여기에 크게 보여요.
      </aside>
    );
  }
  return <MapDetail variant="panel" />;
}

function MapView(p: { panelOpen: boolean; onPanel: () => void; noPanel?: boolean; mode: 'rider' | 'delivery' }) {
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
    <section className={`c-map-wrap ${p.mode === 'rider' ? 'rb-map' : ''}`} aria-label="지도">
      <div ref={ref} className="map" />
      <div className="c-legend" aria-label="지도 범례">
        {(p.mode === 'rider' ? CONTROL_LEGEND : LEGEND).map(([l, c]) => (
          <span key={l}>
            <i style={{ background: c }} />
            {l}
          </span>
        ))}
        <span className="c-legend-line" title="도로 경로(카카오모빌리티) — 점선이면 직선(도로 경로를 못 받음)">
          <i className="solid" />
          경로
        </span>
        {p.mode === 'delivery' && f && f !== 'failedCalls' && <span className="c-legend-f">핀: {filterName(f)}만</span>}
        {st.kind === 'plane' && <span className="c-legend-f">좌표 평면 대체 화면</span>}
      </div>
      {p.mode === 'rider' && <MapDetail />}
      {!p.noPanel && (
      <button className={`c-panel-toggle ${p.panelOpen ? 'open' : ''}`} onClick={p.onPanel} aria-expanded={p.panelOpen} title={p.panelOpen ? '패널 접기 — 지도 넓게 ( ] )' : '패널 펴기 ( ] )'}>
        {p.panelOpen ? '›' : (
          <>
            ‹ 패널{b.alerts.length > 0 && <span className="c-pill red">{b.alerts.length}</span>}
          </>
        )}
      </button>
      )}
    </section>
  );
}

function filterName(f: OpsFilter): string {
  return FILTER_LABEL[f] ?? f;
}
