import { useState, type ReactNode } from 'react';
import { useApp } from '../app/App';
import { isSimRiderId } from '../config';
import { deliveryName, riderDisplayLabel } from '../domain/riderId';
import type { OpsRow } from './ops';
import { dur, seoulTime } from './format';
import { DropAddress } from './MapDetail';
import { locStatus, rowMatchesRider, rowsFromControl, rowsFromRiders, vehicleName, type RiderRow, type RiderTableFilter } from './riderTable';

/*
 * 라이더 관제(기본 화면) — 라이더 백오피스 "라이더 관제"와 같은 짜임(사용자 2026-11-19 "똑같이 해봐"):
 *   위 숫자 카드(운행 중·배송 중·대기·위치 끊김·없음) → [왼쪽 라이더 목록 | 지도 | 오른쪽 고른 라이더 상세].
 *   라이더를 누르면 오른쪽에 그 라이더와 진행 중 배송이 바로 나오고, "배송 상세 · 조치"는 이 시뮬레이터 주문 창(상세·주문·흐름·원래 상태)을 연다.
 * 실서버 이 PC = 관제 응답(GET /rider-locations) + 라이더 찾기·운행시간(관제 계정), 그 밖(MOCK·다른 기기) = 화면 라이더(모르는 칸은 —).
 * 롤백 지점: 태그 before-rider-control-layout.
 */

const STAGE_LABEL: Record<string, string> = { TO_STORE: '가게로', AT_STORE: '가게 도착', TO_CUSTOMER: '고객에게', AT_CUSTOMER: '고객 도착' };
const STEPS = ['TO_STORE', 'AT_STORE', 'TO_CUSTOMER', 'AT_CUSTOMER'] as const;
const RESTRICTION: Record<string, string> = { NORMAL: '정상', NEW_DISPATCH_BLOCKED: '신규배차 제한', SUSPENDED: '일시 중지', TERMINATED: '계약 종료' };

/** 이 화면의 라이더 줄 — 실서버 이 PC 는 관제 응답(운행 중 라이더만), 그 밖은 화면 라이더. 이름·번호는 라이더 찾기로 보탠다 */
function useRiderRows(): RiderRow[] {
  const app = useApp();
  const { sim } = app;
  const board = sim.controlBoard?.() ?? null;
  const rows = board ? rowsFromControl(board.items, isSimRiderId) : rowsFromRiders(sim.riders, isSimRiderId);
  return rows.map((r) => {
    const info = sim.riderInfo?.(r.id);
    if (!info || (!info.nameMasked && !info.riderNumber)) return r;
    return { ...r, name: riderDisplayLabel(info.riderNumber, info.nameMasked), nameMasked: info.nameMasked ?? r.nameMasked ?? null };
  });
}

/** 끊김(문제) = 배송 중이거나 신규배차를 켠 라이더의 위치 끊김·없음. 배송 없고 꺼 둔 라이더는 "쉬는 중"(riderTable.locStatus) */
const isStale = (r: RiderRow) => locStatus(r) === 'stale' || locStatus(r) === 'none';

/** 위치 칸 글자 — 수신 중(초록) · 끊김/위치 없음(빨강) · 쉬는 중(회색 — 배송 없음·신규배차 꺼짐, 문제 아님) */
function LocBadge({ r }: { r: RiderRow }) {
  const st = locStatus(r);
  if (st === 'ok') return <span className="rb-badge ok">수신 중</span>;
  if (st === 'rest')
    return (
      <span className="rb-badge rest" title="배송 없고 신규배차를 꺼 둔 라이더 — 위치가 안 들어와도 문제 아님(운행을 마쳤을 수 있음)">
        쉬는 중
      </span>
    );
  return <span className="rb-badge bad">{st === 'stale' ? '끊김' : '위치 없음'}</span>;
}
const isDelivering = (r: RiderRow) => r.deliveries.length > 0;

/** "11. 19. 오후 3:14 · 3분 남음" */
function etaText(iso: string | null, nowMs: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const left = Math.max(0, Math.round((t - nowMs) / 60_000));
  return `${seoulTime(t).slice(0, 5)} · ${left}분 남음`;
}

