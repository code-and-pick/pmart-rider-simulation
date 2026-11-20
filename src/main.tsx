import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { AppController } from './app/controller';
import { DEFAULT_PARAMS, REAL_RIDER_GATE } from './config';
import { RealWorld } from './sim/realWorld';
import { DevServerGeocoder } from './sim/geocode';
import { DevServerRoutes } from './sim/route';
import { Simulation } from './sim/simulation';
import type { World } from './sim/world';
import './ui/styles.css';
import './ui/console.css';
import './ui/console-v2.css';
import './ui/rider-board.css';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './ui/theme.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root 가 없다');

// 모드는 주소로: 기본 MOCK, ?mode=http 면 실서버 읽기(P2 — 쓰기는 P3)
const query = new URLSearchParams(window.location.search);
const mode = query.get('mode') === 'http' ? 'http' : 'mock';
// 번호로 인계 비율은 주소로도: ?codeRate=1 (0~1). 실서버는 조절 바가 없어 이것으로만 바꾼다.
const codeRateRaw = query.get('codeRate');
const codeRate = codeRateRaw === null || codeRateRaw.trim() === '' ? NaN : Number(codeRateRaw);
const codeParams = Number.isFinite(codeRate) && codeRate >= 0 && codeRate <= 1 ? { handoverByCodeRate: codeRate } : {};
// 이동 경로 = 개발 서버 /sim-route(카카오모빌리티 도로 경로 — 키는 서버에만). 못 받으면 직선.
const routes = new DevServerRoutes();
let world: World;
if (mode === 'http') {
  // 다시 배송 전달지(핀 없음)는 개발 서버 카카오 주소 검색으로 찾는다(이 PC 만 — 다른 기기는 운행하지 않음)
  const geocoder = new DevServerGeocoder();
  void geocoder.refresh();
  world = new RealWorld({ ...DEFAULT_PARAMS, ...codeParams, mode: 'http' }, REAL_RIDER_GATE, routes, { locator: geocoder });
} else {
  const sim = new Simulation({ ...DEFAULT_PARAMS, ...codeParams }, { routes });
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
