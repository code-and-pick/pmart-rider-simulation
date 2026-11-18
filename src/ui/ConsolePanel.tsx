import { useState } from 'react';
import { useApp } from '../app/App';
import { displayStage, purposeLabel } from '../domain/displayStage';
import { deliveryLabel, orderLabel, shortRiderId } from '../domain/riderId';
import { PHASE_COLOR } from '../render/colors';
import { PHASE_LABEL, type RiderJob } from '../sim/rider';
import type { RiderView } from '../sim/world';
import { useAlertSound } from './alertSound';
import { isFailedCall, type Bucket } from './buckets';
import { dur, seoulTime } from './format';
import { friendlyNote } from './friendly';
import { PhaseSummary } from './Metrics';
import { FILTER_LABEL, rowMatches, type OpsFilter, type OpsRow } from './ops';
import { OrdersTab } from './OrdersTab';
import { apiFor, eventsFor, notesFor, roleOf } from './riderFilter';

/** 한 번에 그리는 줄 수 [시뮬] — 4Hz 로 다시 그리므로 넉넉하지 않게 */
const MAX_LOG = 120;
const MAX_DELIVERIES = 80;

const ACTIVE: ReadonlySet<Bucket> = new Set(['searching', 'delivering']);

const BUCKET_CHIP: Record<Bucket, string> = {
  searching: '라이더 찾는 중',
  delivering: '배송 중',
  done: '전달 완료',
  dispatchFailed: '배차 실패',
  deliveryFailed: '전달 실패',
  closed: '끝남',
};

/** 오른쪽 관제 패널 — 위 이상 상황 띠, 아래 탭(배송·라이더·기록). */
export function ConsolePanel() {
  const app = useApp();
  const b = app.board();
  const tab = app.panelTab;
  const diagBad = app.sim.diagnostics().filter((l) => DIAG_BAD.test(l)).length;
  return (
    <aside className="c-panel" aria-label="관제 패널">
      <AlertStrip />
      <div className="c-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'deliveries'} className={tab === 'deliveries' ? 'on' : ''} onClick={() => app.setPanelTab('deliveries')}>
          배송 <span className="c-n">{b.counts.active}</span>
        </button>
        <button role="tab" aria-selected={tab === 'riders'} className={tab === 'riders' ? 'on' : ''} onClick={() => app.setPanelTab('riders')}>
          라이더 <span className="c-n">{b.riders.total}</span>
        </button>
        <button role="tab" aria-selected={tab === 'logs'} className={tab === 'logs' ? 'on' : ''} onClick={() => app.setPanelTab('logs')}>
          기록{diagBad > 0 && <span className="c-n warn" title="연결 상태 확인 필요">{diagBad}</span>}
        </button>
      </div>
      <div className="c-body">
        {tab === 'deliveries' && <DeliveriesView />}
        {tab === 'riders' && <RidersView />}
        {tab === 'logs' && <LogsView />}
      </div>
    </aside>
  );
}

// ─────────────── 이상 상황 띠 ───────────────