/**
 * 머리(백오피스처럼): 왼쪽 제목·설명, 오른쪽 "주문번호·라이더 찾기"(라이더 번호·이름·ID 또는 주문번호·배송번호 → 그 라이더를 고르고 배송이면 주문 창)·센터.
 */
export function RiderHead() {
  const app = useApp();
  const { sim } = app;
  const rows = useRiderRows();
  const [q, setQ] = useState('');
  const [miss, setMiss] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const find = () => {
    const r = findTarget(q, rows, app.board().rows);
    setHint(r.kind === 'many' ? `${r.count}개가 맞아요 — 더 길게 적어 주세요(첫 번째를 보여 줘요).` : null);
    setMiss(r.kind === 'none');
    if (r.kind === 'none') return;
    // 거르기 때문에 목록에서 안 보이면 안 되니 전체로
    app.setRiderFilter('all');
    if (r.riderId) app.select(r.riderId);
    if (r.deliveryId) app.selectDelivery(r.deliveryId, true);
    // 목록에서 그 라이더 줄로 내려 준다
    const id = r.riderId;
    if (id) requestAnimationFrame(() => document.getElementById(`rb-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };
  return (
    <>
      <div className="rb-head">
        <div>
          <h2>라이더 관제</h2>
          <p>운행 중인 라이더의 지금 위치예요(이동 이력은 보이지 않아요). {sim.mode === 'http' ? '10초마다 새로 불러와요.' : '가상(MOCK) 라이더예요.'}</p>
        </div>
        <form
          className="rb-find"
          onSubmit={(e) => {
            e.preventDefault();
            find();
          }}
        >
          <label>
            <span>주문번호·라이더 찾기</span>
            <span className="rb-find-row">
              <input value={q} onChange={(e) => (setQ(e.target.value), setMiss(false), setHint(null))} placeholder="주문번호 8자리 · 배송 D번호 · 라이더 R번호 · 라이더 ID" />
              <button type="submit" disabled={!q.trim()}>
                찾기
              </button>
            </span>
            {miss && <small className="rb-miss">지금 화면에서 못 찾았어요(운행 중 라이더·최근 배송 안).</small>}
            {hint && <small className="rb-miss">{hint}</small>}
          </label>
          <label>
            <span>센터</span>
            <select disabled value={sim.params.mfcId} title="지점은 머리줄 1호점·2호점 단추로 바꿈">
              <option value={sim.params.mfcId}>{sim.params.mfcName} ({sim.params.mfcId})</option>
            </select>
          </label>
        </form>
      </div>
      <RiderKpis />
    </>
  );
}

/** 위 숫자 카드 — 누르면 목록이 그것만(백오피스와 같은 기준: 끊김 = 끊김 또는 위치 없음, 대기 = 배송 없음 · 끊김 아님) */
export function RiderKpis() {
  const app = useApp();
  const { sim } = app;
  const rows = useRiderRows();
  const board = sim.controlBoard?.() ?? null;
  const f = app.riderFilter;
  const card = (key: RiderTableFilter | null, label: string, n: number, dot: string, hint?: string) => (
    <button className={`rb-kpi ${key && f === key ? 'on' : ''} ${dot === 'red' && n > 0 ? 'alert' : ''}`} onClick={() => key && app.setRiderFilter(f === key && key !== 'all' ? 'all' : key)} disabled={!key}>
      <span className="rb-kpi-l">
        {dot && <i className={`rb-dot ${dot}`} />}
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <b>{n}명</b>
    </button>
  );
  return (
    <div className="rb-kpis">
      {card('all', '운행 중', rows.length, '', board ? `${seoulTime(Date.parse(board.asOf))} 기준` : sim.mode === 'mock' ? '가상(MOCK)' : '시뮬레이터 라이더만')}
      {card('delivering', '배송 중', rows.filter(isDelivering).length, 'blue')}
      {card('waiting', '대기', rows.filter((r) => rowMatchesRider(r, 'waiting')).length, 'green')}
      {card('stale', '위치 끊김·없음', rows.filter(isStale).length, 'red')}
    </div>
  );
}

/** 거른 목록이 비었을 때 */
const EMPTY: Record<RiderTableFilter, string> = {
  all: '운행 중인 라이더가 없어요.',
  delivering: '배송 중인 라이더가 없어요.',
  waiting: '대기 중인 라이더가 없어요.',
  stale: '위치가 끊긴 라이더가 없어요.',
  sim: '시뮬레이터 라이더가 없어요.',
  app: '라이더 앱 라이더가 없어요.',
};

const LIST_FILTERS: readonly (readonly [RiderTableFilter, string])[] = [
  ['all', '전체'],
  ['delivering', '배송 중'],
  ['waiting', '대기'],
  ['stale', '위치 끊김·없음'],
  ['sim', '시뮬 라이더만'],
];

/** 왼쪽 라이더 목록 — 이름·번호, 끊김/수신, 수단·신규배차·마지막 수신, 좌표, 진행 중 배송 */
export function RiderList() {
  const app = useApp();
  const { sim } = app;
  const rows = useRiderRows();
  const ops = app.board();
  const cardOf = new Map(ops.rows.map((r) => [r.card.deliveryId, r]));
  const nowMs = sim.clock.epochMs();
  const shown = rows.filter((r) => rowMatchesRider(r, app.riderFilter));
  const stale = rows.filter(isStale).length;
  return (
    <section className="rb-list" aria-label="라이더 목록">
      <div className="rb-list-head">
        <div className="rb-list-title">
          <h3>라이더 목록</h3>
          <span>
            <b className="rb-count">{rows.length}명</b>
            {stale > 0 && <span className="rb-pill red">위치 끊김 {stale}명</span>}
          </span>
        </div>
        <div className="rb-chips">
          {LIST_FILTERS.map(([k, l]) => (
            <button key={k} className={app.riderFilter === k ? 'on' : ''} onClick={() => app.setRiderFilter(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <ul className="rb-items">
        {shown.map((r) => {
          const sel = app.selected === r.id;
          return (
            <li key={r.id}>
              <button id={`rb-${r.id}`} className={`rb-item ${sel ? 'sel' : ''} ${isStale(r) ? 'stale' : ''}`} onClick={() => app.select(r.id)} title={r.id}>
                <span className="rb-item-1">
                  <b>{r.name}</b>
                  <LocBadge r={r} />
                </span>
                <span className="rb-item-2">
                  {[
                    vehicleName(r.vehicle),
                    r.dispatchOn === null ? null : `신규배차 ${r.dispatchOn ? '켬' : '끔'}`,
                    locStatus(r) === 'rest' ? '위치 공유 안 함' : r.sinceSec === null ? null : `${dur(r.sinceSec)} 전`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {r.pos && locStatus(r) !== 'rest' && <span className="rb-coord">{`${r.pos.lat.toFixed(5)}, ${r.pos.lng.toFixed(5)}`}</span>}
                {r.deliveries.map((d) => {
                  const op = cardOf.get(d.deliveryId);
                  const eta = etaText(d.etaDrop, nowMs);
                  return (
                    <span key={d.deliveryId} className="rb-item-del">
                      <span className="rb-item-del-1">
                        <b>{op ? deliveryName(op.card) : d.deliveryId.slice(-8)}</b>
                        <span className="rb-stage">{d.stageKey ? (STAGE_LABEL[d.stageKey] ?? d.stage) : d.stage}</span>
                      </span>
                      <span className="rb-item-del-2">{[op?.card.orderNumber ? `#${op.card.orderNumber}` : null, `픽업 ${sim.params.mfcName}`].filter(Boolean).join(' · ')}</span>
                      {eta && <span className="rb-item-del-2">도착 예정 {eta.split(' · ')[0]}</span>}
                    </span>
                  );
                })}
              </button>
            </li>
          );
        })}
        {shown.length === 0 && <li className="rb-empty">{rows.length ? EMPTY[app.riderFilter] : '운행 중인 라이더가 없어요.'}</li>}
      </ul>
      <p className="rb-list-foot">{sim.mode === 'http' ? (sim.controlBoard?.() ? '10초마다 새로 불러와요' : '이 기기에서는 시뮬레이터 라이더만(라이더 앱 위치는 개발 서버 PC 에서만)') : '가상(MOCK) 라이더'}</p>
    </section>
  );
}

