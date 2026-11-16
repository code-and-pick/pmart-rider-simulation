// 화면 제어: 시뮬레이션 진행 박자, 지도 바탕 고르기(카카오 / 좌표 평면), 지도 동기화, 선택.
// 매 프레임 라이더 위치는 지도 오버레이를 직접 옮기고(React 아님), 패널은 약 4Hz(params.panelHz)로만 다시 그린다.

import { CONTRACT } from '../config';
import { customerColor, PHASE_COLOR } from '../render/colors';
import { loadKakaoMaps } from '../render/kakao';
import { KakaoSurface } from '../render/KakaoSurface';
import { PlaneSurface } from '../render/PlaneSurface';
import type { MapSurface } from '../render/surface';
import type { World } from '../sim/world';

/** useSyncExternalStore 로 구독하는 작은 변경 알림. */
export class Emitter {
  private readonly listeners = new Set<() => void>();
  private version = 0;
  readonly subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  readonly getVersion = () => this.version;
  emit() {
    this.version++;
    for (const l of this.listeners) l();
  }
}

/**
 * intervalMs 마다 fn 을 부른다. 가능하면 전용 Worker 의 타이머로(가려진 탭에서 덜 늦춰짐), 안 되면 setInterval.
 * Worker 코드는 한 줄짜리 Blob — 외부 파일·외부 주소를 불러오지 않는다. 돌려주는 함수로 멈춘다.
 */
export function startTicker(fn: () => void, intervalMs: number): () => void {
  try {
    const src = `setInterval(() => postMessage(0), ${Math.max(10, Math.floor(intervalMs))});`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const w = new Worker(url);
    w.onmessage = () => fn();
    return () => {
      w.terminate();
      URL.revokeObjectURL(url);
    };
  } catch {
    const id = window.setInterval(fn, intervalMs);
    return () => window.clearInterval(id);
  }
}

export type MapStatus = { kind: 'loading' } | { kind: 'kakao' } | { kind: 'plane'; reason: string };

const DONE_STATES = new Set(['CLOSED', 'CANCELLED_BEFORE_PICKUP', 'DISPATCH_FAILED', 'BLOCKED']);
/** 끝난 배송 핀을 지도에 남겨 두는 시간(시뮬 초) [시뮬] */
const KEEP_DONE_SEC = 90;

export class AppController {
  /** 패널 다시 그리기 박자 */
  readonly ticker = new Emitter();
  mapStatus: MapStatus = { kind: 'loading' };
  selected: string | null = null;
  private surface: MapSurface | null = null;
  private raf = 0;
  private lastBump = 0;
  private busy = false;
  private readonly doneAt = new Map<string, number>();

  /** MOCK 이면 Simulation, 실서버면 RealWorld */
  constructor(readonly sim: World) {}

  async attachMap(container: HTMLElement): Promise<void> {
    // React StrictMode 는 개발 중 붙이기 → 떼기 → 붙이기를 한다. SDK 를 기다리는 사이 떼어졌으면 그 붙이기는 버린다.
    const gen = ++this.mapGen;
    const center = this.sim.params.mfcLocation;
    const onClick = (id: string) => this.select(id);
    let surface: MapSurface;
    try {
      const k = await loadKakaoMaps(import.meta.env.VITE_KAKAO_JS_KEY);
      if (gen !== this.mapGen) return;
      surface = new KakaoSurface(k, container, center, onClick);
      this.mapStatus = { kind: 'kakao' };
    } catch (e) {
      if (gen !== this.mapGen) return;
      container.innerHTML = '';
      surface = new PlaneSurface(container, center, onClick);
      this.mapStatus = { kind: 'plane', reason: e instanceof Error ? e.message : String(e) };
    }
    surface.setMfc(center, this.sim.params.mfcId, CONTRACT.radiusStepsKm);
    this.surface = surface;
    this.ticker.emit();
  }

