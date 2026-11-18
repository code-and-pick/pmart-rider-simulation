import { useState } from 'react';
import { useApp } from '../app/App';
import { dur, seoulTime } from './format';
import { groupOrders, type SegKind } from './orders';
import { Timeline } from './Timeline';
import type { DeliveryCard } from '../sim/world';

/** 구간 색 — 지표 막대(Metrics)와 같게 */
const SEG_COLOR: Record<SegKind, string> = {
  findRider: '#8f7cff',
  toStore: '#4c8dff',
  atStore: '#d35cff',
  storeAll: '#4c8dff',
  toCustomer: '#ff8a3d',
  bad: '#c2410c',
  now: '#9aa6ba',
  between: '#d5dbe5',
};

/** 한 번에 그리는 주문 수 [시뮬] — 4Hz 로 다시 그리므로 넉넉하지 않게 */
const MAX_ORDERS = 40;

/**
 * 주문 탭 — 주문마다 한 줄: 주문번호·지금 단계·총 시간(진행 중이면 지금까지)·구간 막대.
 * 누르면 그 주문의 배송마다 흐름(단계별 시각·걸린 시간·출처)을 펼친다.
 */
export function OrdersTab({ cards }: { cards: DeliveryCard[] }) {
  const { sim } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const nowMs = sim.clock.epochMs();
  const rows = groupOrders(cards, (id) => sim.deliveryTimeline(id), nowMs).slice(0, MAX_ORDERS);
  if (!rows.length) {
    return <p className="empty">{sim.mode === 'mock' ? '아직 주문이 없다 — MOCK 주문이 들어오면 생긴다.' : '아직 배송이 없다 — 점원 배차 요청 뒤 생긴다.'}</p>;
  }
  return (
    <ul className="orders">
      <li className="ord-legend muted">
        {(
          [
            ['findRider', '라이더 찾기'],
            ['toStore', 'MFC 로'],
            ['atStore', '가게에서'],
            ['toCustomer', '고객에게'],
            ['now', '진행 중'],
            ['bad', '실패·취소'],
            ['between', '다음 배송까지'],
          ] as const
        ).map(([k, l]) => (
          <span key={k}>
            <span className="sw" style={{ background: SEG_COLOR[k] }} />
            {l}
          </span>
        ))}
        <span>· {sim.mode === 'mock' ? '시뮬 시각' : '실제 시각'}</span>
      </li>
      {rows.map((r) => {
        const key = r.orderId ?? r.deliveryIds[0] ?? '';
        const isOpen = open === key;
        const total = r.startMs === null ? null : ((r.endMs ?? nowMs) - r.startMs) / 1000;
        return (
          <li key={key}>
            <button className={`card ord ${isOpen ? 'picked' : ''}`} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : key)}>
              <div className="card-head">
                <b>{r.orderId ? `주문 ${r.orderId}` : `주문번호 모름 · ${r.deliveryIds[0]}`}</b>
                <span className="ord-total" title={r.endMs === null ? '첫 단계부터 지금까지' : '첫 단계부터 마지막 단계까지'}>
                  {r.endMs === null ? '지금까지 ' : '총 '}
                  <b>{dur(total)}</b>
                </span>
              </div>
              <div className="ph-bar" role="img" aria-label="구간별 걸린 시간">
                {r.segments.map((s, i) => (
                  <span key={i} className="ph-seg" style={{ flexGrow: Math.max(s.sec, 1), background: SEG_COLOR[s.kind] }} title={`${s.label}까지 ${dur(s.sec)}`} />
                ))}
              </div>
              <div className="stage-text">
                <span className={r.bad ? 'warn-text' : ''}>{r.endMs === null ? `진행 중 — 마지막: ${r.lastLabel}` : r.lastLabel}</span>
                <span className="muted">
                  {' '}
                  · 시작 {r.startMs !== null ? seoulTime(r.startMs) : '—'}
                  {r.deliveryIds.length > 1 ? ` · 배송 ${r.deliveryIds.length}건` : ''}
                </span>
              </div>
            </button>
            {isOpen &&
              r.deliveryIds.map((id) => {
                const t = sim.deliveryTimeline(id);
                return t ? (
                  <div key={id}>
                    {r.deliveryIds.length > 1 && <div className="ord-sub muted">{id}</div>}
                    <Timeline t={t} nowMs={nowMs} />
                  </div>
                ) : null;
              })}
          </li>
        );
      })}
    </ul>
  );
}
