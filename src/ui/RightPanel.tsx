import { useEffect, useState } from 'react';
import { useApp } from '../app/App';
import { dur, seoulTime } from './format';
import { PhaseSummary } from './Metrics';
import { AlertsPanel } from './AlertsPanel';
import { BUCKET_LABEL, isFailedCall, type Bucket } from './buckets';
import { displayStage, purposeLabel } from '../domain/displayStage';
import { Progress } from './Progress';
import { deliveryLabel, orderLabel, shortRiderId } from '../domain/riderId';
import { OrdersTab } from './OrdersTab';
import { rowMatches, type OpsFilter, type OpsRow } from './ops';
import { apiFor, eventsFor, notesFor, roleOf } from './riderFilter';

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
const MAX_DELIVERIES = 80;

const FILTER_LABEL: Record<OpsFilter, string> = { ...BUCKET_LABEL, delayed: '지연·이상', failedCalls: '요청 실패' };

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

/** 목록 순서: 심각 알림 → 주의 알림 → 진행 중(오래된 것 먼저) → 끝난 것(최근 것 먼저) */
function rank(r: OpsRow): number {
  if (r.alert?.level === 'bad') return 0;
  if (r.alert) return 1;
  if (r.bucket === 'searching') return 2;
  if (r.bucket === 'delivering') return 3;
  return 4;
}

const ACTIVE: ReadonlySet<Bucket> = new Set(['searching', 'delivering']);

function elapsedText(r: OpsRow): string {
  if (r.totalSec === null) return '';
  return ACTIVE.has(r.bucket) ? `${dur(r.totalSec)}째` : `총 ${dur(r.totalSec)}`;
}

export function RightPanel() {
  const app = useApp();
  const { sim } = app;
  const sel = app.selected;
  const f = app.filter;
  const [tab, setTab] = useState<Tab>('deliveries');
  const [q, setQ] = useState('');
  // 숫자 줄에서 고른 거르기에 맞춰 탭을 옮긴다
  useEffect(() => {
    if (f === 'failedCalls') setTab('api');
    else if (f) setTab((t) => (t === 'orders' ? t : 'deliveries'));
  }, [f]);
  const m = sim.metrics();
  const t = (at: number) => seoulTime(sim.clock.epochMs(at));
  const diag = sim.diagnostics();
  const board = app.board();
  const allCards = board.rows.map((r) => r.card);
  const needle = q.trim().toLowerCase();
  const rows = board.rows
    .filter((r) => !sel || r.card.riderId === sel || r.card.riderIds.includes(sel))
    .filter((r) => rowMatches(r, f))
    .filter((r) => {
      if (!needle) return true;
      const c = r.card;
      return [c.deliveryId, c.deliveryNumber, c.orderNumber, c.orderId, c.riderId, c.riderId ? shortRiderId(c.riderId) : null].some((x) => x?.toLowerCase().includes(needle));
    })
    .sort((a, b) => {
      const d = rank(a) - rank(b);
      if (d) return d;
      if (rank(a) <= 3) return (a.startMs ?? 0) - (b.startMs ?? 0);
      return b.card.createdAt - a.card.createdAt;
    });
  const failedOnly = f === 'failedCalls';
  return (
    <aside className="panel right" aria-label="배송·로그">
      {diag.length > 0 && <Diagnostics lines={diag} />}
      <AlertsPanel />
      <PhaseSummary m={m} />
      {(f || sel) && (
        <div className="filter-chip" role="status">
          <span>
            {sel && (
              <>
                <b title={sel}>{shortRiderId(sel)}</b> 만
              </>
            )}
            {sel && f && ' · '}
            {f && (
              <>
                <b>{FILTER_LABEL[f]}</b>
                {!failedOnly && ` ${rows.length}건`}
              </>
            )}{' '}
            보는 중
          </span>
          <span className="chip-actions">
            {sel && (
              <button className={`chip-btn ${app.follow ? 'on' : ''}`} aria-pressed={app.follow} onClick={() => app.toggleFollow()} title="지도가 이 라이더를 계속 따라간다">
                {app.follow ? '따라가는 중' : '따라가기'}
              </button>
            )}
            <button
              className="chip-x"
              aria-label="거르기 모두 풀기"
              title="거르기 모두 풀기"
              onClick={() => {
                if (f) app.setFilter(f);
                if (sel) app.select(null);
              }}
            >
              ✕
            </button>
          </span>
        </div>
      )}
      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
            {k === 'deliveries' && <span className="tab-n">{rows.length}</span>}
          </button>
        ))}
      </div>
      <div className="tab-body">
        {tab === 'deliveries' && (
          <>
            <input
              className="rider-search"
              type="search"
              placeholder="배송·주문번호·라이더로 찾기"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="배송 찾기"
            />
            <ul className="drows">
              {rows.slice(0, MAX_DELIVERIES).map((r) => (
                <DeliveryRow key={r.card.deliveryId} r={r} sel={sel} />
              ))}
              {rows.length === 0 && (
                <li className="empty">
                  {f && f !== 'failedCalls'
                    ? `${FILTER_LABEL[f]} 배송이 없다(최근 목록 안).`
                    : needle
                      ? '찾는 배송이 없다.'
                      : sel
                        ? `${shortRiderId(sel)} 에게 온 배송이 아직 없다.`
                        : sim.mode === 'mock'
                          ? '아직 배송이 없다 — MOCK 주문이 들어오면 생긴다.'
                          : '아직 배송이 없다 — 점원 배차 요청 뒤 생긴다.'}
                </li>
              )}
              {rows.length > MAX_DELIVERIES && <li className="empty">앞 {MAX_DELIVERIES}건만 — 찾기·거르기로 좁혀 보세요.</li>}
            </ul>
          </>
        )}
        {tab === 'orders' && <OrdersTab cards={rows.map((r) => r.card)} />}
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
                  <span className="time">{t(n.at)}</span> {!sel && <span className="actor">{shortRiderId(n.riderId)}</span>} {n.text}
                </li>
              ))}
            {sim.notes.length === 0 && <li className="empty">가상 라이더 진행 기록(엔진 기준 — 백엔드 상태 아님). 라이더가 움직이면 쌓인다.</li>}
          </ul>
        )}
      </div>
    </aside>
  );
}

