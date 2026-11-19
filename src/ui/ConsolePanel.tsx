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
import { Progress } from './Progress';
import { FILTER_LABEL, rowMatches, type OpsFilter, type OpsRow } from './ops';
import { OrdersTab } from './OrdersTab';
import { riderIndex, type RiderRow } from './riderTable';
import { groupRows, sortRows, type GroupBy, type RowGroup, type SortBy } from './listView';
import { isSimRiderId } from '../config';
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

/** 오른쪽 관제 패널 — 위 이상 상황 띠, 아래 탭(배송·라이더). 기록은 왼쪽 메뉴의 기록 화면(LogsPage). */
export function ConsolePanel() {
  const app = useApp();
  const b = app.board();
  const tab = app.panelTab;
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
      </div>
      <div className="c-body">
        {tab === 'deliveries' && <DeliveriesView />}
        {tab === 'riders' && <RidersView />}
      </div>
    </aside>
  );
}

/**
 * 배송 관제 왼쪽 배송 목록(사용자 2026-11-19 — 라이더는 라이더 관제로, 배송 관제는 [배송 목록 | 지도 | 배송 상세]):
 * 위 이상 상황 띠 + 배송 목록(상태 칸·찾기·묶기·정렬·계층). 배송을 누르면 오른쪽 칸에 상세가 크게 뜬다.
 */
export function DeliveryListPanel() {
  const app = useApp();
  const b = app.board();
  return (
    <aside className="c-panel dd-list" aria-label="배송 목록">
      <AlertStrip />
      <div className="dd-list-head">
        <h3>배송 목록</h3>
        <span className="c-n">진행 중 {b.counts.active}</span>
      </div>
      <div className="c-body">
        <DeliveriesView />
      </div>
    </aside>
  );
}

