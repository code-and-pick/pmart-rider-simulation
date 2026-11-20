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
 * 진행 중 주문 표(Locus·LogiNext 관제 표처럼 주문 한 줄 = 그 라이더 현황까지) — 라이더 관제 맨 위.
 *   주문·배송 | 상태·단계 점 | 라이더(이름·번호) | 라이더 위치(수신 n초 전·끊김) | 지금 단계(몇 분째) | 전체 경과 | 도착 예정 | 지연
 * 순서: 심각 → 주의 → 오래된 것. 줄을 누르면 지도 관제에서 그 배송.
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
        <span className="c-muted">주문마다 라이더 현황 · 줄을 누르면 지도에서</span>
      </h3>
      <div className="c-table-wrap">
        <table className="c-table c-active">
          <thead>
            <tr>
              <th>주문 · 배송</th>
              <th>상태</th>
              <th>라이더</th>
              <th>라이더 위치</th>
              <th>지금 단계</th>
              <th>전체 경과</th>
              <th>도착 예정</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <OrderRow key={r.card.deliveryId} r={r} rider={r.card.riderId ? riders.get(r.card.riderId) : undefined} nowMs={nowMs} onOpen={onOpen} />
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="c-empty">
                  진행 중인 주문이 없습니다
                  {lastDone?.stepAtMs ? ` — 마지막 완료 ${deliveryName(lastDone.card)} · ${dur((nowMs - lastDone.stepAtMs) / 1000)} 전` : ''}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function level(r: OpsRow): number {
  return r.alert?.level === 'bad' ? 0 : r.alert ? 1 : 2;
}

function OrderRow({ r, rider, nowMs, onOpen }: { r: OpsRow; rider: RiderRow | undefined; nowMs: number; onOpen: (id: string) => void }) {
  const c = r.card;
  const stage = displayStage(c.dispatchState, c.executionState, c.radiusKm, c.purpose);
  const inStep = r.stepAtMs !== null ? (nowMs - r.stepAtMs) / 1000 : null;
  const eta = rider?.deliveries.find((d) => d.deliveryId === c.deliveryId);
  const over = r.alert?.overSec !== undefined && r.alert.overSec > 0 ? Math.max(1, Math.round(r.alert.overSec / 60)) : null;
  return (
    <tr className={r.alert ? `al-${r.alert.level}` : ''} onClick={() => onOpen(c.deliveryId)} title={`${c.deliveryId} — 누르면 지도에서`}>
      <td>
        <b className="c-no">{orderLabel(c) ?? '—'}</b>
        <div className="c-muted">{deliveryName(c)}</div>
      </td>
      <td>
        <span className={`c-st b-${r.bucket}`}>{BUCKET_LABEL[r.bucket as 'searching' | 'delivering']}</span>
        <div className="c-flow-cell">
          <Progress stage={stage} compact />
        </div>
      </td>
      <td>
        {c.riderId ? (
          <>
            <b title={c.riderId}>{rider?.name ?? riderName(c.riderId)}</b>
            {rider?.external && <span className="c-tag">앱</span>}
            {rider?.sim && <span className="c-tag gray">시뮬</span>}
          </>
        ) : (
          <span className="c-muted">아직 없음 · {stage.text}</span>
        )}
      </td>
      <td>
        {!c.riderId ? (
          <span className="c-muted">—</span>
        ) : !rider ? (
          <span className="c-muted">모름(관제 응답 없음)</span>
        ) : (
          <>
            {rider.loc === 'ok' ? <span className="c-badge ok">수신 중</span> : rider.loc === 'stale' ? <span className="c-badge bad">끊김</span> : <span className="c-badge bad">위치 없음</span>}
            {rider.sinceSec !== null && <span className="c-muted"> {dur(rider.sinceSec)} 전</span>}
          </>
        )}
      </td>
      <td>
        <b>{r.stepLabel ?? stage.text}</b>
        {inStep !== null && <span className="c-muted"> · {dur(inStep)}째</span>}
        {r.alert && (
          <div className={`c-mini ${r.alert.level}`}>
            {over !== null && `+${over}분 `}
            {r.alert.title}
          </div>
        )}
      </td>
      <td className="num">{r.totalSec === null ? '—' : dur(r.totalSec)}</td>
      <td className="num">
        {eta?.etaPickup && <div>가게 {seoulTime(Date.parse(eta.etaPickup))}</div>}
        {eta?.etaDrop && <div>고객 {seoulTime(Date.parse(eta.etaDrop))}</div>}
        {!eta?.etaPickup && !eta?.etaDrop && <span className="c-muted">—</span>}
      </td>
    </tr>
  );
}
