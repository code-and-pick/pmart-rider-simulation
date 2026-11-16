import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { AppController } from './app/controller';
import { DEFAULT_PARAMS } from './config';
import { Simulation } from './sim/simulation';
import './ui/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root 가 없다');

// MOCK 시뮬레이션 — 실서버 모드(HttpBackend)는 P2
const sim = new Simulation({ ...DEFAULT_PARAMS });
sim.startRiders();
const controller = new AppController(sim);
controller.start();

createRoot(root).render(
  <StrictMode>
    <App controller={controller} />
  </StrictMode>,
);
