import { useState } from 'react';
import { useApp } from '../app/App';
import { seoulTime } from './format';
import { Metrics, type MetricPick } from './Metrics';
import { BUCKET_LABEL, bucketOf, countBuckets, isFailedCall } from './buckets';
import { displayStage, purposeLabel } from '../domain/displayStage';
import { Progress } from './Progress';
import { Timeline } from './Timeline';
import { deliveryLabel, orderLabel, shortId, shortRiderId } from '../domain/riderId';
import { OrdersTab } from './OrdersTab';
import { apiFor, cardsFor, eventsFor, notesFor, roleOf } from './riderFilter';

type Tab = 'deliveries' | 'orders' | 'events' | 'api' | 'notes';

const TABS: readonly (readonly [Tab, string])[] = [
  ['deliveries', '배송'],
  ['orders', '주문'],
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

/** 문제로 보이는 연결 상태 줄 — 실패·못 읽음·없음·거절·막음 */
const DIAG_BAD = /실패|못 읽|못 봄|없음|거절|막음|잠김|403|5\d\d/;

/** 연결 상태 — 평소엔 한 줄 요약(문제 수), 누르면 펼침. 문제가 있으면 그 줄을 강조 */
function Diagnostics({ lines }: { lines: string[] }) {
  const bad = lines.filter((l) => DIAG_BAD.test(l));
  return (
    <details className={`diag ${bad.length ? 'has-bad' : ''}`}>
      <summary>
        연결 상태 {bad.length ? <b className="warn-text">확인 필요 {bad.length}</b> : <span className="ok-text">정상</span>}
        <span className="muted"> · {lines.length}줄</span>
      </summary>
      <ul aria-label="연결 상태">
        {lines.map((d) => (
          <li key={d} className={DIAG_BAD.test(d) ? 'warn-text' : ''}>
            {d}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function RightPanel() {
  const app = useApp();
  const { sim } = app;
  const sel = app.selected;
  const [tab, setTab] = useState<Tab>('deliveries');
  const [pick, setPick] = useState<MetricPick | null>(null);
  const m = sim.metrics();
  const t = (at: number) => seoulTime(sim.clock.epochMs(at));
  const diag = sim.diagnostics();
  const allCards = sim.deliveryCards();
  const riderCards = cardsFor(allCards, sel);
  const counts = countBuckets(riderCards);
  const bucket = pick && pick !== 'failedCalls' ? pick : null;
  const cards = bucket ? riderCards.filter((c) => bucketOf(c) === bucket) : riderCards;
  const failedOnly = pick === 'failedCalls';
  const onPick = (p: MetricPick | null) => {
    setPick(p);
    if (p === 'failedCalls') setTab('api');
    else if (p && tab !== 'orders') setTab('deliveries');
  };
  return (
    <aside className="panel right" aria-label="배송·로그">
      {diag.length > 0 && <Diagnostics lines={diag} />}
      <Metrics m={m} counts={counts} mode={sim.mode} active={pick} onPick={onPick} />
      {pick && (
        <div className="filter-chip" role="status">
          <span>
            {failedOnly ? (
              <>
                <b>{sim.mode === 'mock' ? '응답 끊김' : '요청 실패'}</b> 만 보는 중(API 탭)
              </>
            ) : (
              <>
                <b>{BUCKET_LABEL[pick as keyof typeof BUCKET_LABEL]}</b> {cards.length}건만 보는 중
              </>
            )}
          </span>
          <button className="chip-x" aria-label="거르기 풀기" title="거르기 풀기" onClick={() => setPick(null)}>
            ✕
          </button>
        </div>
      )}
      {sel && (
        <div className="filter-chip" role="status">
          <span>
            <b title={sel}>{shortRiderId(sel)}</b> 만 보는 중
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
                      <b title={`배송 ${c.deliveryId}${c.orderId ? ` · 주문 ${c.orderId}` : ""}`}>{deliveryLabel(c)}</b>
                      {tag && (
                        <span className="purpose-tag" title={`배송 목적 ${c.purpose} — 오배송 확인(case)에서 생긴 배송`}>
                          {tag}
                        </span>
                      )}
                      {sel ? (
                        <span className={`role ${roleOf(c, sel) === '배정' ? 'mine' : ''}`}>{roleOf(c, sel)}</span>
                      ) : (
                        <span className="muted" title={c.riderId ?? ''}>{c.riderId ? shortRiderId(c.riderId) : ''}</span>
                      )}
                    </div>
                    <Progress stage={stage} />
                    <div className="stage-text">
                      {stage.text}
                      {orderLabel(c) && !c.deliveryNumber && <span className="muted"> · 주문 {orderLabel(c)}</span>}
                    </div>
                    {/* 원래 두 상태를 출처와 함께 작게(docs/design.md §4 — 위 단계는 화면용 계산) */}
                    <div className="raw-states">
                      배차 <code>{c.dispatchState ?? '—'}</code> · 수행 <code>{c.executionState ?? '사본 없음'}</code> · 출고{' '}
                      <code title={c.shipmentId ?? ""}>{c.shipmentId ? shortId(c.shipmentId) : '—'}</code>
                    </div>
                  </button>
                  {picked && <PickedTimeline id={c.deliveryId} />}
                </li>
              );
            })}
            {cards.length === 0 && (
              <li className="empty">
                {bucket
                  ? `${BUCKET_LABEL[bucket]} 배송이 없다(최근 목록 안).`
                  : sel
                  ? `${shortRiderId(sel)} 에게 온 배송이 아직 없다.`
                  : sim.mode === 'mock'
                    ? '아직 배송이 없다 — MOCK 주문이 들어오면 생긴다.'
                    : '아직 배송이 없다 — 점원 배차 요청 뒤 생긴다.'}
              </li>
            )}
          </ul>
        )}
        {tab === 'orders' && <OrdersTab cards={cards} />}
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
            {failedOnly && (
              <li className="log-help">
                {sim.mode === 'mock'
                  ? '응답 끊김 = MOCK 이 일부러 응답을 지운 쓰기 요청. 라이더가 같은 Idempotency-Key 로 다시 보내 결과가 한 번만 반영된다.'
                  : '요청 실패 = 응답이 없거나(네트워크·시간 초과) 백엔드가 5xx(서버 오류·잠시 못 씀)로 답한 요청. 이 화면을 연 뒤 누적이고, 대부분 조회라 다음 박자(5초)에 다시 읽는다. 한꺼번에 오르면 백엔드 배포·재시작 중인 경우가 많다.'}
              </li>
            )}
            {apiFor(sim.apiLog, sel)
              .filter((r) => !failedOnly || isFailedCall(r))
              .reverse()
              .slice(0, MAX_ROWS)
              .map((r, i) => (
                <li key={i} className={isFailedCall(r) || (typeof r.status === 'number' && r.status >= 400) ? 'warn' : ''}>
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

