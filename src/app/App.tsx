import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { LeftPanel } from '../ui/LeftPanel';
import { OpsPanel } from '../ui/OpsPanel';
import { RightPanel } from '../ui/RightPanel';
import { ScenarioBar } from '../ui/ScenarioBar';
import { TopBar } from '../ui/TopBar';
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

export function App({ controller }: { controller: AppController }) {
  const [view, setView] = useState<View>('field');
  return (
    <Ctx.Provider value={controller}>
      <div className="app">
        <TopBar view={view} onView={setView} />
        {view === 'field' && <ScenarioSlot />}
        <div className="body" hidden={view !== 'field'}>
          <LeftPanel />
          <MapView />
          <RightPanel />
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

function MapView() {
  const app = useApp();
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
    </section>
  );
}