/** 오른쪽 고른 라이더 상세 — 머리(이름·수단·신규배차·제한·가린 전화·가입일) → 칸(위치·전달 상황·접속·대기·오늘 운행) → 진행 중 배송 카드 */
export function RiderPanel() {
  const app = useApp();
  const { sim } = app;
  const rows = useRiderRows();
  const id = app.selected;
  if (!id) {
    return (
      <aside className="rb-panel empty" aria-label="라이더 상세">
        왼쪽 목록이나 지도에서 라이더를 고르면 위치·전달 상황·운행 시간이 여기에 보여요.
      </aside>
    );
  }
  const row = rows.find((r) => r.id === id);
  const info = sim.riderInfo?.(id) ?? null;
  const nowMs = sim.clock.epochMs();
  const ago = (iso: string | null) => (iso ? Math.max(0, (nowMs - Date.parse(iso)) / 1000) : null);
  const op = sim.operatingTime?.(id);
  const sum = (v: number | null | undefined) => (!op || op.state === 'none' ? '—' : op.state === 'loading' ? '…' : v == null ? '못 불러옴' : hm(v));
  const opsRows = app.board().rows;
  const restriction = row?.restriction ?? info?.restriction ?? 'NORMAL';
  const name = row?.name ?? (riderDisplayLabel(info?.riderNumber, info?.nameMasked) || id);
  const masked = info?.nameMasked ?? row?.nameMasked ?? null;
  const onDuty = ago(row?.onDutySince ?? null);
  const waiting = ago(row?.waitingSince ?? null);
  return (
    <aside className="rb-panel" aria-label="라이더 상세">
      <div className="rb-panel-head">
        <div>
          <div className="rb-name" title={[masked, id].filter(Boolean).join(' · ')}>
            {name}
          </div>
          {row && <div className="rb-sub">{[vehicleName(row.vehicle), row.dispatchOn === null ? null : `신규배차 ${row.dispatchOn ? '켬' : '끔'}`].filter(Boolean).join(' · ')}</div>}
          <div className="rb-info">
            <span className={`rb-badge ${restriction === 'NORMAL' ? 'plain' : 'bad'}`}>{RESTRICTION[restriction] ?? restriction}</span>
            {masked && masked !== name && <span>{masked}</span>}
            {info?.phoneMasked && <span className="rb-mono">{info.phoneMasked}</span>}
            {info?.joinedAt && <span>가입 {stamp(info.joinedAt)}</span>}
          </div>
        </div>
        <button className="rb-close" onClick={() => app.select(null)}>
          닫기
        </button>
      </div>
      {!row && <p className="rb-gone">이 라이더는 지금 이 센터의 운행 목록에 없어요(운행 종료·다른 센터).</p>}

      <div className="rb-tiles">
        <Tile
          label="위치"
          tone={!row ? undefined : locStatus(row) === 'rest' ? undefined : row.loc === 'ok' ? 'ok' : 'bad'}
          value={
            !row
              ? '—'
              : locStatus(row) === 'rest'
                ? <span className="rb-dim">쉬는 중 · 위치 공유 안 함</span>
                : row.loc === 'ok'
                  ? `수신 중${row.sinceSec !== null ? ` · ${dur(row.sinceSec)} 전` : ''}`
                  : row.loc === 'stale'
                    ? '끊김'
                    : '위치 없음'
          }
          hint={
            !row
              ? undefined
              : locStatus(row) === 'rest'
                ? '맡은 배송 없고 신규배차 꺼짐 — 위치를 공유하지 않아요(지도에 안 보임, 문제 아님)'
                : row.loc !== 'ok' && row.sinceSec !== null
                  ? `마지막 수신 ${dur(row.sinceSec)} 전`
                  : undefined
          }
        />
        <Tile
          label="전달 상황"
          tone={!row ? undefined : row.deliveries.length ? 'info' : row.waitingSince ? 'ok' : undefined}
          value={!row ? '—' : row.deliveries.length ? `배송 중 ${row.deliveries.length}건` : waiting !== null ? `대기 ${dur(waiting)}째` : '대기 아님'}
          hint={
            !row
              ? undefined
              : row.deliveries.length
                ? row.deliveries.map((d) => (d.stageKey ? (STAGE_LABEL[d.stageKey] ?? d.stage) : d.stage)).join(' · ')
                : row.waitingSince
                  ? `${seoulTime(Date.parse(row.waitingSince)).slice(0, 5)}부터`
                  : row.dispatchOn === false
                    ? '신규배차 꺼짐 — 대기로 세지 않아요'
                    : undefined
          }
        />
        <Tile
          label="접속 시간"
          value={onDuty !== null ? `${dur(onDuty)}째` : <span className="rb-dim">{row ? '—' : '운행 끝'}</span>}
          hint={[row?.onDutySince ? `운행 시작 ${seoulTime(Date.parse(row.onDutySince)).slice(0, 5)}` : null, `오늘 ${sum(op?.state === 'ok' ? op.connectedSec : null)}`, '운행을 켜 둔 시간'].join(' · ')}
        />
        <Tile label="대기 시간" value={sum(op?.state === 'ok' ? op.waitingSec : null)} hint="오늘 합계 · 운행 중 · 신규배차 켬 · 맡은 배송 0건" />
        <Tile wide label="오늘 운행시간" value={op?.state === 'ok' ? hm(op.totalSec) : op?.state === 'loading' ? '…' : '—'} hint={op?.state === 'none' ? op.reason : '배차 수락 ~ 전달 완료 합계'} />
      </div>

      {row?.deliveries.map((d) => <DeliveryCard key={d.deliveryId} d={d} op={opsRows.find((r) => r.card.deliveryId === d.deliveryId)} nowMs={nowMs} />)}
    </aside>
  );
}

