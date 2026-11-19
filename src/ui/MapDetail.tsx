import { useEffect, useState } from 'react';
import { useApp } from '../app/App';
import { displayStage, purposeLabel } from '../domain/displayStage';
import { deliveryLabel, orderLabel, shortId, shortRiderId } from '../domain/riderId';
import { BUCKET_LABEL } from './buckets';
import { dur, seoulTime } from './format';
import { opsDeliveryUrl, opsRiderUrl } from './opsLinks';
import { OrderTab } from './OrderTab';
import { Timeline } from './Timeline';

type Tab = 'detail' | 'order' | 'flow' | 'raw';

/**
 * 고른 배송 상세 — 지도 위 오른쪽 창(Onfleet 주문 창처럼: 머리 + 탭 상세·흐름·원래 상태 + 조치 버튼).
 *   상세 = 픽업(MFC) → 전달지 세로 단계(지난 단계 ✓), 라이더·주문·시각, 지연 사유.
 *   주문 = 품목·금액·결제·받는 분·배송지·요청사항(직원용 주문 상세 + 사유를 적은 원문 열람 — OrderTab).
 *   흐름 = 단계별 시각·걸린 시간·출처. 원래 상태 = 배차·수행 두 서비스 값(docs/design.md §4).
 *   조치 = 지도에서 따라가기 · 백오피스에서 배송/라이더 열기(쓰기 조치는 백오피스) · 번호 복사.
 */
