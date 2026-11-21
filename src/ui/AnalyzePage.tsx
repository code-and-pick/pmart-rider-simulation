import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useApp } from '../app/App';
import { isSimRiderId } from '../config';
import { deliveryName, orderLabel, riderName } from '../domain/riderId';
import { dur, seoulTime } from './format';
import type { OpsRow } from './ops';
import { riderIndex } from './riderTable';
import { binCount, binLabel, binRange, dayStart, defaultView, frame, frameTitle, niceStep, seoulDay, shift, type Bin, type ChartView } from './timeChart';
import { OrderTab } from './OrderTab';
import { groupOrders } from './orders';
import './analyze.css';

/*
 * 분석(Onfleet "Analyze" 참고) — 이 화면이 가진 배송 목록으로만 센다(새 API 없음).
 *   실서버 = 관찰 계정 직원 배송 목록 최근 30건, MOCK = 화면을 연 뒤 생긴 배송.
 * 2026-11-20 다시 짬(사용자 "폰트 크기 하나도 안 맞고 … 회색 표시 눈에 안 들어오고 … 타임라인 꽉꽉 … UI 없어보여"):
 *   - 글자 크기는 analyze.css 의 네 단계만(제목 15 · 본문 13 · 축 12 · 큰 숫자). 회색 작은 글(.c-muted 11px)은 쓰지 않는다.
 *   - 그래프는 HTML 로 그린다(SVG viewBox 는 화면 폭에 따라 글자가 커지고 작아져 크기가 안 맞았다).
 *   - 라이더 타임라인(하루를 꽉 채운 막대) → 라이더별 표 + 얇은 하루 띠(dataviz: 얇은 표시·넉넉한 여백).
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

/** 구간 이름 — 한 줄에 들어가게 짧게(지표 이름은 마우스 설명에 그대로) */
const PHASE_SHORT: Record<string, string> = {
  findRider: '라이더 찾기',
  toStore: 'MFC까지 이동',
  atStore: '가게에서 인계',
  storeAll: 'MFC 이동·인계',
  toCustomer: '고객에게 전달',
};

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
  const nowMs = sim.clock.epochMs();
  // 최근 12시간 1시간마다 배차 요청 수 — "배송" 타일의 작은 추세선
  const hourly = Array.from({ length: 12 }, (_, i) => {
    const to = nowMs - (11 - i) * 3600_000;
    return rows.filter((r) => (r.startMs as number) > to - 3600_000 && (r.startMs as number) <= to).length;
  });
  const rate = finished ? counts.done / finished : null;
  return (
    <section className="c-page an" aria-label="분석">
      <header className="an-head">
        <div>
          <h2>분석</h2>
          <p>{real ? '실서버 직원 배송 목록 최근 30건' : '가상(MOCK) — 화면을 연 뒤 생긴 배송'}</p>
        </div>
        <span className="an-asof">
          {seoulTime(sim.clock.epochMs()).slice(0, 5)} 기준 · {real ? '실제 시각' : '시뮬 시각'}
        </span>
      </header>

      <div className="an-tiles">
        <Tile label="배송" value={String(b.rows.length)} unit="건" sub={`진행 중 ${counts.active}건`} viz={<Spark values={hourly} title="최근 12시간 1시간마다 배차 요청 수" />} />
        <Tile
          label="완료율"
          value={rate !== null ? String(Math.round(rate * 100)) : '—'}
          unit={rate !== null ? '%' : ''}
          sub={`완료 ${counts.done} · 실패 ${counts.failed}`}
          viz={rate !== null ? <Ring ratio={rate} /> : undefined}
        />
        <Tile label="한 건 평균" value={m.phases ? dur(m.phases.totalSec) : '—'} sub="배차 요청 → 전달 완료" />
        <Tile label="라이더 찾기 평균" value={m.phases ? dur(m.phases.segments[0]?.sec ?? 0) : '—'} sub="배차 요청 → 수락" />
        <Tile label="지연·이상" value={String(b.counts.delayed)} unit="건" sub="진행 중 기준 넘김" bad={b.counts.delayed > 0} />
      </div>

      <div className="an-row">
        <section className="an-card an-fill" aria-label="시간대별 배송 건수">
          <TimeChart rows={rows} />
        </section>
        <section className="an-card" aria-label="상태와 구간">
          <div className="an-card-h">
            <h3>상태</h3>
          </div>
          <StatusDonut counts={counts} total={b.rows.length} />
          <div className="an-card-h an-gap">
            <h3>구간별 평균</h3>
            <span className="an-note">완료 {m.phases?.n ?? 0}건 기준</span>
          </div>
          {m.phases ? (
            <Journey segments={m.phases.segments} total={m.phases.totalSec} />
          ) : (
            <p className="an-empty">완료된 배송이 생기면 나옵니다.</p>
          )}
        </section>
      </div>

      <section className="an-card" aria-label="라이더별 배송">
        <RiderTable rows={rows} />
      </section>
    </section>
  );
}