function DeliveryCard({ d, op, nowMs }: { d: RiderRow['deliveries'][number]; op: OpsRow | undefined; nowMs: number }) {
  const app = useApp();
  const at = d.stageKey ? STEPS.indexOf(d.stageKey as (typeof STEPS)[number]) : -1;
  const orderId = op?.card.orderId ?? null;
  const ov = orderId ? app.sim.orders?.detail(orderId) : undefined;
  const items = ov?.state === 'ok' ? ov.detail.lines : [];
  const pickup = etaText(d.etaPickup, nowMs);
  const drop = etaText(d.etaDrop, nowMs);
  return (
    <div className={`rb-del ${app.selectedDelivery === d.deliveryId ? 'focus' : ''}`}>
      <div className="rb-del-no">{op ? deliveryName(op.card) : d.deliveryId}</div>
      <ol className="rb-steps" aria-label="진행 단계">
        {STEPS.map((s, i) => (
          <li key={s} className={i === at ? 'now' : i < at ? 'past' : ''} aria-current={i === at ? 'step' : undefined}>
            {STAGE_LABEL[s]}
          </li>
        ))}
      </ol>
      <dl className="rb-eta">
        <dt>가게 도착</dt>
        <dd>{pickup ?? '—'}</dd>
        <dt>고객 도착</dt>
        <dd>{drop ?? '—'}</dd>
      </dl>
      <ul className="rb-route">
        <li className="p">
          <b>픽업 · {app.sim.params.mfcName}</b>
        </li>
        <li className="d">
          <DropAddress deliveryId={d.deliveryId} open />
        </li>
      </ul>
      {items.length > 0 && (
        <p className="rb-items-line">
          {items.map((l) => `${l.productName ?? l.sku} × ${l.originalQty ?? '—'} · ${(l.lineAmount ?? 0).toLocaleString('ko-KR')}원`).join(', ')}
        </p>
      )}
      <div className="rb-del-f">
        <button className="c-btn-s" onClick={() => app.selectDelivery(d.deliveryId, true)} disabled={!op} title={op ? '이 시뮬레이터 주문 창(상세·주문·흐름·원래 상태)을 연다' : '이 화면 배송 목록에 아직 없음'}>
          배송 상세 · 조치
        </button>
      </div>
    </div>
  );
}