/** 기록 화면(왼쪽 메뉴) — 주문 흐름·사건·API·엔진 기록·연결 상태·구간 평균 */
export function LogsPage() {
  return (
    <section className="c-page" aria-label="기록">
      <div className="c-page-head">
        <div>
          <h2>기록</h2>
          <p>주문 흐름, 사건, API 요청, 가상 라이더 엔진 기록, 연결 상태, 구간 평균.</p>
        </div>
      </div>
      <div className="c-logs-card">
        <LogsView />
      </div>
    </section>
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
                    // 라이더 알림(배송 중 위치 끊김)은 보던 라이더 탭에 두고 배송 상세만 연다 — 탭을 옮기면 바로 못 본다(사용자 2026-11-19)
                    if (a.kind !== 'RIDER_STALE') app.setPanelTab('deliveries');
                    app.selectDelivery(a.deliveryId, true);
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

/** 라이더 위치 수신 한 단어(묶음 머리·카드) */
function RiderLoc({ r }: { r: RiderRow | undefined }) {
  if (!r) return null;
  return (
    <span className={`c-loc ${r.loc}`} title={r.sinceSec !== null ? `마지막 위치 ${dur(r.sinceSec)} 전` : undefined}>
      {r.loc === 'ok' ? '● 수신' : r.loc === 'stale' ? '● 끊김' : '● 위치 없음'}
    </span>
  );
}

/**
 * 라이더 묶음 머리(Onfleet 팀·기사 줄) — 둥근 머리글자(상태 색: 지연 빨강·배송 중 파랑·대기 회색), 이름, 상태 한 줄, 건수·지연, "지도".
 * 라이더 없는 묶음(배차 대기)은 Onfleet "Unassigned" 처럼.
 */
function TreeHead({ g, rider }: { g: RowGroup; rider: RiderRow | undefined }) {
  const app = useApp();
  if (!g.riderId) {
    return (
      <>
        <span className="c-ava wait" aria-hidden>
          ?
        </span>
        <span className="c-tree-txt">
          <b>배차 대기</b>
          <span className="c-tree-sub">라이더 찾는 중 · {g.rows.length}건</span>
        </span>
        {g.alerts > 0 && <span className="c-pill red">지연 {g.alerts}</span>}
      </>
    );
  }
  const tone = g.alerts ? 'bad' : rider?.loc && rider.loc !== 'ok' ? 'warn' : 'busy';
  return (
    <>
      <span className={`c-ava ${tone}`} aria-hidden>
        {/* 시뮬레이터 라이더는 번호(sim-01 → 01), 그 밖은 이름 첫 글자("김*수 · 482913" → 김) */}
        {/^sim-\d+$/.test(g.label) ? g.label.slice(4) : (g.label.trim()[0] ?? '?').toUpperCase()}
      </span>
      <span className="c-tree-txt">
        <b title={g.riderId}>{g.label}</b>
        <span className="c-tree-sub">
          배송 중 {g.rows.filter((r) => r.bucket === 'delivering').length}건
          {rider && (
            <>
              {' · '}
              <RiderLoc r={rider} />
              {rider.sinceSec !== null && ` ${dur(rider.sinceSec)} 전`}
            </>
          )}
        </span>
      </span>
      {g.alerts > 0 && <span className="c-pill red">지연 {g.alerts}</span>}
      <button
        className="c-link"
        onClick={(e) => {
          e.preventDefault();
          app.select(g.riderId as string);
        }}
        title="이 라이더를 지도에서 찾고 배송 목록을 이 라이더로"
      >
        지도
      </button>
    </>
  );
}

/** 라이더 묶음 안 배송 한 줄(Onfleet 작업 줄) — 순서 원·배송번호·단계·경과, 지연이면 붉게. 누르면 지도 위 상세 */
/** 배송 한 줄(번호·배송번호·상태·지금 단계 n째·지연·경과). rider = 단계별 묶음에서 라이더 이름(라이더별 묶음은 머리에 있으니 없음) */
function TaskRow({ r, n, rider }: { r: OpsRow; n: number; rider?: string }) {
  const app = useApp();
  const c = r.card;
  const stage = displayStage(c.dispatchState, c.executionState, c.radiusKm, c.purpose);
  const active = ACTIVE.has(r.bucket);
  const picked = app.selectedDelivery === c.deliveryId;
  const inStep = active && r.stepAtMs !== null ? Math.max(0, (app.sim.clock.epochMs() - r.stepAtMs) / 1000) : null;
  const over = r.alert?.overSec !== undefined && r.alert.overSec > 0 ? Math.max(1, Math.round(r.alert.overSec / 60)) : null;
  return (
    <li>
      <button className={`c-task b-${r.bucket} ${picked ? 'picked' : ''} ${r.alert ? `al-${r.alert.level}` : ''}`} onClick={() => app.selectDelivery(c.deliveryId)} title={`${c.deliveryId} — 누르면 지도에서 상세`}>
        <span className="c-task-n">{n}</span>
        <span className="c-task-main">
          <span className="c-task-1">
            <b>{deliveryLabel(c)}</b>
            <span className={`c-st b-${r.bucket}`}>{r.bucket === 'closed' ? stage.text : BUCKET_CHIP[r.bucket]}</span>
          </span>
          <span className="c-task-2">
            {rider !== undefined && <span className="c-task-rider">{rider} · </span>}
            {active ? (r.stepLabel ?? stage.text) : stage.text}
            {inStep !== null && ` · ${dur(inStep)}째`}
            {r.alert && (
              <em className={r.alert.level}>
                {' '}
                · {over !== null ? `+${over}분 ` : ''}
                {r.alert.title}
              </em>
            )}
          </span>
        </span>
        <span className="c-task-t">{r.totalSec === null ? '' : active ? dur(r.totalSec) : `총 ${dur(r.totalSec)}`}</span>
      </button>
    </li>
  );
}

/** 배송 없는 라이더(대기) — 접은 한 묶음(바로고 리뷰 "전체 라이더 숫자"). 오래 기다린 순 */
function IdleRiders({ busyIds }: { busyIds: Set<string> }) {
  const app = useApp();
  const idx = riderIndex(app.sim.controlBoard?.()?.items ?? null, app.sim.riders, isSimRiderId);
  const nowMs = app.sim.clock.epochMs();
  const idle = app.sim.riders
    .filter((r) => !busyIds.has(r.id) && !r.deliveryId)
    .map((r) => ({ r, row: idx.get(r.id) }))
    .sort((a, b) => (a.row?.waitingSince ? Date.parse(a.row.waitingSince) : Infinity) - (b.row?.waitingSince ? Date.parse(b.row.waitingSince) : Infinity));
  if (!idle.length) return null;
  return (
    <details className="c-group c-tree idle">
      <summary>
        <span className="c-ava idle" aria-hidden>
          {idle.length}
        </span>
        <span className="c-tree-txt">
          <b>대기 중 라이더</b>
          <span className="c-tree-sub">배송 없음 · {idle.length}명 · 오래 기다린 순</span>
        </span>
      </summary>
      <ul className="c-tasks">
        {idle.map(({ r, row }) => (
          <li key={r.id}>
            <button className="c-task" onClick={() => app.select(r.id)} title={`${r.id} — 누르면 지도에서 찾기`}>
              <span className="c-task-n idle">·</span>
              <span className="c-task-main">
                <span className="c-task-1">
                  <b>{row?.name ?? r.label ?? shortRiderId(r.id)}</b>
                  {r.external && <span className="c-tag">앱</span>}
                </span>
                <span className="c-task-2">
                  <RiderLoc r={row} />
                  {row?.waitingSince ? ` · 대기 ${dur((nowMs - Date.parse(row.waitingSince)) / 1000)}째` : ''}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

function DeliveriesView() {
  const app = useApp();
  const b = app.board();
  const f = app.filter;
  const sel = app.selected;
  const [q, setQ] = useState('');
  // 기본은 Onfleet 처럼 라이더별 계층(배차 대기 → 라이더마다 그 배송 1·2·3)
  const [groupBy, setGroupBy] = useState<GroupBy>('rider');
  const [sortBy, setSortBy] = useState<SortBy>('urgent');
  const needle = q.trim().toLowerCase();
  const riders = riderIndex(app.sim.controlBoard?.()?.items ?? null, app.sim.riders, isSimRiderId);
  const nameOf = (id: string) => riders.get(id)?.name ?? shortRiderId(id);
  const byRider = b.rows.filter((r) => !sel || r.card.riderId === sel || r.card.riderIds.includes(sel));
  const count = (k: OpsFilter | null) => byRider.filter((r) => rowMatches(r, k)).length;
  const matched = byRider
    .filter((r) => rowMatches(r, f === 'failedCalls' ? null : f))
    .filter((r) => {
      if (!needle) return true;
      const c = r.card;
      // 배송·주문 번호, 라이더 ID·짧은 번호, 라이더 이름("김*수 · 482913" — 화면 번호 6자리 포함)
      return [c.deliveryId, c.deliveryNumber, c.orderNumber, c.orderId, c.riderId, c.riderId ? shortRiderId(c.riderId) : null, c.riderId ? nameOf(c.riderId) : null].some((x) =>
        x?.toLowerCase().includes(needle),
      );
    });
  const rows = sortRows(matched, sortBy);
  const groups = groupRows(rows.slice(0, MAX_DELIVERIES), groupBy, nameOf);
  // 묶음이 많으면 지연 있는 묶음만 펼친다(라이더 100명이면 다 펼치면 못 본다) [시뮬]
  const openAll = groups.length <= 6;
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
      <input
        className="c-search"
        type="search"
        placeholder="배송·주문번호 · 라이더 이름·번호 찾기"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="배송 찾기"
      />
      <div className="c-view-row" aria-label="묶기·정렬">
        <span className="c-muted">묶기</span>
        <div className="c-mini-seg" role="group" aria-label="묶기">
          {(
            [
              ['none', '없음'],
              ['stage', '단계별'],
              ['rider', '라이더별'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={groupBy === k ? 'on' : ''} aria-pressed={groupBy === k} onClick={() => setGroupBy(k)}>
              {l}
            </button>
          ))}
        </div>
        <span className="c-muted">정렬</span>
        <select className="c-select" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} aria-label="정렬">
          <option value="urgent" title="지연 → 오래된 것">급한 순</option>
          <option value="longest">오래 걸린 순</option>
          <option value="recent">최근 순</option>
        </select>
        {needle && <span className="c-muted">{matched.length}건 일치</span>}
      </div>
      {rows.length === 0 && <p className="c-empty">{needle ? '찾는 배송이 없습니다.' : emptyText(f, app.sim.mode)}</p>}
      {groups.map((g) =>
        groupBy === 'none' ? (
          <ul key={g.key} className="c-list">
            {g.rows.map((r) => (
              <DeliveryItem key={r.card.deliveryId} r={r} sel={sel} rider={r.card.riderId ? riders.get(r.card.riderId) : undefined} />
            ))}
          </ul>
        ) : (
          <details key={g.key} className={`c-group ${groupBy === 'rider' ? 'c-tree' : ''} ${g.alerts ? 'hot' : ''}`} open={openAll || g.alerts > 0}>
            <summary>
              {groupBy === 'rider' ? (
                <TreeHead g={g} rider={g.riderId ? riders.get(g.riderId) : undefined} />
              ) : (
                <>
                  <span className="c-group-l">{g.label}</span>
                  <span className="c-n">{g.rows.length}</span>
                  {g.alerts > 0 && <span className="c-pill red">지연 {g.alerts}</span>}
                </>
              )}
            </summary>
            {groupBy === 'rider' ? (
              <ol className="c-tasks">
                {g.rows.map((r, i) => (
                  <TaskRow key={r.card.deliveryId} r={r} n={i + 1} />
                ))}
              </ol>
            ) : (
              // 단계별 — 한 줄씩(큰 카드면 한 묶음이 칸을 다 차지해 다음 단계가 안 보였다 — 사용자 2026-11-19 "보기 불편")
              <ol className="c-tasks">
                {g.rows.map((r, i) => (
                  <TaskRow key={r.card.deliveryId} r={r} n={i + 1} rider={r.card.riderId ? (riders.get(r.card.riderId)?.name ?? shortRiderId(r.card.riderId)) : '라이더 없음'} />
                ))}
              </ol>
            )}
          </details>
        ),
      )}
      {groupBy === 'rider' && !sel && !needle && (f === 'active' || f === null) && <IdleRiders busyIds={new Set(rows.map((r) => r.card.riderId).filter((x): x is string => !!x))} />}
      {rows.length > MAX_DELIVERIES && <p className="c-empty">앞 {MAX_DELIVERIES}건만 — 찾기·상태 탭으로 좁혀 보세요.</p>}
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
function DeliveryItem({ r, sel, rider }: { r: OpsRow; sel: string | null; rider: RiderRow | undefined }) {
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
        <div className="c-item-flow">
          <Progress stage={stage} compact />
        </div>
        <div className="c-item-2">
          {sel ? (
            <span className={`c-role ${roleOf(c, sel) === '배정' ? 'mine' : ''}`}>{roleOf(c, sel)}</span>
          ) : (
            <span className="c-rider" title={c.riderId ?? ''}>
              {c.riderId ? `🛵 ${rider?.name ?? shortRiderId(c.riderId)}` : '라이더 없음'}
            </span>
          )}
          {/* 진행 중이면 라이더 위치 수신 상태(관제·본인 조회) — 끊기면 빨강 */}
          {active && rider && (
            <span className={`c-loc ${rider.loc}`} title={rider.sinceSec !== null ? `마지막 위치 ${dur(rider.sinceSec)} 전` : undefined}>
              {rider.loc === 'ok' ? '● 수신' : rider.loc === 'stale' ? '● 끊김' : '● 위치 없음'}
              {rider.sinceSec !== null && ` ${dur(rider.sinceSec)} 전`}
            </span>
          )}
          {!c.deliveryNumber && orderLabel(c) && <span className="c-muted">주문 {orderLabel(c)}</span>}
        </div>
        <div className="c-item-2">
          <span className="c-stage">
            {active && r.stepLabel ? `${r.stepLabel}` : stage.text}
            {active && r.stepAtMs !== null && ` · ${dur(Math.max(0, (app.sim.clock.epochMs() - r.stepAtMs) / 1000))}째`}
          </span>
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
type RiderSort = 'attention' | 'waiting' | 'busy' | 'name';

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
  const [sortBy, setSortBy] = useState<RiderSort>('attention');
  const rowOf = new Map(b.rows.map((x) => [x.card.deliveryId, x]));
  const doneOf = (id: string) => b.rows.filter((x) => x.card.riderId === id && x.bucket === 'done').length;
  const idx = riderIndex(app.sim.controlBoard?.()?.items ?? null, all, isSimRiderId);
  const needle = q.trim().toLowerCase();
  const counts = { all: all.length, busy: all.filter((r) => r.deliveryId).length, stale: all.filter((r) => r.locationOffline).length, app: all.filter((r) => r.external).length };
  const nowMs = app.sim.clock.epochMs();
  // 주의 점수: 위치 끊김 > 지연 배송 > 배송 중 > 대기 (작을수록 위)
  const attention = (r: RiderView) => {
    const row = r.deliveryId ? rowOf.get(r.deliveryId) : undefined;
    if (r.locationOffline) return 0;
    if (row?.alert) return row.alert.level === 'bad' ? 1 : 2;
    return r.deliveryId ? 3 : 4;
  };
  const waitedSec = (r: RiderView) => {
    const w = idx.get(r.id)?.waitingSince;
    return w && !r.deliveryId ? (nowMs - Date.parse(w)) / 1000 : -1;
  };
  const elapsed = (r: RiderView) => (r.deliveryId ? (rowOf.get(r.deliveryId)?.totalSec ?? 0) : -1);
  const name = (r: RiderView) => idx.get(r.id)?.name ?? r.label ?? r.id;
  const riders = all
    .filter((r) => (show === 'busy' ? !!r.deliveryId : show === 'app' ? !!r.external : show === 'stale' ? !!r.locationOffline : true))
    .filter((r) => {
      if (!needle) return true;
      const row = r.deliveryId ? rowOf.get(r.deliveryId) : undefined;
      // ID·이름·화면 번호(6자리)·진행 중 배송·주문 번호
      return [r.id, name(r), r.deliveryId ?? '', row?.card.deliveryNumber ?? '', row?.card.orderNumber ?? ''].some((x) => x.toLowerCase().includes(needle));
    })
    .sort((x, y) => {
      if (sortBy === 'waiting') return waitedSec(y) - waitedSec(x) || attention(x) - attention(y);
      if (sortBy === 'busy') return Number(!!y.deliveryId) - Number(!!x.deliveryId) || elapsed(y) - elapsed(x);
      if (sortBy === 'name') return name(x).localeCompare(name(y), 'ko');
      return attention(x) - attention(y) || elapsed(y) - elapsed(x);
    });
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
      <input className="c-search" type="search" placeholder="이름 · 라이더 번호 · 배송·주문번호 찾기" value={q} onChange={(e) => setQ(e.target.value)} aria-label="라이더 찾기" />
      <div className="c-view-row" aria-label="정렬">
        <span className="c-muted">정렬</span>
        <select className="c-select" value={sortBy} onChange={(e) => setSortBy(e.target.value as RiderSort)} aria-label="라이더 정렬">
          <option value="attention" title="위치 끊김 → 지연 → 배송 중">주의 먼저</option>
          <option value="waiting">오래 기다린 순</option>
          <option value="busy">배송 중 먼저</option>
          <option value="name">이름순</option>
        </select>
        <span className="c-muted">{riders.length}명</span>
      </div>
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
              <Progress stage={displayStage(row.card.dispatchState, row.card.executionState, row.card.radiusKm, row.card.purpose)} compact />
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
          {row ? (
            // 배송 상세(주문 창)를 바로 연다 — 탭은 그대로(사용자 2026-11-19 "바로 옆 배송 칸으로 넘어가는 게 … 별로")
            <button className={`c-btn-s ${app.selectedDelivery === row.card.deliveryId ? 'on' : ''}`} onClick={() => app.selectDelivery(row.card.deliveryId, true)}>
              배송 상세 보기
            </button>
          ) : (
            <button className="c-btn-s" onClick={() => app.setPanelTab('deliveries')} title="진행 중 배송이 없음 — 배송 탭에서 이 라이더의 지난 배송">
              이 라이더 배송 목록
            </button>
          )}
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