function Tile({ label, value, unit, sub, bad, viz }: { label: string; value: string; unit?: string; sub: string; bad?: boolean; viz?: ReactNode }) {
  return (
    <div className={`an-tile ${bad ? 'bad' : ''} ${viz ? 'has-viz' : ''}`}>
      <span className="l">{label}</span>
      <span className="v">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      <span className="s">{sub}</span>
      {viz && <span className="viz">{viz}</span>}
    </div>
  );
}

/** 작은 추세선(글자 없음 — 늘어나도 글자 크기 문제 없음). 마지막 점 강조 */
function Spark({ values, title }: { values: readonly number[]; title: string }) {
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 34 - (v / max) * 28] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg className="an-spark" viewBox="0 0 100 36" preserveAspectRatio="none" role="img" aria-label={`${title}: ${values.join(', ')}`}>
      <title>{title}</title>
      <defs>
        <linearGradient id="an-spark-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--ch-active)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--ch-active)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L100,36 L0,36 Z`} fill="url(#an-spark-g)" />
      <path d={line} fill="none" stroke="var(--ch-active)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** 완료율 고리 */
function Ring({ ratio }: { ratio: number }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <svg className="an-ring" viewBox="0 0 50 50" role="img" aria-label={`완료율 ${Math.round(ratio * 100)}%`}>
      <circle cx="25" cy="25" r={r} fill="none" stroke="var(--c-soft)" strokeWidth="6" />
      <circle cx="25" cy="25" r={r} fill="none" stroke="var(--ch-done)" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${c * ratio} ${c}`} transform="rotate(-90 25 25)" className="arc" />
    </svg>
  );
}

/** 상태 도넛 — 가운데 총 건수(올린 조각이면 그 조각), 오른쪽 이름·건수·비율. 조각 사이 틈(dataviz) */
function StatusDonut({ counts, total }: { counts: Record<Kind, number>; total: number }) {
  const [hov, setHov] = useState<Kind | null>(null);
  if (!total) return <p className="an-empty">배송이 없습니다.</p>;
  const ks = ORDER.filter((k) => counts[k]);
  const r = 46;
  const c = 2 * Math.PI * r;
  const gap = ks.length > 1 ? 2.5 : 0;
  let acc = 0;
  const cur = hov ? { label: KIND_LABEL[hov], n: counts[hov] } : { label: '전체 배송', n: total };
  return (
    <div className="an-donut-wrap">
      <div className="an-donut">
        <svg viewBox="0 0 120 120" role="img" aria-label={ks.map((k) => `${KIND_LABEL[k]} ${counts[k]}건`).join(', ')}>
          <circle cx="60" cy="60" r={r} fill="none" stroke="var(--c-soft)" strokeWidth="16" />
          {ks.map((k) => {
            const len = (counts[k] / total) * c;
            const el = (
              <circle
                key={k}
                cx="60"
                cy="60"
                r={r}
                fill="none"
                className={`seg s-${k} ${hov && hov !== k ? 'dim' : ''}`}
                strokeWidth={hov === k ? 20 : 16}
                strokeDasharray={`${Math.max(0.5, len - gap)} ${c}`}
                strokeDashoffset={-acc}
                transform="rotate(-90 60 60)"
                onMouseEnter={() => setHov(k)}
                onMouseLeave={() => setHov(null)}
              />
            );
            acc += len;
            return el;
          })}
        </svg>
        <div className="an-donut-c">
          <b>
            {cur.n}
            <small>건</small>
          </b>
          <span>{cur.label}</span>
        </div>
      </div>
      <ul className="an-donut-keys">
        {ks.map((k) => (
          <li key={k} className={hov === k ? 'on' : ''} onMouseEnter={() => setHov(k)} onMouseLeave={() => setHov(null)}>
            <i className={`k-${k}`} />
            <span>{KIND_LABEL[k]}</span>
            <b>{counts[k]}건</b>
            <em>{Math.round((counts[k] / total) * 100)}%</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 구간별 평균 — 배차 요청 → 전달 완료 한 줄 여정(조각 길이 = 걸린 시간 비율) + 구간마다 번호·이름·시간·비율 */
const JOURNEY_COLOR: Record<string, string> = { findRider: '#2dd4bf', toStore: '#4c8dff', atStore: '#facc15', storeAll: '#4c8dff', toCustomer: '#ff8a3d' };
/** 막대 그라데이션 끝 색 — 구간 색마다 옆 색(청록→하늘·파랑→보라·노랑→주황·주황→장미). 사용자 2026-11-21 "보라 섞어줘도 돼" */
const JOURNEY_END: Record<string, string> = { findRider: '#38bdf8', toStore: 'var(--ch-violet)', atStore: '#fb923c', storeAll: 'var(--ch-violet)', toCustomer: '#f4516c' };
const journeyVars = (key: string) => ({ '--k': JOURNEY_COLOR[key] ?? 'var(--ch-active)', '--k2': JOURNEY_END[key] ?? 'var(--ch-violet)' }) as CSSProperties;
function Journey({ segments, total }: { segments: readonly { key: string; label: string; sec: number; hint: string }[]; total: number }) {
  const sum = Math.max(1, segments.reduce((a, x) => a + x.sec, 0));
  const longest = Math.max(1, ...segments.map((x) => x.sec));
  return (
    <div className="an-journey">
      <div className="an-journey-bar" role="img" aria-label={segments.map((x) => `${PHASE_SHORT[x.key] ?? x.label} ${dur(x.sec)}`).join(', ')}>
        {segments.map((x, i) => (
          <i key={x.key} style={{ flexGrow: Math.max(x.sec, sum * 0.05), ...journeyVars(x.key) }} title={`${x.label} — ${x.hint}`}>
            {i + 1}
          </i>
        ))}
      </div>
      <div className="an-journey-ends">
        <span>배차 요청</span>
        <span>전달 완료</span>
      </div>
      <ol className="an-journey-legs">
        {segments.map((x, i) => (
          <li key={x.key} title={x.hint}>
            <span className="n" style={{ background: JOURNEY_COLOR[x.key] ?? 'var(--ch-active)' }}>
              {i + 1}
            </span>
            <span className="l">{PHASE_SHORT[x.key] ?? x.label}</span>
            <span className="track">
              <i style={{ width: `${Math.max(3, (x.sec / longest) * 100)}%`, ...journeyVars(x.key) }} />
            </span>
            <b>{dur(x.sec)}</b>
            <em>{Math.round((x.sec / sum) * 100)}%</em>
          </li>
        ))}
        <li className="tot">
          <span className="n" />
          <span className="l">합계(한 건 평균)</span>
          <span />
          <b>{dur(total)}</b>
          <em />
        </li>
      </ol>
    </div>
  );
}

function Legend({ kinds, alert }: { kinds: readonly Kind[]; alert?: boolean }) {
  return (
    <span className="an-legend" aria-label="범례">
      {kinds.map((k) => (
        <span key={k}>
          <i className={`k-${k}`} />
          {KIND_LABEL[k]}
        </span>
      ))}
      {alert && (
        <span>
          <i className="k-alert" />
          확인 필요
        </span>
      )}
    </span>
  );
}

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="an-seg" role="tablist" aria-label={label}>
      {options.map(([k, l]) => (
        <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>
          {l}
        </button>
      ))}
    </div>
  );
}

/**
 * 시간대별 배송 건수 — 고정 틀 셋(최근 2시간 10분 칸·하루 1시간 칸·7일 하루 칸, ui/timeChart.ts) + 앞뒤 이동.
 * 막대 = 배차 요청이 그 칸에 들어온 배송 수(쌓기: 완료 → 진행 중 → 실패). 마우스 = 막대 위 카드, 누르면 그 칸 배송 표.
 */
function TimeChart({ rows }: { rows: readonly OpsRow[] }) {
  const app = useApp();
  const nowMs = app.sim.clock.epochMs();
  const [chosen, setChosen] = useState<ChartView | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  // 막대 아래 목록에서 누른 배송 — 화면을 옮기지 않고 목록 바로 아래에 상세(사용자 2026-11-20 "굳이 다른 페이지인 배송관제로 넘어간다")
  const [openId, setOpenId] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (openId) detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [openId]);
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
    setOpenId(null);
    setChosen(n);
  };
  const yStep = niceStep(peak?.total ?? 0);
  const max = Math.max(yStep, Math.ceil((peak?.total ?? 0) / yStep) * yStep);
  const ticks = Array.from({ length: Math.round(max / yStep) + 1 }, (_, i) => i * yStep);
  const hv = hover !== null ? bins[hover] : null;
  const pb = pick !== null ? (bins.find((b) => b.from === pick) ?? null) : null;
  const picked = pb ? items.filter((i) => i.at >= pb.from && i.at < pb.to).sort((a, b) => a.at - b.at) : [];
  const unit = f.mode === 'recent' ? '10분' : f.mode === 'day' ? '1시간' : '하루';

  return (
    <>
      <div className="an-card-h">
        <h3>시간대별 배송 건수</h3>
        <div className="an-ctl">
          {v.mode !== 'recent' && (
            <span className="an-nav">
              <button aria-label={v.mode === 'day' ? '전날' : '앞 7일'} onClick={() => go(shift(v, -1))}>
                ‹
              </button>
              <b>{frameTitle(f, nowMs)}</b>
              <button aria-label={v.mode === 'day' ? '다음 날' : '뒤 7일'} onClick={() => go(shift(v, 1))} disabled={f.to > nowMs}>
                ›
              </button>
            </span>
          )}
          <Seg
            label="보는 기간"
            value={v.mode}
            options={[
              ['recent', '최근 2시간'],
              ['day', '하루'],
              ['week', '7일'],
            ]}
            onChange={(m) => go({ mode: m, anchor: m === 'recent' ? nowMs : v.anchor })}
          />
        </div>
      </div>

      <div className="an-sum">
        <span className="big">
          {total}
          <small>건</small>
        </span>
        <span className="parts">
          {ORDER.filter((k) => k !== 'other' || sum('other')).map((k) => (
            <span key={k}>
              <i className={`k-${k}`} />
              {KIND_LABEL[k]} <b>{sum(k)}</b>
            </span>
          ))}
        </span>
        <span className="an-note right">
          {v.mode === 'recent' ? `${frameTitle(f, nowMs)} · ` : ''}배차 요청 시각 · {unit} 단위
        </span>
      </div>

      {total === 0 ? (
        <div className="an-chart-empty">
          <p>이 기간에는 배송이 없습니다.</p>
          {latest !== null && (
            <button className="an-link" onClick={() => go({ mode: 'day', anchor: latest })}>
              마지막 배송이 있던 {seoulDay(latest)} 보기 →
            </button>
          )}
        </div>
      ) : (
        <div className="an-plot" onMouseLeave={() => setHover(null)}>
          <div className="an-yaxis">
            {ticks.map((t) => (
              <span key={t} style={{ bottom: `${(t / max) * 100}%` }}>
                {t}
              </span>
            ))}
          </div>
          <div className="an-bars">
            {ticks.map((t) => (
              <i key={t} className="an-grid" style={{ bottom: `${(t / max) * 100}%` }} />
            ))}
            {bins.map((b, i) => {
              const isNow = nowMs >= b.from && nowMs < b.to;
              const future = b.from > nowMs;
              const [l1, l2] = binLabel(f.mode, b.from);
              const showLabel = i % f.labelEvery === 0 || isNow;
              const clickable = f.mode === 'week' || b.total > 0;
              return (
                <div
                  key={b.from}
                  className={`an-col ${isNow ? 'now' : ''} ${future ? 'future' : ''} ${pick === b.from ? 'picked' : ''} ${clickable ? 'click' : ''}`}
                  onMouseEnter={() => setHover(i)}
                  onClick={f.mode === 'week' ? () => go({ mode: 'day', anchor: b.from }) : b.total ? () => { setPick(pick === b.from ? null : b.from); setOpenId(null); } : undefined}
                >
                  <div className="stack" style={{ height: `${(b.total / max) * 100}%` }}>
                    {b.total > 0 && <span className="val">{b.total}</span>}
                    {[...ORDER].reverse().map((k) =>
                      b.counts[k] ? <i key={k} className={`k-${k}`} style={{ flexGrow: b.counts[k] }} /> : null,
                    )}
                  </div>
                  <span className="x">
                    {showLabel ? (isNow && f.mode !== 'week' ? '지금' : l1) : ''}
                    {l2 && <em>{isNow ? '오늘' : l2}</em>}
                  </span>
                  {hv && hover === i && (
                    <div className="an-tip" role="status">
                      <b>{binRange(f.mode, hv)}</b>
                      {hv.total ? (
                        <>
                          {ORDER.filter((k) => hv.counts[k]).map((k) => (
                            <span key={k}>
                              <i className={`k-${k}`} />
                              {KIND_LABEL[k]} <b>{hv.counts[k]}</b>
                            </span>
                          ))}
                          <em>{f.mode === 'week' ? '누르면 그날 시간대로' : '누르면 아래에 배송 목록'}</em>
                        </>
                      ) : (
                        <span>배송 없음</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {pb && (
        <div className="an-detail">
          <div className="an-detail-h">
            <b>
              {binRange(f.mode, pb)} · {picked.length}건
            </b>
            <button className="an-x" aria-label="닫기" onClick={() => { setPick(null); setOpenId(null); }}>
              ✕
            </button>
          </div>
          <table className="an-table">
            <thead>
              <tr>
                <th>배차 요청</th>
                <th>배송</th>
                <th>라이더</th>
                <th>상태</th>
                <th className="num">걸린 시간</th>
              </tr>
            </thead>
            <tbody>
              {picked.map(({ r, at, kind }) => (
                <tr key={r.card.deliveryId} className={openId === r.card.deliveryId ? 'on' : ''}>
                  <td className="num">{seoulTime(at).slice(0, 5)}</td>
                  <td>
                    <button className="an-link" title="누르면 아래에 배송 상세" aria-expanded={openId === r.card.deliveryId} onClick={() => setOpenId(openId === r.card.deliveryId ? null : r.card.deliveryId)}>
                      {deliveryName(r.card)}
                    </button>
                  </td>
                  <td>{r.card.riderId ? (idx.get(r.card.riderId)?.name ?? riderName(r.card.riderId)) : '—'}</td>
                  <td>
                    <span className="an-state">
                      <i className={`k-${kind}`} />
                      {r.stepLabel ?? KIND_LABEL[kind]}
                    </span>
                  </td>
                  <td className="num">{dur(r.totalSec)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pb &&
        openId &&
        (() => {
          const it = picked.find((x) => x.r.card.deliveryId === openId);
          if (!it) return null;
          const rid = it.r.card.riderId;
          return (
            <div ref={detailRef}>
              <DeliveryDetail r={it.r} name={rid ? (idx.get(rid)?.name ?? riderName(rid)) : null} onClose={() => setOpenId(null)} />
            </div>
          );
        })()}
    </>
  );
}


/** 막대 한 개 — 시작·끝(ms). 라이더 줄은 맡은 때(배정)부터 */
export interface Span {
  r: OpsRow;
  s: number;
  e: number;
}

/** 겹치는 막대는 아랫줄로 — 최대 4줄, 넘으면 마지막 줄에 겹친다 [시뮬] (라이더 띠에서 같은 때 여러 건) */
const MAX_LINES = 4;

export function pack(list: readonly Span[]): { lines: number; placed: (Span & { line: number; lines: number })[] } {
  const ends: number[] = [];
  const tmp = [...list]
    .sort((a, b) => a.s - b.s)
    .map((x) => {
      let line = ends.findIndex((end) => end <= x.s);
      if (line < 0) line = ends.length < MAX_LINES ? ends.length : MAX_LINES - 1;
      ends[line] = Math.max(ends[line] ?? 0, x.e);
      return { ...x, line };
    });
  const lines = Math.max(1, ends.length);
  return { lines, placed: tmp.map((x) => ({ ...x, lines })) };
}

type Range = 'today' | 'week';

/**
 * 라이더별 배송 — 라이더 한 줄: 맡은 배송·완료·진행 중·평균 걸린 시간(맡은 때 → 전달 완료) + 얇은 하루(7일) 띠.
 * 띠의 표시 하나 = 배송 1건(맡은 때 ~ 끝, 진행 중은 지금까지). 누르면 표 아래에 그 배송 단계별 시각.
 */
function RiderTable({ rows }: { rows: readonly OpsRow[] }) {
  const app = useApp();
  const { sim } = app;
  const [range, setRange] = useState<Range>('today');
  const [picked, setPicked] = useState<string | null>(null);
  const nowMs = sim.clock.epochMs();
  const idx = riderIndex(sim.controlBoard?.()?.items ?? null, sim.riders, isSimRiderId);
  const today = dayStart(nowMs);
  const from = range === 'today' ? today : today - 6 * 86_400_000;
  const to = range === 'today' ? today + 86_400_000 : today + 86_400_000;
  const pct = (ms: number) => Math.min(100, Math.max(0, ((ms - from) / (to - from)) * 100));

  const byRider = new Map<string, Span[]>();
  const all: Span[] = [];
  for (const r of rows) {
    const id = r.card.riderId ?? '';
    const start = r.startMs as number;
    const end = r.totalSec !== null ? start + r.totalSec * 1000 : nowMs;
    const assigned = id ? (sim.deliveryTimeline(r.card.deliveryId)?.steps.find((x) => x.key === 'assigned')?.atMs ?? start) : start;
    const sp = { r, s: Math.min(assigned, end), e: end };
    all.push(sp);
    if (sp.e < from) continue; // 기간 밖에서 끝난 배송
    byRider.set(id, [...(byRider.get(id) ?? []), sp]);
  }
  const lanes = [...byRider.entries()].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : b[1].length - a[1].length));
  const ticks = range === 'today' ? [0, 6, 12, 18, 24].map((h) => from + h * 3600_000) : Array.from({ length: 8 }, (_, i) => from + i * 86_400_000);
  const tickLabel = (t: number) => (range === 'today' ? `${Math.round((t - from) / 3600_000)}시` : seoulDay(t));
  const pick = picked ? (all.find((x) => x.r.card.deliveryId === picked) ?? null) : null;

  return (
    <>
      <div className="an-card-h">
        <h3>라이더별 배송</h3>
        <div className="an-ctl">
          <Legend kinds={['done', 'active', 'failed', 'other']} alert />
          <Seg
            label="보는 기간"
            value={range}
            options={[
              ['today', '오늘'],
              ['week', '7일'],
            ]}
            onChange={(r) => {
              setRange(r);
              setPicked(null);
            }}
          />
        </div>
      </div>
      {lanes.length === 0 ? (
        <p className="an-empty">{range === 'today' ? '오늘 배송이 없습니다. 7일을 눌러 보세요.' : '7일 동안 배송이 없습니다.'}</p>
      ) : (
        <table className="an-table an-riders">
          <thead>
            <tr>
              <th>라이더</th>
              <th className="num">맡은 배송</th>
              <th className="num">완료</th>
              <th className="num">진행 중</th>
              <th className="num">평균 걸린 시간</th>
              <th className="strip-h">
                <span className="an-ticks">
                  {ticks.map((t) => (
                    <span key={t} style={{ left: `${pct(t)}%` }}>
                      {tickLabel(t)}
                    </span>
                  ))}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lanes.map(([id, list]) => {
              const done = list.filter((x) => x.r.bucket === 'done' && x.r.totalSec !== null);
              const active = list.filter((x) => kindOf(x.r) === 'active').length;
              const avg = done.length ? done.reduce((a, x) => a + (x.e - x.s), 0) / done.length / 1000 : null;
              const packed = pack(list.map((x) => ({ ...x, s: Math.max(x.s, from) })));
              return (
                <tr key={id || 'none'} className={id ? '' : 'none'}>
                  <td className="name" title={id}>
                    {id ? (idx.get(id)?.name ?? riderName(id)) : '라이더 없음 (배차 대기)'}
                  </td>
                  <td className="num">{list.length}건</td>
                  <td className="num">{id ? `${done.length}건` : '—'}</td>
                  <td className="num">{active ? `${active}건` : '—'}</td>
                  <td className="num">{id && avg !== null ? dur(avg) : '—'}</td>
                  <td className="strip-c">
                    <div className="an-strip" style={{ height: `${8 + packed.lines * 10}px` }}>
                      {ticks.map((t) => (
                        <i key={t} className="g" style={{ left: `${pct(t)}%` }} />
                      ))}
                      {nowMs >= from && nowMs <= to && <i className="nowline" style={{ left: `${pct(nowMs)}%` }} />}
                      {packed.placed.map(({ r, s, e, line }) => (
                        <button
                          key={r.card.deliveryId}
                          className={`mk k-${kindOf(r)} ${r.alert ? 'al' : ''} ${picked === r.card.deliveryId ? 'on' : ''}`}
                          style={{ left: `${pct(s)}%`, width: `max(6px, ${pct(e) - pct(s)}%)`, top: `${4 + line * 10}px` }}
                          title={`배송 ${deliveryName(r.card)} · ${KIND_LABEL[kindOf(r)]} · ${dur((e - s) / 1000)}${r.alert ? ` · ${r.alert.title}` : ""}`}
                          aria-label={`배송 ${deliveryName(r.card)} 자세히`}
                          onClick={() => setPicked(picked === r.card.deliveryId ? null : r.card.deliveryId)}
                        />
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {pick && <DeliveryDetail r={pick.r} name={pick.r.card.riderId ? (idx.get(pick.r.card.riderId)?.name ?? riderName(pick.r.card.riderId)) : null} onClose={() => setPicked(null)} />}
    </>
  );
}

/**
 * 누른 배송 한 건 — 왼쪽 단계별 시각(서버 기록), 오른쪽 주문 내역(배송 관제 상세 창 "주문" 탭과 같은 것 — 사용자 2026-11-20 "옆에 주문 내역도").
 * 원문 열람을 했으면 닫거나 다른 배송을 고를 때 화면 메모리에서 지운다(CLAUDE.md 예외 2 — MapDetail 과 같게).
 */
function DeliveryDetail({ r, name, onClose }: { r: OpsRow; name: string | null; onClose: () => void }) {
  const app = useApp();
  const kind = kindOf(r);
  const tl = app.sim.deliveryTimeline(r.card.deliveryId);
  const orderId = r.card.orderId;
  useEffect(() => {
    if (!orderId) return;
    return () => app.sim.orders?.hide(orderId);
  }, [app, orderId]);
  return (
    <div className="an-detail">
      <div className="an-detail-h">
        <b>
          배송 {deliveryName(r.card)}
          <span className={`an-pill k-${kind}`}>{r.stepLabel ?? KIND_LABEL[kind]}</span>
        </b>
        <span className="an-detail-a">
          <button className="an-btn" onClick={() => openOnMap(app, r.card.deliveryId)}>
            지도에서 보기
          </button>
          <button className="an-x" aria-label="닫기" onClick={onClose}>
            ✕
          </button>
        </span>
      </div>
      <div className="an-detail-cols">
      <section aria-label="배송 단계">
      <h4 className="an-sub">배송 흐름</h4>
      <dl className="an-facts">
        <div>
          <dt>라이더</dt>
          <dd>{name ?? '아직 없음'}</dd>
        </div>
        <div>
          <dt>배차 요청부터</dt>
          <dd>{dur(r.totalSec)}</dd>
        </div>
      </dl>
      {tl && tl.steps.length > 0 && (
        <ol className="an-steps">
          {tl.steps.map((st, i) => {
            const prev = tl.steps[i - 1];
            return (
              <li key={`${st.key}-${i}`} className={st.bad ? 'bad' : ''}>
                <span className="t">
                  {seoulDay(st.atMs)} {seoulTime(st.atMs).slice(0, 5)}
                </span>
                <span className="l">{st.label}</span>
                <span className="g">{prev ? `+${dur((st.atMs - prev.atMs) / 1000)}` : ''}</span>
              </li>
            );
          })}
        </ol>
      )}
      <SameOrder orderId={orderId} current={r.card.deliveryId} />
      </section>
      <section aria-label="주문 내역">
        <h4 className="an-sub">주문 내역{orderLabel(r.card) ? ` · ${orderLabel(r.card)}` : ''}</h4>
        <OrderTab orderId={orderId} />
      </section>
      </div>
    </div>
  );
}

/** 같은 주문의 배송들(1차 첫 배송 · 2차 재배송 …) — 기록 탭 주문 흐름과 같은 줄. 배송이 하나면 그리지 않는다 */
function SameOrder({ orderId, current }: { orderId: string | null; current: string }) {
  const app = useApp();
  if (!orderId) return null;
  const cards = app.board().rows.filter((x) => x.card.orderId === orderId).map((x) => x.card);
  const row = groupOrders(cards, (id) => app.sim.deliveryTimeline(id), app.sim.clock.epochMs())[0];
  if (!row || row.deliveries.length < 2) return null;
  return (
    <>
      <h4 className="an-sub an-sub-gap">이 주문의 배송 {row.deliveries.length}건</h4>
      <ol className="ord-dlv">
        {row.deliveries.map((d) => (
          <li key={d.deliveryId} className={`tone-${d.tone} ${d.deliveryId === current ? 'cur' : ''}`}>
            <span className="n">{d.n}차</span>
            <span className="kind">{d.kind}</span>
            <span className="dots">
              {d.labels.map((l, i) => (
                <i key={i} className={i < d.index ? 'past' : i === d.index ? 'now' : ''} title={l} />
              ))}
            </span>
            <span className="state">{d.stateText}</span>
            <span className="no">{d.deliveryNumber ?? ''}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

/** 배송 관제(지도)로 가서 그 배송을 고른다 */
function openOnMap(app: ReturnType<typeof useApp>, deliveryId: string) {
  app.setView('field');
  app.setFilter(null, true);
  app.selectDelivery(deliveryId, true);
}
