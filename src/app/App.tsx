import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ConsoleHeader } from '../ui/ConsoleHeader';
import { ConsolePanel } from '../ui/ConsolePanel';
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

/** 위쪽 보기: 관제(지도) / 라이더 관제(표 — 백오피스 라이더 관제와 같은 내용). 지도는 숨기기만 한다(떼지 않음 — 시뮬레이션은 계속 돈다). */
export type View = 'field' | 'riders';

/** 패널 열림 기억(이 브라우저만 — 편의용, 못 읽으면 열림) */
function usePanelOpen(key: string): [boolean, () => void] {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(key) !== '0';
    } catch {
      return true;
    }
  });
  const toggle = () =>
    setOpen((v) => {
      try {
        localStorage.setItem(key, v ? '0' : '1');
      } catch {
        /* 저장 못 해도 화면은 그대로 */
      }
      return !v;
    });
  return [open, toggle];
}

/**
 * 관제 화면 배치(Onfleet·Locus·PayBell 관제를 참고 — docs/worklog 2026-11-18 16:45):
 *   어두운 머리 → 큰 숫자 카드 한 줄 → [지도(넓게) | 오른쪽 관제 패널(이상 상황 · 배송/라이더/기록 탭)]
 * 패널은 ] 키나 지도 오른쪽 가장자리 버튼으로 접어 지도를 넓게 본다.
 */
export function App({ controller }: { controller: AppController }) {
  const [view, setView] = useState<View>('field');
  const [panelOpen, togglePanel] = usePanelOpen('rider-sim.panel.right');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === ']') togglePanel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <Ctx.Provider value={controller}>
      <div className="c-app">
        <ConsoleHeader view={view} onView={setView} />
        {view === 'field' && <KpiCards />}
        {view === 'field' && <ScenarioSlot />}
        <div className={`c-main ${panelOpen ? '' : 'closed'}`} hidden={view !== 'field'}>
          <MapView panelOpen={panelOpen} onPanel={togglePanel} />
          {panelOpen && <ConsolePanel />}
        </div>
        {view === 'riders' && <RiderControlPage onShowOnMap={() => setView('field')} />}
      </div>
    </Ctx.Provider>
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
