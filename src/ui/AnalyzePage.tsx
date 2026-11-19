import { useState } from 'react';
import { useApp } from '../app/App';
import { isSimRiderId } from '../config';
import { deliveryLabel } from '../domain/riderId';
import { dur, seoulTime } from './format';
import type { OpsRow } from './ops';
import { riderIndex } from './riderTable';

/*
 * 분석(Onfleet "Analyze" 를 참고) — 이 화면이 가진 배송 목록으로만 센다(새 API 없음).
 *   실서버 = 관찰 계정 직원 배송 목록 최근 30건, MOCK = 화면을 연 뒤 생긴 배송.
 * 색(dataviz 검증 — validate_palette.js 통과, 2026-11-19): 완료 #0ca30c · 진행 중 #2a78d6(어두운 화면 #3987e5) · 실패 #d03b3b,
 * 쌓는 순서 완료 → 진행 중 → 실패(빨강·초록을 붙이면 색각 구분 ΔE 4.1 로 실패). 색만으로 구분하지 않게 범례·글자를 늘 같이.
 */

type Kind = 'done' | 'active' | 'failed' | 'other';
const KIND_LABEL: Record<Kind, string> = { done: '완료', active: '진행 중', failed: '실패', other: '취소·기타' };
const ORDER: readonly Kind[] = ['done', 'active', 'failed', 'other'];

function kindOf(r: OpsRow): Kind {
  if (r.bucket === 'done') return 'done';
  if (r.bucket === 'searching' || r.bucket === 'delivering') return 'active';
  if (r.bucket === 'dispatchFailed' || r.bucket === 'deliveryFailed') return 'failed';
  return 'other';
}

/** 서울 시(0~23) */
function seoulHour(ms: number): number {
  return new Date(ms + 9 * 3600_000).getUTCHours();
}

