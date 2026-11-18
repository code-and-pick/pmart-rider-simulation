import { useApp } from '../app/App';
import { displayStage, purposeLabel } from '../domain/displayStage';
import { deliveryLabel, orderLabel, shortId, shortRiderId } from '../domain/riderId';
import { BUCKET_LABEL } from './buckets';
import { dur } from './format';
import { Timeline } from './Timeline';

/**
 * 고른 배송 상세 — 지도 위 오른쪽에 뜨는 카드(Locus·LogiNext·Urbantz 관제처럼 지도를 보면서 한 건을 본다).
 * 번호·상태·라이더·걸린 시간·지연, 두 서비스 상태(출처), 단계별 흐름. 닫으면 고르기가 풀린다.
 */
export function MapDetail() {
  const app = useApp();
  const id = app.selectedDelivery;
  if (!id) return null;
  const row = app.board().rows.find((r) => r.card.deliveryId === id);
  if (!row) return null;
  const c = row.card;
  const stage = displayStage(c.dispatchState, c.executionState, c.radiusKm, c.purpose);
  const tag = purposeLabel(c.purpose);
  const tl = app.sim.deliveryTimeline(id);
  const rider = c.riderId ? app.sim.riders.find((r) => r.id === c.riderId) : undefined;
  return (
    <aside className="map-detail" aria-label="고른 배송 상세">
      <div className="md-head">
        <div>
          <b className="md-no" title={`배송 ${c.deliveryId}`}>
            {deliveryLabel(c)}
          </b>
          {tag && <span className="purpose-tag">{tag}</span>}
          <span className={`md-status b-${row.bucket}`}>{row.bucket === 'closed' ? stage.text : BUCKET_LABEL[row.bucket]}</span>
        </div>
        <button className="chip-x" aria-label="상세 닫기" title="닫기" onClick={() => app.selectDelivery(null)}>
          ✕
        </button>
      </div>
      <dl className="md-facts">
        <dt>단계</dt>
        <dd>{stage.text}</dd>
        <dt>라이더</dt>
        <dd>
          {c.riderId ? (
            <button className="link" title={c.riderId} onClick={() => app.select(c.riderId)}>
              🛵 {rider?.label ?? shortRiderId(c.riderId)}
              {rider?.external ? ' (라이더 앱)' : ''}
            </button>
          ) : (
            '아직 없음'
          )}
          {rider?.locationOffline && <span className="warn-text"> · 위치 끊김</span>}
        </dd>
        <dt>걸린 시간</dt>
        <dd>{row.totalSec === null ? '—' : `${dur(row.totalSec)}${row.bucket === 'searching' || row.bucket === 'delivering' ? '째' : ''}`}</dd>
        {orderLabel(c) && (
          <>
            <dt>주문</dt>
            <dd title={c.orderId ?? ''}>{orderLabel(c)}</dd>
          </>
        )}
        <dt>전달지</dt>
        <dd>
          <DropAddress deliveryId={c.deliveryId} open={row.bucket === 'delivering' || row.bucket === 'deliveryFailed'} />
        </dd>
      </dl>
      {row.alert && (
        <div className={`md-alert ${row.alert.level}`}>
          ⚠ {row.alert.title} — {row.alert.detail.split(' — ').at(-1)}
        </div>
      )}
      <div className="raw-states">
        배차 <code>{c.dispatchState ?? '—'}</code> · 수행 <code>{c.executionState ?? '사본 없음'}</code> · 출고{' '}
        <code title={c.shipmentId ?? ''}>{c.shipmentId ? shortId(c.shipmentId) : '—'}</code>
      </div>
      {tl && <Timeline t={tl} nowMs={app.sim.clock.epochMs()} />}
    </aside>
  );
}

/**
 * 전달지 주소(사용자 2026-11-18 "주소까지 보이게") — 실서버는 직원용 drop-location(이 PC·관제 계정, 백엔드가 열람 기록).
 * 배정 ~ 전달 전 배송만 부른다(그 밖은 백엔드도 409 — 부르지 않고 안내만). 화면에만 — 복사·로그·저장 안 함.
 */
export function DropAddress({ deliveryId, open }: { deliveryId: string; open: boolean }) {
  const app = useApp();
  if (!open) return <span className="c-muted">배정 ~ 전달 전 배송만 열람</span>;
  const d = app.sim.dropLocation?.(deliveryId);
  if (!d) return <span className="c-muted">—</span>;
  if (d.state === 'loading') return <span className="c-muted">읽는 중…</span>;
  if (d.state === 'none') return <span className="c-muted">{d.reason}</span>;
  return (
    <span className="md-addr">
      <span className="md-addr-kind">{d.kind}</span>
      <b>{d.address}</b>
      {d.postalCode && <span className="c-muted"> ({d.postalCode})</span>}
      <span className="md-addr-meta">
        {d.pos ? `지도 핀 · ${d.source}` : '좌표 없음'}
        {d.logId && <> · 열람 기록 남음</>}
      </span>
    </span>
  );
}
