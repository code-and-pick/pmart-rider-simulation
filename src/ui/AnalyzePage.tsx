import { useState } from 'react';
import { useApp } from '../app/App';
import { isSimRiderId } from '../config';
import { deliveryLabel, riderName } from '../domain/riderId';
import { dur, seoulTime } from './format';
import type { OpsRow } from './ops';
import { riderIndex } from './riderTable';
import { binCount, binLabel, binRange, dayStart, defaultView, frame, frameTitle, KST, niceStep, seoulDay, shift, type Bin, type ChartView } from './timeChart';

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
          <h3>시간대별 배송 건수</h3>
          <TimeChart rows={rows} />
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
        <h3>라이더 타임라인</h3>
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

/**
 * 시간대별 배송 — 고정 틀 셋(최근 2시간·하루·7일, ui/timeChart.ts) + 앞뒤 이동.
 * 쌓은 막대(완료 → 진행 중 → 실패), 막대 위 합계, 지금 칸 강조·지난 뒤 칸은 흐리게, 마우스 = 칸 범위·숫자.
 * 7일 막대를 누르면 그날 하루로 내려간다.
 */
function TimeChart({ rows }: { rows: readonly OpsRow[] }) {
  const app = useApp();
  const nowMs = app.sim.clock.epochMs();
  const [chosen, setChosen] = useState<ChartView | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const idx = riderIndex(app.sim.controlBoard?.()?.items ?? null, app.sim.riders, isSimRiderId);
  const items = rows.map((r) => ({ at: r.startMs as number, kind: kindOf(r), r }));
  const v = chosen ?? defaultView(items.map((i) => i.at), nowMs);
  const f = frame(v, nowMs);
  const bins = binCount(items, f, ORDER);
  const total = bins.reduce((a, b) => a + b.total, 0);
  const sum = (k: Kind) => bins.reduce((a, b) => a + b.counts[k], 0);
  const peak = bins.reduce<Bin<Kind> | null>((p, b) => (b.total > (p?.total ?? 0) ? b : p), null);
  const latest = items.length ? Math.max(...items.map((i) => i.at)) : null;
  const go = (n: ChartView) => {
    setHover(null);
    setPick(null);
    setChosen(n);
  };

  const yStep = niceStep(peak?.total ?? 0);
  const max = Math.max(yStep, Math.ceil((peak?.total ?? 0) / yStep) * yStep);
  const W = 640;
  const H = 210;
  const pad = { l: 30, r: 8, t: 20, b: f.mode === 'week' ? 36 : 22 };
  const slot = (W - pad.l - pad.r) / f.n;
  const bw = Math.min(30, slot * 0.62);
  const x = (i: number) => pad.l + (i + 0.5) * slot;
  const y = (n: number) => pad.t + (H - pad.t - pad.b) * (1 - n / max);
  const ticks = Array.from({ length: Math.round(max / yStep) + 1 }, (_, i) => i * yStep);
  const hv = hover !== null ? bins[hover] : null;
  const pb = pick !== null ? (bins.find((b) => b.from === pick) ?? null) : null;
  const picked = pb ? items.filter((i) => i.at >= pb.from && i.at < pb.to).sort((a, b) => a.at - b.at) : [];

  return (
    <div className="c-an-chart">
      <div className="c-an-ctl">
        <div className="c-an-seg" role="tablist" aria-label="보는 기간">
          {(
            [
              ['recent', '최근 2시간'],
              ['day', '하루'],
              ['week', '7일'],
            ] as const
          ).map(([m, l]) => (
            <button key={m} role="tab" aria-selected={v.mode === m} className={v.mode === m ? 'on' : ''} onClick={() => go({ mode: m, anchor: m === 'recent' ? nowMs : v.anchor })}>
              {l}
            </button>
          ))}
        </div>
        <div className="c-an-nav">
          {v.mode !== 'recent' && (
            <button aria-label={v.mode === 'day' ? '전날' : '앞 7일'} onClick={() => go(shift(v, -1))}>
              ‹
            </button>
          )}
          <b>{frameTitle(f, nowMs)}</b>
          {v.mode !== 'recent' && (
            <button aria-label={v.mode === 'day' ? '다음 날' : '뒤 7일'} onClick={() => go(shift(v, 1))} disabled={f.to > nowMs}>
              ›
            </button>
          )}
          {v.mode !== 'recent' && f.to <= nowMs && (
            <button className="today" onClick={() => go({ mode: v.mode, anchor: nowMs })}>
              오늘
            </button>
          )}
        </div>
      </div>

      <p className="c-an-sum">
        {total ? (
          <>
            <b>{total}건</b> · 완료 {sum('done')} · 진행 중 {sum('active')} · 실패 {sum('failed')}
            {sum('other') ? ` · 취소·기타 ${sum('other')}` : ''}
            {peak && peak.total > 0 && (
              <span className="peak">
                가장 많은 때 <b>{binRange(f.mode, peak)}</b> {peak.total}건
              </span>
            )}
          </>
        ) : (
          <>
            이 기간엔 배송이 없습니다.
            {latest !== null && (
              <button className="link" onClick={() => go({ mode: 'day', anchor: latest })}>
                마지막 배송 {seoulDay(latest)} 보기
              </button>
            )}
          </>
        )}
      </p>

      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`시간대별 배송 막대 — ${frameTitle(f, nowMs)}`}>
        <text className="tick unit" x={pad.l - 6} y={pad.t - 8} textAnchor="end">
          (건)
        </text>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
            <text className="tick" x={pad.l - 6} y={y(t) + 4} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {bins.map((b, i) => {
          const isNow = nowMs >= b.from && nowMs < b.to;
          const future = b.from > nowMs;
          const [l1, l2] = binLabel(f.mode, b.from);
          let acc = 0;
          return (
            <g
              key={b.from}
              className={`${isNow ? 'is-now' : ''} ${future ? 'is-future' : ''} ${f.mode === 'week' || b.total ? 'drill' : ''} ${pick === b.from ? 'is-pick' : ''}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={f.mode === 'week' ? () => go({ mode: 'day', anchor: b.from }) : b.total ? () => setPick(pick === b.from ? null : b.from) : undefined}
            >
              <rect className="hit" x={pad.l + i * slot} y={pad.t} width={slot} height={H - pad.t - pad.b} />
              {isNow && <rect className="nowband" x={pad.l + i * slot} y={pad.t} width={slot} height={H - pad.t - pad.b} />}
              {ORDER.map((k) => {
                const n = b.counts[k];
                if (!n) return null;
                const y0 = y(acc);
                acc += n;
                const y1 = y(acc);
                return <rect key={k} className={`k-${k}`} x={x(i) - bw / 2} y={y1 + 1} width={bw} height={Math.max(2, y0 - y1 - 2)} rx={3} />;
              })}
              {b.total > 0 && (
                <text className="val" x={x(i)} y={y(b.total) - 5} textAnchor="middle">
                  {b.total}건
                </text>
              )}
              {(i % f.labelEvery === 0 || isNow) && (
                <text className={`tick ${isNow ? 'now' : ''}`} x={x(i)} y={y(0) + 15} textAnchor="middle">
                  {isNow && f.mode !== 'week' ? '지금' : l1}
                </text>
              )}
              {l2 && (
                <text className={`tick sub ${isNow ? 'now' : ''}`} x={x(i)} y={y(0) + 29} textAnchor="middle">
                  {isNow ? '오늘' : l2}
                </text>
              )}
            </g>
          );
        })}
        <line className="axis" x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} />
        <text className="tick unit" x={W - pad.r} y={pad.t - 8} textAnchor="end">
          배차 요청 시각 기준 · {f.mode === 'recent' ? '10분' : f.mode === 'day' ? '1시간' : '하루'}마다
        </text>
      </svg>

      <div className="c-an-foot">
        <div className="c-an-legend" aria-label="범례">
          {ORDER.filter((k) => k !== 'other' || sum('other')).map((k) => (
            <span key={k}>
              <i className={`k-${k}`} />
              {KIND_LABEL[k]}
            </span>
          ))}
        </div>
        <span className="c-an-hint" role="status">
          {hv ? (
            <>
              <b>{binRange(f.mode, hv)}</b> · {hv.total ? `완료 ${hv.counts.done} · 진행 중 ${hv.counts.active} · 실패 ${hv.counts.failed}${hv.counts.other ? ` · 취소·기타 ${hv.counts.other}` : ''} · 합계 ${hv.total}` : '배송 없음'}
              {f.mode === 'week' && ' — 누르면 그날 시간대'}
            </>
          ) : f.mode === 'week' ? (
            '막대를 누르면 그날 시간대로'
          ) : (
            '막대를 누르면 어떤 배송인지 아래에'
          )}
        </span>
      </div>

      {pb && (
        <div className="c-an-pick">
          <div className="c-an-pick-h">
            <b>
              {binRange(f.mode, pb)} 에 생긴 배송 {picked.length}건
            </b>
            <button className="chip-x" aria-label="닫기" onClick={() => setPick(null)}>
              ✕
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>배차 요청</th>
                <th>배송 번호</th>
                <th>라이더</th>
                <th>지금</th>
                <th>요청부터 걸린 시간</th>
              </tr>
            </thead>
            <tbody>
              {picked.map(({ r, at, kind }) => (
                <tr key={r.card.deliveryId}>
                  <td>{seoulTime(at).slice(0, 5)}</td>
                  <td>
                    <button className="link" title="배송 관제 지도에서 이 배송 열기" onClick={() => openOnMap(app, r.card.deliveryId)}>
                      {deliveryLabel(r.card)}
                    </button>
                  </td>
                  <td>{r.card.riderId ? (idx.get(r.card.riderId)?.name ?? riderName(r.card.riderId)) : '아직 없음'}</td>
                  <td>
                    <i className={`c-an-dot k-${kind}`} />
                    {r.stepLabel ?? KIND_LABEL[kind]}
                  </td>
                  <td>{dur(r.totalSec)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** 배송 관제(지도)로 가서 그 배송을 고른다 — 지도에 라이더·MFC·전달지 핀, 오른쪽에 상세 창 */
function openOnMap(app: ReturnType<typeof useApp>, deliveryId: string) {
  app.setView('field');
  app.setFilter(null, true);
  app.selectDelivery(deliveryId, true);
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
  /** 기간 밖에서 시작해 잘린 막대 — 원래 길이(ms) */
  full?: number;
  cut?: boolean;
}

export function pack(list: readonly Span[]): { lines: number; placed: (Span & { line: number; lines: number })[] } {
  const ends: number[] = [];
  const tmp = [...list]
    .sort((a, b) => a.s - b.s)
    .map(({ r, s, e, full, cut }) => {
      let line = ends.findIndex((end) => end <= s);
      if (line < 0) line = ends.length < MAX_LINES ? ends.length : MAX_LINES - 1;
      ends[line] = Math.max(ends[line] ?? 0, e);
      return { r, s, e, full, cut, line };
    });
  const lines = Math.max(1, ends.length);
  return { lines, placed: tmp.map((x) => ({ ...x, lines })) };
}

function laneHeight(lines: number): number {
  return lines <= 1 ? 26 : 8 + lines * 12;
}

/**
 * 라이더 타임라인(루티 배차 화면처럼) — 라이더 한 줄, 색 = 상태, 오른쪽에 맡은 배송·완료·평균.
 * 라이더 줄 막대 = 그 라이더가 맡은 때(배정) ~ 끝 — 배차 요청부터 그리면 라이더 찾던 시간까지 들어가 앞뒤 배송이 겹친다.
 * 배차 대기 줄 = 배차 요청 ~ 지금(아직 라이더 없음).
 * 막대를 누르면 화면을 넘기지 않고 아래에 그 배송의 단계별 시각을 펼친다(지도는 버튼으로 — 사용자 2026-11-20
 * "클릭하니 배송관제로 넘어가는데 뭘 보여주는 건지 모르겠어").
 */
function RiderTimeline({ rows }: { rows: readonly OpsRow[] }) {
  const app = useApp();
  const { sim } = app;
  const [picked, setPicked] = useState<string | null>(null);
  const [range, setRange] = useState<TlRange | null>(null);
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
  const all = [...byRider.values()].flat();
  const today = dayStart(nowMs);
  // 기본 = 오늘(오늘 배송이 없으면 전체)
  const rg: TlRange = range ?? (all.some((x) => x.e >= today) ? 'today' : 'all');
  const from = rg === 'today' ? today : rg === 'week' ? today - 6 * 86_400_000 : Math.min(...all.map((x) => x.s));
  // 고른 기간에 걸친 막대만, 기간 밖은 잘라서
  for (const [id, list] of byRider) {
    const inside = list.filter((x) => x.e >= from).map((x) => ({ ...x, s: Math.max(x.s, from), full: x.e - x.s, cut: x.s < from }));
    if (inside.length) byRider.set(id, inside);
    else byRider.delete(id);
  }
  const spans = [...byRider.values()].flat();
  const t0 = from;
  const t1 = Math.max(nowMs, ...spans.map((x) => x.e));
  const pct = (ms: number) => ((ms - t0) / Math.max(1, t1 - t0)) * 100;
  // 눈금 — 12개 이하(15분 ~ 며칠), 서울 시각에 맞춤. 두 줄: 윗줄 시각, 아랫줄 날짜(여러 날일 때 날이 바뀐 눈금에만)
  const stepMin = [15, 30, 60, 120, 180, 360, 720, 1440, 2880, 10080].find((s) => (t1 - t0) / 60_000 / s <= 12) ?? 10080;
  const tlMultiDay = seoulDay(t0) !== seoulDay(t1);
  const ticks: number[] = [];
  for (let t = Math.ceil((t0 + KST) / (stepMin * 60_000)) * stepMin * 60_000 - KST; t <= t1; t += stepMin * 60_000) ticks.push(t);
  const tickDay = (t: number, i: number) => tlMultiDay && stepMin < 1440 && (i === 0 || seoulDay(ticks[i - 1]!) !== seoulDay(t));
  const lanes = [...byRider.entries()].sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : b[1].length - a[1].length));
  const pick = picked ? (all.find((x) => x.r.card.deliveryId === picked) ?? null) : null;
  return (
    <div className="c-tl">
      <div className="c-an-ctl">
        <div className="c-an-seg" role="tablist" aria-label="보는 기간">
          {(
            [
              ['today', '오늘'],
              ['week', '7일'],
              ['all', '전체'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={rg === k} className={rg === k ? 'on' : ''} onClick={() => setRange(k)}>
              {l}
            </button>
          ))}
        </div>
        <TlLegend />
      </div>
      <div className={`c-tl-axis ${tlMultiDay && stepMin < 1440 ? 'two' : ''}`}>
        <span className="c-tl-name">라이더</span>
        <div className="c-tl-track">
          {ticks.map((t, i) => (
            <span key={t} style={{ left: `${pct(t)}%` }}>
              {stepMin >= 1440 ? seoulDay(t) : seoulTime(t).slice(0, 5)}
              {tickDay(t, i) && <em>{seoulDay(t)}</em>}
            </span>
          ))}
        </div>
        <span className="c-tl-sum head">
          <span title="이 목록에서 이 라이더가 맡은 배송 수">맡은 배송</span>
          <span title="그중 전달 완료">완료</span>
          <span title="완료한 배송의 평균 — 라이더가 맡은 때부터 전달 완료까지">평균 걸린 시간</span>
        </span>
      </div>
      {lanes.map(([id, list]) => {
        const done = list.filter((x) => x.r.bucket === 'done' && x.r.totalSec !== null);
        const avg = done.length ? done.reduce((a, x) => a + (x.full ?? x.e - x.s), 0) / done.length / 1000 : null;
        const packed = pack(list);
        return (
          <div key={id || 'none'} className="c-tl-row">
            <span className="c-tl-name" title={id}>
              {id ? (idx.get(id)?.name ?? riderName(id)) : '라이더 없음 · 배차 대기'}
            </span>
            <div className="c-tl-track" style={{ height: `${laneHeight(packed.lines)}px` }}>
              {ticks.map((t) => (
                <i key={t} className="c-tl-grid" style={{ left: `${pct(t)}%` }} />
              ))}
              {packed.placed.map(({ r, s, e, line, lines, full, cut }) => {
                const h = (laneHeight(lines) - 6) / lines;
                return (
                  <button
                    key={r.card.deliveryId}
                    className={`c-tl-bar k-${kindOf(r)} ${r.alert ? 'al' : ''} ${picked === r.card.deliveryId ? 'on' : ''} ${cut ? 'cut' : ''}`}
                    style={{ left: `${pct(s)}%`, width: `${Math.max(0.6, pct(e) - pct(s))}%`, top: `${3 + line * h}px`, height: `${Math.max(4, h - 2)}px` }}
                    title={`배송 ${deliveryLabel(r.card)} · ${KIND_LABEL[kindOf(r)]} · ${seoulTime(cut && full ? e - full : s).slice(0, 5)} ~ ${r.totalSec !== null ? seoulTime(e).slice(0, 5) : '지금'} — 누르면 아래에 자세히`}
                    onClick={() => setPicked(picked === r.card.deliveryId ? null : r.card.deliveryId)}
                  >
                    {lines === 1 && pct(e) - pct(s) > 6 && (
                      <span>
                        {cut ? '◀ ' : ''}{deliveryLabel(r.card)} · {dur((full ?? e - s) / 1000)}
                      </span>
                    )}
                  </button>
                );
              })}
              <i className="c-tl-now" style={{ left: `${pct(nowMs)}%` }} title="지금" />
            </div>
            <span className="c-tl-sum">
              <span>{list.length}건</span>
              <span>{id ? `${done.length}건` : '—'}</span>
              <span>{id && avg !== null ? dur(avg) : '—'}</span>
            </span>
          </div>
        );
      })}
      {pick && (
        <TimelinePick
          span={pick}
          riderName={pick.r.card.riderId ? (idx.get(pick.r.card.riderId)?.name ?? riderName(pick.r.card.riderId)) : null}
          nowMs={nowMs}
          onClose={() => setPicked(null)}
        />
      )}
    </div>
  );
}

/** 타임라인에서 누른 배송 한 건 — 언제 무엇을 했나(서버 기록 시각) + 지도에서 보기 */
function TimelinePick({ span, riderName, nowMs, onClose }: { span: Span; riderName: string | null; nowMs: number; onClose: () => void }) {
  const app = useApp();
  const { r, s, e } = span;
  const kind = kindOf(r);
  const tl = app.sim.deliveryTimeline(r.card.deliveryId);
  const ended = r.totalSec !== null && kind !== 'active';
  return (
    <div className="c-an-pick">
      <div className="c-an-pick-h">
        <b>
          배송 {deliveryLabel(r.card)}
          <span className={`c-an-badge k-${kind}`}>{KIND_LABEL[kind]}</span>
        </b>
        <button className="chip-x" aria-label="닫기" onClick={onClose}>
          ✕
        </button>
      </div>
      <dl className="c-an-facts">
        <dt>라이더</dt>
        <dd>{riderName ?? '아직 없음(배차 대기)'}</dd>
        <dt>막대 구간</dt>
        <dd>
          {seoulDay(s)} {seoulTime(s).slice(0, 5)} ~ {ended ? `${seoulDay(e)} ${seoulTime(e).slice(0, 5)}` : '지금'} ({dur(((ended ? e : nowMs) - s) / 1000)})
        </dd>
        <dt>지금 단계</dt>
        <dd>{r.stepLabel ?? '—'}</dd>
        <dt>배차 요청부터</dt>
        <dd>{dur(r.totalSec)}</dd>
      </dl>
      {tl && tl.steps.length > 0 && (
        <ol className="c-an-steps">
          {tl.steps.map((st, i) => (
            <li key={`${st.key}-${i}`} className={st.bad ? 'bad' : ''}>
              <span className="t">
                {seoulDay(st.atMs)} {seoulTime(st.atMs).slice(0, 5)}
              </span>
              <span className="l">{st.label}</span>
              <span className="c-muted">{st.source}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="c-an-pick-f">
        <button className="c-btn" onClick={() => openOnMap(app, r.card.deliveryId)}>
          🗺 지도에서 보기
        </button>
      </div>
    </div>
  );
}

type TlRange = 'today' | 'week' | 'all';

function TlLegend() {
  return (
    <div className="c-an-legend" aria-label="범례">
      {(['done', 'active', 'failed', 'other'] as const).map((k) => (
        <span key={k}>
          <i className={`k-${k}`} />
          {KIND_LABEL[k]}
        </span>
      ))}
      <span>
        <i className="al" />
        지연
      </span>
      <span>
        <i className="now" />
        지금
      </span>
    </div>
  );
}