export function AnalyzePage() {
  const app = useApp();
  const { sim } = app;
  const b = app.board();
  const m = sim.metrics();
  const rows = b.rows.filter((r) => r.startMs !== null);
  const counts = { done: 0, active: 0, failed: 0, other: 0 } as Record<Kind, number>;
  for (const r of b.rows) counts[kindOf(r)]++;
  const finished = counts.done + counts.failed;
  const real = sim.mode === 'http';
  const scope = real ? '실서버 직원 배송 목록 최근 30건 기준' : '가상(MOCK) — 화면을 연 뒤 생긴 배송';
  return (
    <section className="c-page" aria-label="분석">
      <div className="c-page-head">
        <div>
          <h2>분석</h2>
          <p>배송 수·완료율·걸린 시간·시간대별 흐름. {scope}.</p>
        </div>
        <span className="c-page-src">{seoulTime(sim.clock.epochMs())} 기준 · {real ? '실제 시각' : '시뮬 시각'}</span>
      </div>

      <div className="c-an-tiles">
        <Tile label="배송 수" value={String(b.rows.length)} unit="건" sub={`진행 중 ${counts.active} · 끝남 ${finished + counts.other}`} />
        <Tile label="완료율" value={finished ? String(Math.round((counts.done / finished) * 100)) : '—'} unit={finished ? '%' : ''} sub={`완료 ${counts.done} · 실패 ${counts.failed}`} />
        <Tile label="한 건 평균" value={m.phases ? dur(m.phases.totalSec) : '—'} sub={m.phases ? `완료 ${m.phases.n}건 · 배차 요청 → 전달 완료` : '완료 배송이 생기면'} />
        <Tile label="라이더 찾기 평균" value={m.phases ? dur(m.phases.segments[0]?.sec ?? 0) : '—'} sub="배차 요청 → 라이더 수락" />
        <Tile label="지연 · 이상" value={String(b.counts.delayed)} unit="건" sub="진행 중 기준 넘김" tone={b.counts.delayed ? 'bad' : undefined} />
      </div>

      <div className="c-an-grid">
        <section className="c-an-card wide" aria-label="시간대별 배송">
          <h3>시간대별 배송 <span className="c-muted">배차 요청 시각 기준 · 칸 = 자료 폭에 맞춰 10분~하루(서울)</span></h3>
          <HourBars rows={rows} />
        </section>
        <section className="c-an-card" aria-label="상태 구성">
          <h3>상태 구성 <span className="c-muted">총 {b.rows.length}건</span></h3>
          <StatusBar counts={counts} total={b.rows.length} />
          <h3 className="c-an-h3b">구간별 평균 <span className="c-muted">완료 {m.phases?.n ?? 0}건</span></h3>
          {m.phases ? (
            <ul className="c-an-phases">
              {m.phases.segments.map((s) => {
                const max = Math.max(...(m.phases?.segments.map((x) => x.sec) ?? [1]), 1);
                return (
                  <li key={s.key} title={s.hint}>
                    <span className="l">{s.label}</span>
                    <span className="bar">
                      <i style={{ width: `${Math.max(2, (s.sec / max) * 100)}%` }} />
                    </span>
                    <b>{dur(s.sec)}</b>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="c-muted">완료된 배송이 생기면 구간별 평균이 나옵니다.</p>
          )}
        </section>
      </div>

      <section className="c-an-card" aria-label="라이더 타임라인">
        <h3>
          라이더 타임라인 <span className="c-muted">라이더마다 배송을 시간 축에 — 막대 = 라이더가 맡은 때 ~ 끝(진행 중은 지금까지), 배차 대기 줄은 배차 요청부터 · 누르면 지도에서</span>
        </h3>
        <RiderTimeline rows={rows} />
      </section>
    </section>
  );
}

function Tile({ label, value, unit, sub, tone }: { label: string; value: string; unit?: string; sub: string; tone?: 'bad' }) {
  return (
    <div className={`c-an-tile ${tone ?? ''}`}>
      <span className="l">{label}</span>
      <span className="v">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      <span className="s">{sub}</span>
    </div>
  );
}

/** 칸 크기(분) — 자료 폭에 맞춰 칸이 16개 이하가 되게(10분 ~ 하루) [시뮬] */
export function binMinutes(spanMin: number): number {
  return [10, 15, 30, 60, 120, 180, 360, 720, 1440].find((b) => spanMin / b <= 16) ?? 1440;
}

/** 아래 글자는 8개 안팎만 — 칸이 많으면 건너뛴다(글자 겹침 방지) */
export function labelEvery(nBins: number): number {
  return Math.max(1, Math.ceil(nBins / 8));
}

const KST = 9 * 3600_000;

/** 서울 날짜 "11/16" */
function seoulDay(ms: number): string {
  const d = new Date(ms + KST);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/** 시간대별 쌓은 막대 — 완료(아래) → 진행 중 → 실패, 막대 위에 합계, 마우스를 올리면 그 칸 숫자 */
function HourBars({ rows }: { rows: readonly OpsRow[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!rows.length) return <p className="c-muted">배송이 없습니다.</p>;
  const starts = rows.map((r) => r.startMs as number);
  const lo = Math.min(...starts);
  const hi = Math.max(...starts);
  const bin = binMinutes((hi - lo) / 60_000) * 60_000;
  // 칸 경계를 서울 시각에 맞춘다(하루 칸 = 서울 0시부터)
  const b0 = Math.floor((lo + KST) / bin) * bin - KST;
  const nBins = Math.max(1, Math.floor((hi - b0) / bin) + 1);
  const per = Array.from({ length: nBins }, (_, i) => {
    const from = b0 + i * bin;
    const c = { done: 0, active: 0, failed: 0, other: 0 } as Record<Kind, number>;
    rows.forEach((r, j) => {
      if (starts[j]! >= from && starts[j]! < from + bin) c[kindOf(r)]++;
    });
    return { h: from, c, total: c.done + c.active + c.failed + c.other };
  });
  const multiDay = seoulDay(b0) !== seoulDay(hi);
  const clock = (ms: number) => (bin >= 3_600_000 ? `${seoulHour(ms)}시` : seoulTime(ms).slice(0, 5));
  // 하루 칸 = 날짜만, 여러 날에 걸치면 날짜 + 시각, 하루 안이면 시각만
  const label = (ms: number) => (bin >= 86_400_000 ? seoulDay(ms) : multiDay ? `${seoulDay(ms)} ${clock(ms)}` : clock(ms));
  const every = labelEvery(nBins);
  const max = Math.max(1, ...per.map((p) => p.total));
  const W = 640;
  const H = 220;
  const pad = { l: 32, r: 8, t: 18, b: 24 };
  const bw = Math.min(36, ((W - pad.l - pad.r) / per.length) * 0.6);
  const x = (i: number) => pad.l + ((i + 0.5) * (W - pad.l - pad.r)) / per.length;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const ticks = [0, Math.ceil(max / 2), max];
  const hv = hover !== null ? per[hover] : null;
  return (
    <div className="c-an-chart">
      <div className="c-an-legend" aria-label="범례">
        {(['done', 'active', 'failed'] as const).map((k) => (
          <span key={k}>
            <i className={`k-${k}`} />
            {KIND_LABEL[k]}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="시간대별 배송 막대">
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
            <text className="tick" x={pad.l - 6} y={y(t) + 4} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {per.map((p, i) => {
          let acc = 0;
          const segs = ORDER.filter((k) => k !== 'other' || p.c.other).map((k) => {
            const v = p.c[k];
            const y0 = y(acc);
            acc += v;
            const y1 = y(acc);
            return v ? <rect key={k} className={`k-${k}`} x={x(i) - bw / 2} y={y1 + 1} width={bw} height={Math.max(0, y0 - y1 - 2)} rx={3} /> : null;
          });
          return (
            <g key={p.h} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect className="hit" x={x(i) - bw} y={pad.t} width={bw * 2} height={H - pad.t - pad.b} />
              {segs}
              {p.total > 0 && (
                <text className="val" x={x(i)} y={y(p.total) - 5} textAnchor="middle">
                  {p.total}
                </text>
              )}
              {i % every === 0 && (
                <text className="tick" x={x(i)} y={H - 6} textAnchor="middle">
                  {label(p.h)}
                </text>
              )}
            </g>
          );
        })}
        <line className="axis" x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} />
      </svg>
      {hv && (
        <div className="c-an-tip" role="status">
          <b>{label(hv.h)}~</b> · 완료 {hv.c.done} · 진행 중 {hv.c.active} · 실패 {hv.c.failed}
          {hv.c.other ? ` · 취소·기타 ${hv.c.other}` : ''} · 합계 {hv.total}
        </div>
      )}
    </div>
  );
}

/** 상태 구성 — 한 줄 100% 막대(조각 사이 2px 틈) + 글자 범례(건수·비율) */
function StatusBar({ counts, total }: { counts: Record<Kind, number>; total: number }) {
  if (!total) return <p className="c-muted">배송이 없습니다.</p>;
  return (
    <>
      <div className="c-an-stack" role="img" aria-label="상태 구성 막대">
        {ORDER.filter((k) => counts[k]).map((k) => (
          <i key={k} className={`k-${k}`} style={{ flexGrow: counts[k] }} title={`${KIND_LABEL[k]} ${counts[k]}건`} />
        ))}
      </div>
      <ul className="c-an-keys">
        {ORDER.filter((k) => counts[k]).map((k) => (
          <li key={k}>
            <i className={`k-${k}`} />
            {KIND_LABEL[k]} <b>{counts[k]}</b>
            <span className="c-muted"> ({Math.round((counts[k] / total) * 100)}%)</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** 겹치는 막대는 아랫줄로(같은 시간에 여러 건 — 배차 대기 줄·묶음 배송) — 최대 4줄, 넘으면 마지막 줄에 겹친다 [시뮬] */
const MAX_LINES = 4;

/** 막대 한 개 — 시작·끝(ms) */
export interface Span {
  r: OpsRow;
  s: number;
  e: number;
}

export function pack(list: readonly Span[]): { lines: number; placed: (Span & { line: number; lines: number })[] } {
  const ends: number[] = [];
  const tmp = [...list]
    .sort((a, b) => a.s - b.s)
    .map(({ r, s, e }) => {
      let line = ends.findIndex((end) => end <= s);
      if (line < 0) line = ends.length < MAX_LINES ? ends.length : MAX_LINES - 1;
      ends[line] = Math.max(ends[line] ?? 0, e);
      return { r, s, e, line };
    });
  const lines = Math.max(1, ends.length);
  return { lines, placed: tmp.map((x) => ({ ...x, lines })) };
}

function laneHeight(lines: number): number {
  return lines <= 1 ? 26 : 8 + lines * 12;
}

/**
 * 라이더 타임라인(루티 배차 화면처럼) — 라이더 한 줄, 색 = 상태, 오른쪽에 건수·완료·평균.
 * 라이더 줄 막대 = 그 라이더가 맡은 때(배정) ~ 끝 — 배차 요청부터 그리면 라이더 찾던 시간까지 들어가 앞뒤 배송이 겹친다.
 * 배차 대기 줄 = 배차 요청 ~ 지금(아직 라이더 없음).
 */
function RiderTimeline({ rows }: { rows: readonly OpsRow[] }) {
  const app = useApp();
  const { sim } = app;
  const nowMs = sim.clock.epochMs();
  const idx = riderIndex(sim.controlBoard?.()?.items ?? null, sim.riders, isSimRiderId);
  const byRider = new Map<string, Span[]>();
  for (const r of rows) {
    const id = r.card.riderId ?? '';
    const start = r.startMs as number;
    const end = r.totalSec !== null ? start + r.totalSec * 1000 : nowMs;
    // 배정 시각 — 흐름(배차 기록)의 "배정" 단계, 없으면 배차 요청
    const assigned = id ? (sim.deliveryTimeline(r.card.deliveryId)?.steps.find((x) => x.key === 'assigned')?.atMs ?? start) : start;
    byRider.set(id, [...(byRider.get(id) ?? []), { r, s: Math.min(assigned, end), e: end }]);
  }
  if (!rows.length) return <p className="c-muted">배송이 없습니다.</p>;
  const spans = [...byRider.values()].flat();
  const t0 = Math.min(...spans.map((x) => x.s));
  const t1 = Math.max(nowMs, ...spans.map((x) => x.e));
  const pct = (ms: number) => ((ms - t0) / Math.max(1, t1 - t0)) * 100;
  // 눈금 — 8개 이하(15분 ~ 며칠), 서울 시각에 맞춤, 여러 날이면 날짜도
  const stepMin = [15, 30, 60, 120, 180, 360, 720, 1440, 2880, 10080].find((s) => (t1 - t0) / 60_000 / s <= 8) ?? 10080;
  const tlMultiDay = seoulDay(t0) !== seoulDay(t1);
  const ticks: number[] = [];
  for (let t = Math.ceil((t0 + KST) / (stepMin * 60_000)) * stepMin * 60_000 - KST; t <= t1; t += stepMin * 60_000) ticks.push(t);
  const lanes = [...byRider.entries()].sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : b[1].length - a[1].length));
  return (
    <div className="c-tl">
      <div className="c-tl-axis">
        <span className="c-tl-name" />
        <div className="c-tl-track">
          {ticks.map((t) => (
            <span key={t} style={{ left: `${pct(t)}%` }}>
              {stepMin >= 1440 ? seoulDay(t) : tlMultiDay ? `${seoulDay(t)} ${seoulTime(t).slice(0, 5)}` : seoulTime(t).slice(0, 5)}
            </span>
          ))}
        </div>
        <span className="c-tl-sum">건 · 완료 · 평균</span>
      </div>
      {lanes.map(([id, list]) => {
        const done = list.map((x) => x.r).filter((r) => r.bucket === 'done' && r.totalSec !== null);
        const avg = done.length ? done.reduce((a, r) => a + (r.totalSec as number), 0) / done.length : null;
        const packed = pack(list);
        return (
          <div key={id || 'none'} className="c-tl-row">
            <span className="c-tl-name" title={id}>
              {id ? (idx.get(id)?.name ?? id) : '배차 대기·라이더 없음'}
            </span>
            <div className="c-tl-track" style={{ height: `${laneHeight(packed.lines)}px` }}>
              {ticks.map((t) => (
                <i key={t} className="c-tl-grid" style={{ left: `${pct(t)}%` }} />
              ))}
              {packed.placed.map(({ r, s, e, line, lines }) => {
                const h = (laneHeight(lines) - 6) / lines;
                return (
                  <button
                    key={r.card.deliveryId}
                    className={`c-tl-bar k-${kindOf(r)} ${r.alert ? 'al' : ''}`}
                    style={{ left: `${pct(s)}%`, width: `${Math.max(0.6, pct(e) - pct(s))}%`, top: `${3 + line * h}px`, height: `${Math.max(4, h - 2)}px` }}
                    title={`${deliveryLabel(r.card)} · ${KIND_LABEL[kindOf(r)]}${r.totalSec !== null ? ` · ${dur(r.totalSec)}` : ''} — 누르면 지도에서`}
                    onClick={() => {
                      app.setView('field');
                      app.setFilter(null, true);
                      app.selectDelivery(r.card.deliveryId, true);
                    }}
                  />
                );
              })}
              <i className="c-tl-now" style={{ left: `${pct(nowMs)}%` }} title="지금" />
            </div>
            <span className="c-tl-sum">
              {list.length} · {done.length} · {avg !== null ? dur(avg) : '—'}
            </span>
          </div>
        );
      })}
      <div className="c-an-legend">
        {(['done', 'active', 'failed', 'other'] as const).map((k) => (
          <span key={k}>
            <i className={`k-${k}`} />
            {KIND_LABEL[k]}
          </span>
        ))}
        <span>
          <i className="now" />
          지금
        </span>
      </div>
    </div>
  );
}
