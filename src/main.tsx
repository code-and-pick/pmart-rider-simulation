import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { AppController } from './app/controller';
import { DEFAULT_PARAMS, REAL_RIDER_GATE } from './config';
import { RealWorld } from './sim/realWorld';
import { DevServerRoutes } from './sim/route';
import { Simulation } from './sim/simulation';
import type { World } from './sim/world';
import './ui/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root 가 없다');

// 모드는 주소로: 기본 MOCK, ?mode=http 면 실서버 읽기(P2 — 쓰기는 P3)
const mode = new URLSearchParams(window.location.search).get('mode') === 'http' ? 'http' : 'mock';
// 이동 경로 = 개발 서버 /sim-route(카카오모빌리티 도로 경로 — 키는 서버에만). 못 받으면 직선.
const routes = new DevServerRoutes();
let world: World;
if (mode === 'http') {
  world = new RealWorld({ ...DEFAULT_PARAMS, mode: 'http' }, REAL_RIDER_GATE, routes);
} else {
  const sim = new Simulation({ ...DEFAULT_PARAMS }, { routes });
  sim.startRiders();
  world = sim;
}
const controller = new AppController(world);
controller.start();

// 실서버 가상 라이더가 운행 중일 때 탭을 닫으면 ON_DUTY 로 남는다 — 아무도 움직이지 않는 라이더에게 실제 제안이 간다. 닫기 전에 묻는다.
window.addEventListener('beforeunload', (e) => {
  if (world.operating) e.preventDefault();
});

createRoot(root).render(
  <StrictMode>
    <App controller={controller} />
  </StrictMode>,
);