  detachMap() {
    this.mapGen++;
    this.surface?.destroy();
    this.surface = null;
  }

  private mapGen = 0;

  /**
   * 시뮬레이션 진행은 타이머(50ms), 그리기는 requestAnimationFrame — 둘을 나눈다.
   * rAF 는 창이 가려지면 초당 몇 번으로 줄어 시뮬 시각이 밀리기 때문(2026-11-16 확인 — 자동화 창에서 1.5회/초).
   */
  start() {
    if (this.raf) return;
    this.lastStep = performance.now();
    const step = () => {
      if (this.busy) return;
      const t = performance.now();
      const dt = (t - this.lastStep) / 1000;
      this.lastStep = t;
      this.busy = true;
      void this.sim.advance(dt).finally(() => {
        this.busy = false;
      });
    };
    // 탭이 가려지면 브라우저가 화면 쪽 타이머를 늦춘다(오래 가려지면 분당 1회까지). 전용 Worker 의 타이머는 그만큼 늦추지 않아서
    // 박자를 Worker 에서 받는다 — 실서버 가상 라이더의 위치 업로드가 끊기지 않게(3분 끊김 = RiderLocationStale). [미검증: 가려진 탭에서 실측 안 함]
    this.stopTicker = startTicker(step, 50);
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      this.syncMap();
      if (t - this.lastBump >= 1000 / this.sim.params.panelHz) {
        this.lastBump = t;
        this.ticker.emit();
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.stopTicker?.();
    this.stopTicker = null;
    this.raf = 0;
  }

  startOperation() {
    this.sim.startOperation();
    this.ticker.emit();
  }

  stopOperation() {
    this.sim.stopOperation();
    this.ticker.emit();
  }

  private stopTicker: (() => void) | null = null;
  private lastStep = 0;

  select(id: string | null) {
    this.selected = id;
    const r = id ? this.sim.riders.find((x) => x.id === id) : undefined;
    if (r?.pos) this.surface?.panTo(r.pos);
    this.ticker.emit();
  }

  setSpeed(x: number) {
    if (!this.sim.canChangeSpeed) return;
    this.sim.speed = x;
    this.ticker.emit();
  }

  togglePause() {
    this.sim.paused = !this.sim.paused;
    this.ticker.emit();
  }

  addRider() {
    this.sim.addRider();
    this.ticker.emit();
  }

  /** 지도 위 물체를 시뮬레이션 상태에 맞춘다 — 매 프레임. */
  private syncMap() {
    const s = this.surface;
    if (!s) return;
    for (const r of this.sim.riders) {
      if (!r.pos) {
        s.removeRider(r.id);
        s.removeRoute(r.id);
        continue;
      }
      s.upsertRider(r.id, {
        pos: r.pos,
        heading: r.heading,
        color: PHASE_COLOR[r.phase],
        label: r.id.replace(/^RD-/, ''),
        selected: r.id === this.selected,
      });
      const kind = r.phase === 'TO_STORE' ? 'TO_STORE' : r.phase === 'TO_CUSTOMER' ? 'TO_CUSTOMER' : null;
      if (kind && r.target) s.upsertRoute(r.id, r.pos, r.target, kind);
      else s.removeRoute(r.id);
    }
    const now = this.sim.clock.now;
    for (const c of this.sim.deliveryCards()) {
      if (!c.customer) continue; // 실서버: 고객 위치를 읽지 않는다(개인정보)
      if (c.dispatchState && DONE_STATES.has(c.dispatchState)) {
        const at = this.doneAt.get(c.deliveryId) ?? now;
        this.doneAt.set(c.deliveryId, at);
        if (now - at > KEEP_DONE_SEC) {
          s.removeCustomer(c.deliveryId);
          continue;
        }
      }
      s.upsertCustomer(c.deliveryId, { pos: c.customer, color: customerColor(c), label: c.deliveryId.replace(/^DL-/, '') });
    }
    s.frame();
  }
}
