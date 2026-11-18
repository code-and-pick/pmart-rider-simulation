import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { LeftPanel } from '../ui/LeftPanel';
import { OpsPanel } from '../ui/OpsPanel';
import { RightPanel } from '../ui/RightPanel';
import { ScenarioBar } from '../ui/ScenarioBar';
import { TopBar } from '../ui/TopBar';
import { KpiBar } from '../ui/KpiBar';
import type { AppController } from './controller';

const Ctx = createContext<AppController | null>(null);

export function useApp(): AppController {
  const c = useContext(Ctx);
  if (!c) throw new Error('AppController 없음');
  // 약 4Hz 박자로 다시 그린다 — 라이더 위치(매 프레임)는 지도가 직접 옮긴다
  useSyncExternalStore(c.ticker.subscribe, c.ticker.getVersion);
  return c;
}

/** 위쪽 탭: 가상 현장(지도) / 운영 화면(라이더 백오피스 목록). 지도는 숨기기만 한다(떼지 않음 — 시뮬레이션은 계속 돈다). */
export type View = 'field' | 'ops';

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

export function App({ controller }: { controller: AppController }) {
  const [view, setView] = useState<View>('field');
  const [leftOpen, toggleLeft] = usePanelOpen('rider-sim.panel.left');
  const [rightOpen, toggleRight] = usePanelOpen('rider-sim.panel.right');
  // 단축키 [ ] — 입력 칸에 쓰는 중이면 무시
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === '[') toggleLeft();
      else if (e.key === ']') toggleRight();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <Ctx.Provider value={controller}>
      <div className="app">
        <TopBar view={view} onView={setView} />
        {view === 'field' && <KpiBar />}
        {view === 'field' && <ScenarioSlot />}
        <div className={`body ${leftOpen ? '' : 'left-closed'} ${rightOpen ? '' : 'right-closed'}`} hidden={view !== 'field'}>
          {leftOpen && <LeftPanel />}
          <MapView leftOpen={leftOpen} rightOpen={rightOpen} onLeft={toggleLeft} onRight={toggleRight} />
          {rightOpen && <RightPanel />}
        </div>
        {view === 'ops' && <OpsPanel />}
      </div>
    </Ctx.Provider>
  );
}

function ScenarioSlot() {
  const app = useApp();
  return app.scenarioOpen && app.sim.tunable ? <ScenarioBar /> : null;
}

function MapView(p: { leftOpen: boolean; rightOpen: boolean; onLeft: () => void; onRight: () => void }) {
  const app = useApp();
  const b = app.board();
  const riders = app.sim.riders;
  const busy = b.riders.busy;
  const active = b.counts.active;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    void app.attachMap(el);
    return () => app.detachMap();
  }, [app]);
  const st = app.mapStatus;
  return (
    <section className="map-wrap" aria-label="지도">
      <div ref={ref} className="map" />
      <div className="map-legend">
        <span className="legend-solid" /> 도로 경로(카카오모빌리티, 자동차 기준) <span className="legend-dash" /> 직선 — 도로 경로 아님
        {st.kind === 'plane' && <span className="map-fallback"> · 좌표 평면 대체 화면({st.reason})</span>}
      </div>
      {/* 패널 열고 닫기 — 닫으면 지도가 넓어진다. 단축키 [ ] */}
      <button
        className={`panel-toggle left ${p.leftOpen ? 'open' : ''}`}
        onClick={p.onLeft}
        aria-expanded={p.leftOpen}
        title={p.leftOpen ? '라이더 목록 닫기 — 지도 넓게 ( [ )' : '라이더 목록 열기 ( [ )'}
      >
        {p.leftOpen ? '◀' : (
          <>
            ▶ 라이더 <b>{riders.length}</b>
            {busy > 0 && <span className="pt-badge">배송 중 {busy}</span>}
          </>
        )}
      </button>
      <button
        className={`panel-toggle right ${p.rightOpen ? 'open' : ''}`}
        onClick={p.onRight}
        aria-expanded={p.rightOpen}
        title={p.rightOpen ? '정보 닫기 — 지도 넓게 ( ] )' : '정보(배송·주문·기록) 열기 ( ] )'}
      >
        {p.rightOpen ? '▶' : (
          <>
            정보 ◀{active > 0 && <span className="pt-badge">진행 중 {active}</span>}
          </>
        )}
      </button>
    </section>
  );
}