/** 배송 한 줄 — 번호·라이더·걸린 시간·단계, 지연이면 배지와 기준 넘긴 시간. 누르면 지도에서 보여 주고 지도 위에 상세 카드(ui/MapDetail) */
function DeliveryRow({ r, sel }: { r: OpsRow; sel: string | null }) {
  const app = useApp();
  const c = r.card;
  const stage = displayStage(c.dispatchState, c.executionState, c.radiusKm, c.purpose);
  const tag = purposeLabel(c.purpose);
  const picked = app.selectedDelivery === c.deliveryId;
  return (
    <li>
      <button
        className={`drow b-${r.bucket} ${picked ? 'picked' : ''} ${r.alert ? `al-${r.alert.level}` : ''}`}
        aria-pressed={picked}
        title={`배송 ${c.deliveryId}${c.orderId ? ` · 주문 ${c.orderId}` : ''} — 누르면 지도에서 보여 주고 지도 위에 상세(두 상태·흐름)`}
        onClick={() => app.selectDelivery(c.deliveryId)}
      >
        <div className="drow-1">
          <b className="drow-no">{deliveryLabel(c)}</b>
          {tag && <span className="purpose-tag">{tag}</span>}
          {sel ? (
            <span className={`role ${roleOf(c, sel) === '배정' ? 'mine' : ''}`}>{roleOf(c, sel)}</span>
          ) : (
            c.riderId && (
              <span className="drow-rider" title={c.riderId}>
                🛵 {shortRiderId(c.riderId)}
              </span>
            )
          )}
          {r.alert?.overSec !== undefined && r.alert.overSec > 0 && (
            <span className={`over ${r.alert.level}`} title={`${r.alert.title} 기준을 넘긴 시간`}>
              +{Math.max(1, Math.round(r.alert.overSec / 60))}분
            </span>
          )}
          <span className="drow-time">{elapsedText(r)}</span>
        </div>
        <div className="drow-2">
          <Progress stage={stage} compact />
          <span className="drow-stage">{stage.text}</span>
          {!c.deliveryNumber && orderLabel(c) && <span className="muted"> · 주문 {orderLabel(c)}</span>}
        </div>
        {r.alert && (
          <div className={`drow-alert ${r.alert.level}`}>
            ⚠ {r.alert.title} — {r.alert.detail.split(' — ').at(-1)}
          </div>
        )}
      </button>
    </li>
  );
}