export function MapDetail() {
  const app = useApp();
  const [tab, setTab] = useState<Tab>('detail');
  const [copied, setCopied] = useState(false);
  const id = app.selectedDelivery;
  const orderIdOfSel = id ? (app.board().rows.find((r) => r.card.deliveryId === id)?.card.orderId ?? null) : null;
  // 열어 본 원문은 다른 배송을 고르거나 창을 닫으면 화면 메모리에서 지운다
  useEffect(() => {
    if (!orderIdOfSel) return;
    return () => app.sim.orders?.hide(orderIdOfSel);
  }, [app, orderIdOfSel]);
  if (!id) return null;
  const row = app.board().rows.find((r) => r.card.deliveryId === id);
  if (!row) return null;
  const c = row.card;
  const stage = displayStage(c.dispatchState, c.executionState, c.radiusKm, c.purpose);
  const tag = purposeLabel(c.purpose);
  const tl = app.sim.deliveryTimeline(id);
  const rider = c.riderId ? app.sim.riders.find((r) => r.id === c.riderId) : undefined;
  const mode = app.sim.mode;
  const active = row.bucket === 'searching' || row.bucket === 'delivering';
  const pickedUp = stage.index >= 3;
  const copy = () => {
    if (!c.orderNumber) return;
    void navigator.clipboard?.writeText(c.orderNumber).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => undefined,
    );
  };
  return (
    <aside className="map-detail md2" aria-label="고른 배송 상세">
      <div className="md-head">
        <div>
          <span className="md-kicker">주문 {orderLabel(c) ?? '—'}</span>
          <div className="md-title">
            <b className="md-no" title={`배송 ${c.deliveryId}`}>
              {deliveryLabel(c)}
            </b>
            {tag && <span className="purpose-tag">{tag}</span>}
            <span className={`md-status b-${row.bucket}`}>{row.bucket === 'closed' ? stage.text : BUCKET_LABEL[row.bucket]}</span>
          </div>
        </div>
        <button className="chip-x" aria-label="상세 닫기" title="닫기" onClick={() => app.selectDelivery(null)}>
          ✕
        </button>
      </div>

      <div className="md-tabs" role="tablist">
        {(
          [
            ['detail', '상세'],
            ['order', '주문'],
            ['flow', '흐름'],
            ['raw', '원래 상태'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>

      {row.alert && (
        <div className={`md-alert ${row.alert.level}`}>
          ⚠ {row.alert.title} — {row.alert.detail.split(' — ').at(-1)}
        </div>
      )}

      {tab === 'detail' && (
        <>
          <ol className="md-route">
            <li className={stage.index >= 2 ? 'past' : 'now'}>
              <span className="md-dot" />
              <div>
                <span className="md-route-l">픽업 · {c.pickup ? '잘못 둔 곳(회수·다시 배송)' : 'MFC'}</span>
                <b>{c.pickup ? '회수지' : '부산진구 MFC'}</b>
                <span className="c-muted">{stage.index >= 3 ? '픽업 완료' : stage.index === 2 ? '가게 도착 — 인계 기다림' : '아직 안 감'}</span>
              </div>
            </li>
            <li className={stage.index >= 5 ? 'past' : pickedUp ? 'now' : ''}>
              <span className="md-dot" />
              <div>
                <span className="md-route-l">전달지</span>
                <DropAddress deliveryId={c.deliveryId} open={row.bucket === 'delivering' || row.bucket === 'deliveryFailed'} />
              </div>
            </li>
          </ol>
          <dl className="md-facts">
            <dt>라이더</dt>
            <dd>
              {c.riderId ? (
                <button className="link" title={c.riderId} onClick={() => app.select(c.riderId)}>
                  🛵 {rider?.label ?? shortRiderId(c.riderId)}
                  {rider?.external ? ' (라이더 앱)' : ''}
                </button>
              ) : (
                '아직 없음 — 라이더 찾는 중'
              )}
              {rider?.locationOffline && <span className="warn-text"> · 위치 끊김</span>}
            </dd>
            <dt>단계</dt>
            <dd>{stage.text}</dd>
            <dt>배차 요청</dt>
            <dd>{row.startMs ? seoulTime(row.startMs) : '—'}</dd>
            <dt>걸린 시간</dt>
            <dd>{row.totalSec === null ? '—' : `${dur(row.totalSec)}${active ? '째' : ''}`}</dd>
          </dl>
        </>
      )}
      {tab === 'order' && <OrderTab orderId={c.orderId} />}
      {tab === 'flow' && (tl ? <Timeline t={tl} nowMs={app.sim.clock.epochMs()} /> : <p className="c-muted">흐름을 아직 못 읽었습니다.</p>)}
      {tab === 'raw' && (
        <dl className="md-facts">
          <dt>배차</dt>
          <dd>
            <code>{c.dispatchState ?? '—'}</code> <span className="c-muted">delivery-dispatch</span>
          </dd>
          <dt>수행</dt>
          <dd>
            <code>{c.executionState ?? '사본 없음'}</code> <span className="c-muted">delivery-execution</span>
          </dd>
          <dt>출고</dt>
          <dd>
            <code title={c.shipmentId ?? ''}>{c.shipmentId ? shortId(c.shipmentId) : '—'}</code>
          </dd>
          <dt>배송 ID</dt>
          <dd>
            <code>{c.deliveryId}</code>
          </dd>
          {c.orderId && (
            <>
              <dt>주문 ID</dt>
              <dd>
                <code>{c.orderId}</code>
              </dd>
            </>
          )}
        </dl>
      )}

      <div className="md-actions" aria-label="조치">
        {c.riderId && (
          <button
            className={`c-btn-s ${app.follow && app.mapRider === c.riderId ? 'on' : ''}`}
            onClick={() => app.toggleFollow()}
            title="지도가 이 라이더를 계속 따라간다"
          >
            {app.follow && app.mapRider === c.riderId ? '따라가는 중' : '라이더 따라가기'}
          </button>
        )}
        {/* 백오피스 바로 가기는 실서버만 — MOCK 배송·라이더는 백오피스에 없고, MOCK 링크(localhost 목 백오피스)는 켜 두지 않으면 "연결할 수 없음"(사용자 2026-11-19) */}
        {mode === 'http' && (
          <a className="c-btn-s" href={opsDeliveryUrl(mode, c.deliveryId)} target="_blank" rel="noopener noreferrer" title="라이더 백오피스 배송 상세 — 전달 실패 확정·배차 취소·상태 정정 같은 조치는 거기서(직원 로그인)">
            배송 조치 ↗
          </a>
        )}
        {mode === 'http' && c.riderId && (
          <a className="c-btn-s" href={opsRiderUrl(mode, c.riderId)} target="_blank" rel="noopener noreferrer" title="라이더 백오피스 라이더 상세 — 계정 제한·수행료·운행시간(직원 로그인)">
            라이더 상세 ↗
          </a>
        )}
        <button className="c-btn-s" onClick={copy} disabled={!c.orderNumber} title={c.orderNumber ? `주문번호 ${c.orderNumber} 복사` : '주문번호가 없는 배송(다시 배송·회수 등)'}>
          {copied ? '복사됨' : '주문번호 복사'}
        </button>
      </div>
      {mode !== 'http' && <p className="md-note">배송 조치·라이더 상세(백오피스)는 실서버 화면에서 — 가상 배송은 백오피스에 없습니다.</p>}
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
