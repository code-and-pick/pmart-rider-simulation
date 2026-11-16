import { useState } from 'react';
import { useApp } from '../app/App';
import { dur, seoulTime } from './format';
import { apiFor, cardsFor, eventsFor, notesFor, roleOf } from './riderFilter';

type Tab = 'deliveries' | 'events' | 'api' | 'notes';

const TABS: readonly (readonly [Tab, string])[] = [
  ['deliveries', '배송'],
  ['events', '사건'],
  ['api', 'API'],
  ['notes', '기록'],
];

/** 한 번에 그리는 줄 수 [시뮬] — 4Hz 로 다시 그리므로 넉넉하지 않게 */
const MAX_ROWS = 120;

export function RightPanel() {
  const app = useApp();
  const { sim } = app;
  const sel = app.selected;
  const [tab, setTab] = useState<Tab>('deliveries');
  const m = sim.metrics();
  const t = (at: number) => seoulTime(sim.clock.epochMs(at));
  const diag = sim.diagnostics();
  const allCards = sim.deliveryCards();
  const cards = cardsFor(allCards, sel);
  return (
    <aside className="panel right" aria-label="배송·로그">
      {diag.length > 0 && (
        <ul className="diag" aria-label="연결 상태">
          {diag.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
      <section className="metrics">
        <Stat label="완료" value={String(m.completed)} />
        <Stat label="진행 중" value={String(m.inProgress)} />
        <Stat label="배차 실패" value={String(m.dispatchFailed)} />
        <Stat label="제안→수락" value={dur(m.offerToAccept)} />
        <Stat label="수락→가게" value={dur(m.acceptToStore)} />
        <Stat label="가게 대기" value={dur(m.storeWait)} />
        <Stat label="픽업→완료" value={dur(m.pickupToComplete)} />
      </section>
      {sel && (
        <div className="filter-chip" role="status">
          <span>
            <b>{sel}</b> 만 보는 중
          </span>
          <button className="chip-x" aria-label="전체 보기" title="전체 보기" onClick={() => app.select(null)}>
            ✕
          </button>
        </div>
      )}
      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="tab-body">
        {tab === 'deliveries' && (
          <ul className="cards">
            {cards.slice(0, 60).map((c) => (
              <li key={c.deliveryId} className="card">
                <div className="card-head">
                  <b>{c.deliveryId}</b>
                  {sel ? (
                    <span className={`role ${roleOf(c, sel) === '배정' ? 'mine' : ''}`}>{roleOf(c, sel)}</span>
                  ) : (
                    <span className="muted">{c.riderId ?? (c.radiusKm ? `반경 ${c.radiusKm}km 탐색` : '')}</span>
                  )}
                </div>
                {/* 두 서비스의 두 상태를 출처와 함께(docs/design.md §4) */}
                <div className="states">
                  <span className="src">배차</span>
                  <code>{c.dispatchState ?? '(아직 못 읽음)'}</code>
                  <span className="src">수행</span>
                  <code>{c.executionState ?? '(사본 없음)'}</code>
                  <span className="src">출고</span>
                  <code>{c.shipmentId ?? (c.dispatchState ? '(dispatch 에 없음)' : '—')}</code>
                </div>
              </li>
            ))}
            {cards.length === 0 && (
              <li className="empty">
                {sel
                  ? `${sel} 에게 온 배송이 아직 없다.`
                  : sim.mode === 'mock'
                    ? '아직 배송이 없다 — MOCK 주문이 들어오면 생긴다.'
                    : '아직 배송이 없다 — 점원 배차 요청 뒤 생긴다.'}
              </li>
            )}
          </ul>
        )}
        {tab === 'events' && (
          <ul className="log">
            {eventsFor(sim.eventLog, allCards, sel)
              .reverse()
              .slice(0, MAX_ROWS)
              .map((e, i) => (
                <li key={i}>
                  <span className="time">{t(e.at)}</span> <code>{e.type}</code> {e.summary}
                </li>
              ))}
            {sim.mode === 'http' && <li className="empty">실서버는 사건을 받지 못한다 — 조회 결과로 추정한 것만 보인다.</li>}
          </ul>
        )}
        {tab === 'api' && (
          <ul className="log">
            {apiFor(sim.apiLog, sel)
              .reverse()
              .slice(0, MAX_ROWS)
              .map((r, i) => (
                <li key={i} className={typeof r.status === 'number' && r.status >= 400 ? 'warn' : ''}>
                  <span className="time">{t(r.at)}</span> <span className="actor">{r.actor}</span> {r.method} {r.path} <b>{r.status}</b>
                  {r.code ? ` ${r.code}` : ''}
                </li>
              ))}
          </ul>
        )}
        {tab === 'notes' && (
          <ul className="log">
            {notesFor(sim.notes, sel)
              .reverse()
              .slice(0, MAX_ROWS)
              .map((n, i) => (
                <li key={i}>
                  <span className="time">{t(n.at)}</span> {!sel && <span className="actor">{n.riderId}</span>} {n.text}
                </li>
              ))}
            {sim.notes.length === 0 && <li className="empty">가상 라이더 진행 기록(엔진 기준 — 백엔드 상태 아님). 라이더가 움직이면 쌓인다.</li>}
          </ul>
        )}
      </div>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat-v">{value}</div>
      <div className="stat-l">{label}</div>
    </div>
  );
}
