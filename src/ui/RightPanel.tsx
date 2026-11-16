import { useState } from 'react';
import { useApp } from '../app/App';
import { dur, seoulTime } from './format';

type Tab = 'deliveries' | 'events' | 'api';

export function RightPanel() {
  const app = useApp();
  const { sim } = app;
  const [tab, setTab] = useState<Tab>('deliveries');
  const m = sim.metrics();
  const t = (at: number) => seoulTime(sim.clock.epochMs(at));
  return (
    <aside className="panel right" aria-label="배송·로그">
      <section className="metrics">
        <Stat label="완료" value={String(m.completed)} />
        <Stat label="진행 중" value={String(m.inProgress)} />
        <Stat label="배차 실패" value={String(m.dispatchFailed)} />
        <Stat label="제안→수락" value={dur(m.offerToAccept)} />
        <Stat label="수락→가게" value={dur(m.acceptToStore)} />
        <Stat label="가게 대기" value={dur(m.storeWait)} />
        <Stat label="픽업→완료" value={dur(m.pickupToComplete)} />
      </section>
      <div className="tabs" role="tablist">
        {(
          [
            ['deliveries', '배송'],
            ['events', '사건'],
            ['api', 'API'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="tab-body">
        {tab === 'deliveries' && (
          <ul className="cards">
            {sim.deliveryCards().slice(0, 60).map((c) => (
              <li key={c.deliveryId} className="card">
                <div className="card-head">
                  <b>{c.deliveryId}</b>
                  <span className="muted">{c.riderId ?? (c.radiusKm ? `반경 ${c.radiusKm}km 탐색` : '')}</span>
                </div>
                {/* 두 서비스의 두 상태를 출처와 함께(docs/design.md §4) */}
                <div className="states">
                  <span className="src">배차</span>
                  <code>{c.dispatchState}</code>
                  <span className="src">수행</span>
                  <code>{c.executionState ?? '(사본 없음)'}</code>
                </div>
              </li>
            ))}
            {sim.deliveryCards().length === 0 && <li className="empty">아직 배송이 없다 — MOCK 주문이 들어오면 생긴다.</li>}
          </ul>
        )}
        {tab === 'events' && (
          <ul className="log">
            {[...sim.eventLog].reverse().slice(0, 120).map((e, i) => (
              <li key={i}>
                <span className="time">{t(e.at)}</span> <code>{e.type}</code> {e.summary}
              </li>
            ))}
          </ul>
        )}
        {tab === 'api' && (
          <ul className="log">
            {[...sim.apiLog].reverse().slice(0, 120).map((r, i) => (
              <li key={i} className={typeof r.status === 'number' && r.status >= 400 ? 'warn' : ''}>
                <span className="time">{t(r.at)}</span> <span className="actor">{r.actor}</span> {r.method} {r.path}{' '}
                <b>{r.status}</b>
                {r.code ? ` ${r.code}` : ''}
              </li>
            ))}
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
