import { useState } from 'react';
import { useApp } from '../app/App';
import { seoulTime } from './format';
import { Metrics } from './Metrics';
import { displayStage, purposeLabel } from '../domain/displayStage';
import { Progress } from './Progress';
import { Timeline } from './Timeline';
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

/** 누른 배송 카드 아래 — 그 배송의 흐름·시간 */
function PickedTimeline({ id }: { id: string }) {
  const { sim } = useApp();
  const t = sim.deliveryTimeline(id);
  return t ? <Timeline t={t} nowMs={sim.clock.epochMs()} /> : null;
}

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
      <Metrics m={m} />
      {sel && (
        <div className="filter-chip" role="status">
          <span>
            <b>{sel}</b> 만 보는 중
          </span>
          <span className="chip-actions">
            <button className={`chip-btn ${app.follow ? 'on' : ''}`} aria-pressed={app.follow} onClick={() => app.toggleFollow()} title="지도가 이 라이더를 계속 따라간다">
              {app.follow ? '따라가는 중' : '따라가기'}
            </button>
            <button className="chip-x" aria-label="전체 보기" title="전체 보기" onClick={() => app.select(null)}>
              ✕
            </button>
          </span>
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
            {cards.slice(0, 60).map((c) => {
              const stage = displayStage(c.dispatchState, c.executionState, c.radiusKm, c.purpose);
              const tag = purposeLabel(c.purpose);
              const picked = app.selectedDelivery === c.deliveryId;
              return (
                <li key={c.deliveryId}>
                  <button
                    className={`card dcard tone-${stage.tone} ${picked ? 'picked' : ''}`}
                    aria-pressed={picked}
                    title="누르면 지도에서 이 배송(MFC·고객·라이더)을 보여 준다"
                    onClick={() => app.selectDelivery(c.deliveryId)}
                  >
                    <div className="card-head">
                      <b>{c.deliveryId}</b>
                      {tag && (
                        <span className="purpose-tag" title={`배송 목적 ${c.purpose} — 오배송 확인(case)에서 생긴 배송`}>
                          {tag}
                        </span>
                      )}
                      {sel ? (
                        <span className={`role ${roleOf(c, sel) === '배정' ? 'mine' : ''}`}>{roleOf(c, sel)}</span>
                      ) : (
                        <span className="muted">{c.riderId ?? ''}</span>
                      )}
                    </div>
                    <Progress stage={stage} />
                    <div className="stage-text">
                      {stage.text}
                      {c.orderId && <span className="muted"> · 주문 {c.orderId}</span>}
                    </div>
                    {/* 원래 두 상태를 출처와 함께 작게(docs/design.md §4 — 위 단계는 화면용 계산) */}
                    <div className="raw-states">
                      배차 <code>{c.dispatchState ?? '—'}</code> · 수행 <code>{c.executionState ?? '사본 없음'}</code> · 출고{' '}
                      <code>{c.shipmentId ?? '—'}</code>
                    </div>
                  </button>
                  {picked && <PickedTimeline id={c.deliveryId} />}
                </li>
              );
            })}
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