function AlertStrip() {
  const app = useApp();
  const { alerts } = app.board();
  const [more, setMore] = useState(false);
  const [sound, toggleSound] = useAlertSound(alerts);
  const bad = alerts.filter((a) => a.level === 'bad').length;
  const shown = more ? alerts : alerts.slice(0, 3);
  return (
    <section className={`c-alerts ${alerts.length ? (bad ? 'bad' : 'warn') : 'ok'}`} aria-label="이상 상황">
      <div className="c-alerts-head">
        <b>{alerts.length ? `⚠ 이상 상황 ${alerts.length}` : '● 이상 없음'}</b>
        {bad > 0 && <span className="c-pill red">심각 {bad}</span>}
        <button className={`c-sound ${sound ? 'on' : ''}`} aria-pressed={sound} onClick={toggleSound} title={`새 알림이 생기면 소리 — 누르면 ${sound ? '끄기' : '켜기'}`}>
          {sound ? '🔔 소리 켬' : '🔕 소리 끔'}
        </button>
      </div>
      {alerts.length > 0 && (
        <ul>
          {shown.map((a) => (
            <li key={a.key}>
              <button
                className={`c-alert ${a.level}`}
                onClick={() => {
                  if (a.deliveryId) {
                    app.setPanelTab('deliveries');
                    app.selectDelivery(a.deliveryId);
                  } else if (a.riderId) {
                    app.setPanelTab('riders');
                    app.select(a.riderId);
                  } else {
                    app.setFilter('failedCalls', true);
                    app.setPanelTab('logs');
                  }
                }}
              >
                <span className="c-alert-t">{a.title}</span>
                <span className="c-alert-d">{a.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {alerts.length > 3 && (
        <button className="c-link" onClick={() => setMore(!more)}>
          {more ? '접기' : `${alerts.length - 3}건 더 보기`}
        </button>
      )}
    </section>
  );
}

// ─────────────── 배송 ───────────────

/** 상태 탭(바로고 목록관제처럼 건수와 함께) */
const STATUS_TABS: readonly (readonly [OpsFilter | null, string])[] = [
  ['active', '진행 중'],
  ['delayed', '지연'],
  ['done', '완료'],
  ['failed', '실패'],
  [null, '전체'],
];

/** 목록 순서: 심각 알림 → 주의 알림 → 찾는 중 → 배송 중(오래된 것 먼저) → 끝난 것(최근 것 먼저) */
function rank(r: OpsRow): number {
  if (r.alert?.level === 'bad') return 0;
  if (r.alert) return 1;
  if (r.bucket === 'searching') return 2;
  if (r.bucket === 'delivering') return 3;
  return 4;
}

function DeliveriesView() {
  const app = useApp();
  const b = app.board();
  const f = app.filter;
  const sel = app.selected;
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const byRider = b.rows.filter((r) => !sel || r.card.riderId === sel || r.card.riderIds.includes(sel));
  const count = (k: OpsFilter | null) => byRider.filter((r) => rowMatches(r, k)).length;
  const rows = byRider
    .filter((r) => rowMatches(r, f === 'failedCalls' ? null : f))
    .filter((r) => {
      if (!needle) return true;
      const c = r.card;
      return [c.deliveryId, c.deliveryNumber, c.orderNumber, c.orderId, c.riderId, c.riderId ? shortRiderId(c.riderId) : null].some((x) => x?.toLowerCase().includes(needle));
    })
    .sort((x, y) => {
      const d = rank(x) - rank(y);
      if (d) return d;
      if (rank(x) <= 3) return (x.startMs ?? 0) - (y.startMs ?? 0);
      return y.card.createdAt - x.card.createdAt;
    });
  const tabbed = STATUS_TABS.some(([k]) => k === f);
  return (
    <>
      <div className="c-status" role="tablist" aria-label="배송 상태">
        {STATUS_TABS.map(([k, l]) => (
          <button key={l} role="tab" aria-selected={f === k} className={`${f === k ? 'on' : ''} ${k === 'delayed' && count(k) > 0 ? 'hot' : ''}`} onClick={() => app.setFilter(k, true)}>
            {l} <b>{count(k)}</b>
          </button>
        ))}
      </div>
      {(sel || (f && !tabbed && f !== 'failedCalls')) && (
        <div className="c-chip-row">
          {sel && (
            <span className="c-chip">
              🛵 {shortRiderId(sel)} 배송만
              <button aria-label="라이더 거르기 풀기" onClick={() => app.select(null)}>
                ✕
              </button>
            </span>
          )}
          {f && !tabbed && f !== 'failedCalls' && (
            <span className="c-chip">
              {FILTER_LABEL[f]}만
              <button aria-label="거르기 풀기" onClick={() => app.setFilter('active', true)}>
                ✕
              </button>
            </span>
          )}
        </div>
      )}
      <input className="c-search" type="search" placeholder="배송번호 · 주문번호 · 라이더 찾기" value={q} onChange={(e) => setQ(e.target.value)} aria-label="배송 찾기" />
      <ul className="c-list">
        {rows.slice(0, MAX_DELIVERIES).map((r) => (
          <DeliveryItem key={r.card.deliveryId} r={r} sel={sel} />
        ))}
        {rows.length === 0 && <li className="c-empty">{needle ? '찾는 배송이 없습니다.' : emptyText(f, app.sim.mode)}</li>}
        {rows.length > MAX_DELIVERIES && <li className="c-empty">앞 {MAX_DELIVERIES}건만 — 찾기·상태 탭으로 좁혀 보세요.</li>}
      </ul>
    </>
  );
}

function emptyText(f: OpsFilter | null, mode: 'mock' | 'http'): string {
  if (f === 'active') return mode === 'mock' ? '진행 중인 배송이 없습니다 — MOCK 주문이 들어오면 생깁니다.' : '진행 중인 배송이 없습니다 — 점원이 배차 요청을 하면 생깁니다.';
  if (f === 'delayed') return '지연된 배송이 없습니다.';
  if (f && f !== 'failedCalls') return `${FILTER_LABEL[f]} 배송이 없습니다(최근 목록 안).`;
  return '배송이 없습니다.';
}

/** 배송 카드 — 번호·상태 칩·걸린 시간 / 라이더·단계 / 지연(바로고처럼 늦으면 붉은 배경·왼쪽 띠). 누르면 지도 위 상세 */
function DeliveryItem({ r, sel }: { r: OpsRow; sel: string | null }) {
  const app = useApp();
  const c = r.card;
  const stage = displayStage(c.dispatchState, c.executionState, c.radiusKm, c.purpose);
  const tag = purposeLabel(c.purpose);
  const picked = app.selectedDelivery === c.deliveryId;
  const active = ACTIVE.has(r.bucket);
  const over = r.alert?.overSec !== undefined && r.alert.overSec > 0 ? Math.max(1, Math.round(r.alert.overSec / 60)) : null;
  return (
    <li>
      <button
        className={`c-item b-${r.bucket} ${picked ? 'picked' : ''} ${r.alert ? `al-${r.alert.level}` : ''}`}
        aria-pressed={picked}
        title={`배송 ${c.deliveryId}${c.orderId ? ` · 주문 ${c.orderId}` : ''} — 누르면 지도에서 보여 주고 상세`}
        onClick={() => app.selectDelivery(c.deliveryId)}
      >
        <div className="c-item-1">
          <b className="c-no">{deliveryLabel(c)}</b>
          {tag && <span className="c-tag">{tag}</span>}
          <span className={`c-st b-${r.bucket}`}>{BUCKET_CHIP[r.bucket] === '끝남' ? stage.text : BUCKET_CHIP[r.bucket]}</span>
          <span className="c-time">{r.totalSec === null ? '' : active ? `${dur(r.totalSec)} 경과` : `총 ${dur(r.totalSec)}`}</span>
        </div>
        <div className="c-item-2">
          {sel ? (
            <span className={`c-role ${roleOf(c, sel) === '배정' ? 'mine' : ''}`}>{roleOf(c, sel)}</span>
          ) : (
            <span className="c-rider" title={c.riderId ?? ''}>
              {c.riderId ? `🛵 ${shortRiderId(c.riderId)}` : '라이더 없음'}
            </span>
          )}
          <span className="c-stage">{stage.text}</span>
          {!c.deliveryNumber && orderLabel(c) && <span className="c-muted">주문 {orderLabel(c)}</span>}
        </div>
        {r.alert && (
          <div className={`c-item-al ${r.alert.level}`}>
            {over !== null && <b>+{over}분</b>} {r.alert.title} — {r.alert.detail.split(' — ').at(-1)}
          </div>
        )}
      </button>
    </li>
  );
}

// ─────────────── 라이더 ───────────────

type RiderShow = 'all' | 'busy' | 'stale' | 'app';

function jobText(j: RiderJob): string {
  const parts: string[] = [];
  if (j.orderNumber) parts.push(`주문 ${j.orderNumber}`);
  if (j.lines !== null) parts.push(`품목 ${j.lines}종`);
  if (j.itemAmount !== null) parts.push(`${j.itemAmount.toLocaleString('ko-KR')}원`);
  if (j.etaSec !== null) parts.push(`예상 ${Math.max(1, Math.round(j.etaSec / 60))}분`);
  return parts.join(' · ');
}

/** 라이더 목록(PayBell 기사 관제처럼) — 상태 색·이름·단계·진행 중 배송·걸린 시간. 누르면 지도에서 찾고 배송 탭이 그 라이더로 걸러진다 */
function RidersView() {
  const app = useApp();
  const b = app.board();
  const all = app.sim.riders;
  const [q, setQ] = useState('');
  const [show, setShow] = useState<RiderShow>('all');
  const rowOf = new Map(b.rows.map((x) => [x.card.deliveryId, x]));
  const doneOf = (id: string) => b.rows.filter((x) => x.card.riderId === id && x.bucket === 'done').length;
  const needle = q.trim().toLowerCase();
  const counts = { all: all.length, busy: all.filter((r) => r.deliveryId).length, stale: all.filter((r) => r.locationOffline).length, app: all.filter((r) => r.external).length };
  const riders = all
    .filter((r) => (show === 'busy' ? !!r.deliveryId : show === 'app' ? !!r.external : show === 'stale' ? !!r.locationOffline : true))
    .filter((r) => !needle || [r.id, r.label ?? '', r.deliveryId ?? ''].some((x) => x.toLowerCase().includes(needle)))
    .sort((x, y) => Number(!!y.locationOffline) - Number(!!x.locationOffline) || Number(!!y.deliveryId) - Number(!!x.deliveryId));
  return (
    <>
      <div className="c-status" role="tablist" aria-label="라이더 거르기">
        {(
          [
            ['all', '전체'],
            ['busy', '배송 중'],
            ['stale', '위치 끊김'],
            ['app', '라이더 앱'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={show === k} className={`${show === k ? 'on' : ''} ${k === 'stale' && counts.stale ? 'hot' : ''}`} onClick={() => setShow(k)}>
            {l} <b>{counts[k]}</b>
          </button>
        ))}
      </div>
      <input className="c-search" type="search" placeholder="이름 · 번호 · 배송번호 찾기" value={q} onChange={(e) => setQ(e.target.value)} aria-label="라이더 찾기" />
      <ul className="c-list">
        {riders.map((r) => (
          <RiderItem key={r.id} r={r} row={r.deliveryId ? rowOf.get(r.deliveryId) : undefined} done={doneOf(r.id)} />
        ))}
        {riders.length === 0 && <li className="c-empty">맞는 라이더가 없습니다.</li>}
      </ul>
    </>
  );
}

function RiderItem({ r, row, done }: { r: RiderView; row: OpsRow | undefined; done: number }) {
  const app = useApp();
  const sel = app.selected === r.id;
  return (
    <li>
      <button className={`c-item c-rider-item ${sel ? 'picked' : ''} ${r.locationOffline ? 'al-warn' : ''}`} style={{ ['--ph' as string]: PHASE_COLOR[r.phase] }} aria-pressed={sel} onClick={() => app.select(sel ? null : r.id)}>
        <div className="c-item-1">
          <span className="c-dot" />
          <b className="c-no" title={r.id}>
            {r.label ?? r.id}
          </b>
          {r.external && <span className="c-tag">라이더 앱</span>}
          <span className="c-ph">{PHASE_LABEL[r.phase]}</span>
          <span className="c-time" title="완료한 배송(최근 목록 안)">
            완료 {done}
          </span>
        </div>
        <div className="c-item-2">
          {row ? (
            <>
              <span className="c-rider">📦 {deliveryLabel(row.card)}</span>
              <span className="c-stage">{row.totalSec !== null ? `${dur(row.totalSec)} 경과` : ''}</span>
              {row.alert && <span className={`c-mini ${row.alert.level}`}>{row.alert.title}</span>}
            </>
          ) : (
            <span className="c-stage c-muted">{r.note ? friendlyNote(r.note) : '대기'}</span>
          )}
        </div>
        {r.deliveryId && r.job && <div className="c-item-3">{jobText(r.job)}</div>}
        {r.locationOffline && <div className="c-item-al warn">📡 위치가 안 들어옴 — 3분 넘으면 위치 끊김 사건(배송 상태는 그대로)</div>}
      </button>
      {sel && (
        <div className="c-item-actions">
          <button className={`c-btn-s ${app.follow ? 'on' : ''}`} aria-pressed={app.follow} onClick={() => app.toggleFollow()}>
            {app.follow ? '따라가는 중' : '지도에서 따라가기'}
          </button>
          <button className="c-btn-s" onClick={() => app.setPanelTab('deliveries')}>
            이 라이더 배송 보기
          </button>
        </div>
      )}
    </li>
  );
}

// ─────────────── 기록 ───────────────

/** 문제로 보이는 연결 상태 줄 — 실패·못 읽음·없음·거절·막음 */
const DIAG_BAD = /실패|못 읽|못 봄|없음|거절|막음|잠김|403|5\d\d/;

type LogTab = 'orders' | 'events' | 'api' | 'notes' | 'conn' | 'avg';

function LogsView() {
  const app = useApp();
  const { sim } = app;
  const sel = app.selected;
  const failedOnly = app.filter === 'failedCalls';
  const [tab, setTab] = useState<LogTab>(failedOnly ? 'api' : 'orders');
  const t = (at: number) => seoulTime(sim.clock.epochMs(at));
  const b = app.board();
  const cards = b.rows.filter((r) => !sel || r.card.riderId === sel || r.card.riderIds.includes(sel)).map((r) => r.card);
  const diag = sim.diagnostics();
  const cur: LogTab = failedOnly ? 'api' : tab;
  return (
    <>
      <div className="c-status" role="tablist" aria-label="기록 종류">
        {(
          [
            ['orders', '주문 흐름'],
            ['events', '사건'],
            ['api', 'API'],
            ['notes', '엔진 기록'],
            ['conn', '연결 상태'],
            ['avg', '구간 평균'],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            role="tab"
            aria-selected={cur === k}
            className={`${cur === k ? 'on' : ''} ${k === 'conn' && diag.some((d) => DIAG_BAD.test(d)) ? 'hot' : ''}`}
            onClick={() => {
              if (failedOnly) app.setFilter('active', true);
              setTab(k);
            }}
          >
            {l}
          </button>
        ))}
      </div>
      {cur === 'orders' && <OrdersTab cards={cards} />}
      {cur === 'events' && (
        <ul className="log">
          {eventsFor(sim.eventLog, cards, sel)
            .reverse()
            .slice(0, MAX_LOG)
            .map((e, i) => (
              <li key={i}>
                <span className="time">{t(e.at)}</span> <code>{e.type}</code> {e.summary}
              </li>
            ))}
          {sim.mode === 'http' && <li className="c-empty">실서버는 사건을 받지 못합니다 — 조회 결과로 추정한 것만 보입니다.</li>}
        </ul>
      )}
      {cur === 'api' && (
        <ul className="log">
          {failedOnly && (
            <li className="log-help">
              {sim.mode === 'mock'
                ? '응답 끊김 = MOCK 이 일부러 응답을 지운 쓰기 요청. 라이더가 같은 Idempotency-Key 로 다시 보내 결과가 한 번만 반영된다.'
                : '요청 실패 = 응답이 없거나(네트워크·시간 초과) 백엔드가 5xx(서버 오류·잠시 못 씀)로 답한 요청. 이 화면을 연 뒤 누적이고, 대부분 조회라 다음 박자(5초)에 다시 읽는다. 한꺼번에 오르면 백엔드 배포·재시작 중인 경우가 많다.'}{' '}
              <button className="c-link" onClick={() => app.setFilter('active', true)}>
                전체 API 보기
              </button>
            </li>
          )}
          {apiFor(sim.apiLog, sel)
            .filter((r) => !failedOnly || isFailedCall(r))
            .reverse()
            .slice(0, MAX_LOG)
            .map((r, i) => (
              <li key={i} className={isFailedCall(r) || (typeof r.status === 'number' && r.status >= 400) ? 'warn' : ''}>
                <span className="time">{t(r.at)}</span> <span className="actor">{r.actor.startsWith('RD-') ? shortRiderId(r.actor) : r.actor}</span> {r.method} {r.path} <b>{r.status}</b>
                {r.code ? ` ${r.code}` : ''}
              </li>
            ))}
        </ul>
      )}
      {cur === 'notes' && (
        <ul className="log">
          {notesFor(sim.notes, sel)
            .reverse()
            .slice(0, MAX_LOG)
            .map((n, i) => (
              <li key={i}>
                <span className="time">{t(n.at)}</span> {!sel && <span className="actor">{shortRiderId(n.riderId)}</span>} {n.text}
              </li>
            ))}
          {sim.notes.length === 0 && <li className="c-empty">가상 라이더 진행 기록(엔진 기준 — 백엔드 상태 아님). 라이더가 움직이면 쌓입니다.</li>}
        </ul>
      )}
      {cur === 'conn' && (
        <ul className="c-conn">
          {diag.map((d) => (
            <li key={d} className={DIAG_BAD.test(d) ? 'bad' : ''}>
              {d}
            </li>
          ))}
          {diag.length === 0 && <li>MOCK — 외부 연결 없음.</li>}
        </ul>
      )}
      {cur === 'avg' && <PhaseSummary m={sim.metrics()} open />}
    </>
  );
}