function Tile({ label, value, hint, tone, wide }: { label: string; value: ReactNode; hint?: string; tone?: 'ok' | 'bad' | 'info'; wide?: boolean }) {
  return (
    <div className={`rb-tile ${wide ? 'wide' : ''}`}>
      <span className="l">{label}</span>
      <span className={`v ${tone ?? ''}`}>{value}</span>
      {hint && <span className="h">{hint}</span>}
    </div>
  );
}

/** 초 → "1시간 20분"·"14분" */
function hm(sec: number): string {
  const m = Math.floor(sec / 60);
  const h = Math.floor(m / 60);
  return h ? `${h}시간 ${m % 60}분` : `${m}분`;
}

/** "11. 17. 오후 3:34" */
function stamp(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t + 9 * 3600_000);
  const h = d.getUTCHours();
  return `${d.getUTCMonth() + 1}. ${d.getUTCDate()}. ${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** 찾기 비교용 — 대소문자·공백·하이픈·가운뎃점·가림 별표를 뺀다("RD-sim-01" = "rdsim01", "이* · R4785" = "이r4785") */
export function normKey(x: string | null | undefined): string {
  return (x ?? '').toLowerCase().replace(/[\s\-·*]/g, '');
}

export type FindResult =
  | { kind: 'none' }
  | { kind: 'one' | 'many'; riderId: string | null; deliveryId: string | null; count: number };

/**
 * 주문번호·라이더 찾기(백오피스 "주문번호 8자리 · 라이더 번호 R4785 · 라이더 ID") — 지금 화면의 운행 라이더·배송 목록 안에서.
 * 번호 모양(ADR-0085): 라이더 R4785 = r4785 = 4785, 배송 D74939255 = 74939255-1(순번 없음 = 1), D74939255-2 = 74939255-2.
 * 정확히 같은 것을 먼저, 없으면 들어 있는 것(4자 이상 — 번호 끝자리 등). 배송이 맞으면 그 라이더도 고른다.
 * (예전엔 적은 쪽만 하이픈을 빼서 sim-01·RD-…·DLV-… 가 안 찾아졌다 — 사용자 2026-11-19 "원활하지 않은 것 같아")
 */
export function findTarget(q: string, riders: readonly RiderRow[], deliveries: readonly OpsRow[]): FindResult {
  const n = normKey(q);
  if (!n) return { kind: 'none' };
  const riderKeys = (r: RiderRow) => [r.id, r.name, ...r.name.split('·'), r.nameMasked, /^R\d{4,5}$/i.test(r.name) ? r.name.slice(1) : null];
  const delNo = (no: string | null) => {
    const m = no ? /^D?(\d{8})(?:-(\d+))?$/i.exec(no) : null;
    return m ? [`D${m[1]}-${m[2] ?? 1}`, `${m[1]}-${m[2] ?? 1}`] : [];
  };
  const delKeys = (d: OpsRow) => [d.card.orderNumber, d.card.deliveryNumber, ...delNo(d.card.deliveryNumber), d.card.deliveryId, d.card.orderId];
  const exact = (keys: (string | null | undefined)[]) => keys.some((k) => k && normKey(k) === n);
  const part = (keys: (string | null | undefined)[]) => n.length >= 4 && keys.some((k) => k && normKey(k).includes(n));
  for (const test of [exact, part]) {
    const rs = riders.filter((r) => test(riderKeys(r)));
    const ds = deliveries.filter((d) => test(delKeys(d)));
    const count = rs.length + ds.length;
    if (!count) continue;
    const d = ds[0];
    const riderId = rs[0]?.id ?? d?.card.riderId ?? null;
    return { kind: count > 1 ? 'many' : 'one', riderId, deliveryId: rs.length ? null : (d?.card.deliveryId ?? null), count };
  }
  return { kind: 'none' };
}
