import { useApp } from '../app/App';
import { isSimRiderId } from '../config';
import { displayStage } from '../domain/displayStage';
import { deliveryName, orderLabel, riderName } from '../domain/riderId';
import { BUCKET_LABEL } from './buckets';
import { dur, seoulTime } from './format';
import type { OpsRow } from './ops';
import { Progress } from './Progress';
import { riderIndex, type RiderRow } from './riderTable';

/**
 * 진행 중 주문 — 주문마다 "초점 카드"(사용자 2026-11-20 "진행 중 주문이 중요한 정보처럼 보이지 않아 … 현재 단계·지연 시간·도착 예정을 먼저").
 *   [주문번호 · 무슨 배송] [지금 단계(크게) · 몇 분째 · 단계 점] [지연(있을 때만 빨강·주황 알약)] [도착 예정(크게)] [라이더 · 위치]
 * 급한 것만 왼쪽 띠·알약으로 강조하고 나머지는 조용히(줄 전체 배경색 없음). 순서: 심각 → 주의 → 오래된 것. 누르면 아래 최근 배송 표에서 펼침(화면 안 옮김).
 */
export function ActiveOrders({ onOpen }: { onOpen: (deliveryId: string) => void }) {
  const app = useApp();
  const { sim } = app;
  const board = app.board();
  const nowMs = sim.clock.epochMs();
  const riders = riderIndex(sim.controlBoard?.()?.items ?? null, sim.riders, isSimRiderId);
  const rows = board.rows
    .filter((r) => r.bucket === 'searching' || r.bucket === 'delivering')
    .sort((a, b) => level(a) - level(b) || (a.startMs ?? 0) - (b.startMs ?? 0));
  const lastDone = board.rows
    .filter((r) => r.bucket === 'done' && r.stepAtMs !== null)
    .sort((a, b) => (b.stepAtMs ?? 0) - (a.stepAtMs ?? 0))[0];
  return (
    <section aria-label="진행 중 주문">
      <h3 className="c-page-h3">
        진행 중 주문 <span className="c-n">{rows.length}</span>
      </h3>
      {rows.length === 0 ? (
        <div className="ao-empty">
          진행 중인 주문이 없습니다
          {lastDone?.stepAtMs ? ` — 마지막 완료 ${deliveryName(lastDone.card)} · ${dur((nowMs - lastDone.stepAtMs) / 1000)} 전` : ''}.
        </div>
      ) : (
        <ul className="ao-list">
          {rows.map((r) => (
            <OrderCard key={r.card.deliveryId} r={r} rider={r.card.riderId ? riders.get(r.card.riderId) : undefined} nowMs={nowMs} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </section>
  );
}

function level(r: OpsRow): number {
  return r.alert?.level === 'bad' ? 0 : r.alert ? 1 : 2;
}

function OrderCard({ r, rider, nowMs, onOpen }: { r: OpsRow; rider: RiderRow | undefined; nowMs: number; onOpen: (id: string) => void }) {
  const c = r.card;
  const stage = displayStage(c.dispatchState, c.executionState, c.radiusKm, c.purpose);
  const inStep = r.stepAtMs !== null ? (nowMs - r.stepAtMs) / 1000 : null;
  const eta = rider?.deliveries.find((d) => d.deliveryId === c.deliveryId);
  const etaMs = eta?.etaDrop ? Date.parse(eta.etaDrop) : eta?.etaPickup ? Date.parse(eta.etaPickup) : null;
  const over = r.alert?.overSec !== undefined && r.alert.overSec > 0 ? Math.max(1, Math.round(r.alert.overSec / 60)) : null;
  return (
    <li>
      <button className={`ao-card ${r.alert ? `al-${r.alert.level}` : ''}`} onClick={() => onOpen(c.deliveryId)} title={`${c.deliveryId} — 누르면 아래 최근 배송에서 상세`}>
        <span className="ao-id">
          <span className="k">주문</span>
          <b>{orderLabel(c) ?? '—'}</b>
          <span className="s">{deliveryName(c)}</span>
        </span>
        <span className="ao-stage">
          <span className="k">지금 단계</span>
          <b>{stage.text}</b>
          <span className="s">
            <Progress stage={stage} compact />
            {inStep !== null && <span>{dur(inStep)}째</span>}
          </span>
        </span>
        <span className="ao-late">
          <span className="k">지연</span>
          {r.alert ? (
            <>
              <b className={`ao-pill ${r.alert.level}`}>{over !== null ? `+${dur(over * 60)}` : r.alert.title}</b>
              <span className="s">{r.alert.title}</span>
            </>
          ) : (
            <>
              <b className="ok">없음</b>
              <span className="s">기준 안</span>
            </>
          )}
        </span>
        <span className="ao-eta">
          <span className="k">{eta?.etaDrop ? '고객 도착 예정' : eta?.etaPickup ? '가게 도착 예정' : '도착 예정'}</span>
          <b>{etaMs !== null ? seoulTime(etaMs).slice(0, 5) : '—'}</b>
          <span className="s">전체 {r.totalSec === null ? '—' : dur(r.totalSec)}</span>
        </span>
        <span className="ao-rider">
          <span className="k">라이더</span>
          {c.riderId ? (
            <>
              <b title={c.riderId}>{rider?.name ?? riderName(c.riderId)}</b>
              <span className="s">
                {!rider ? (
                  '위치 모름'
                ) : (
                  <>
                    <i className={`ao-dot ${rider.loc === 'ok' ? 'ok' : 'bad'}`} />
                    {rider.loc === 'ok' ? '수신 중' : rider.loc === 'stale' ? '끊김' : '위치 없음'}
                    {rider.sinceSec !== null && ` · ${dur(rider.sinceSec)} 전`}
                  </>
                )}
              </span>
            </>
          ) : (
            <>
              <b className="muted">아직 없음</b>
              <span className="s">{BUCKET_LABEL.searching}</span>
            </>
          )}
        </span>
      </button>
    </li>
  );
}
