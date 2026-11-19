import type { ReactNode } from 'react';
import { useApp } from '../app/App';
import { isSimRiderId } from '../config';
import { deliveryLabel } from '../domain/riderId';
import type { OpsRow } from './ops';
import { dur, seoulTime } from './format';
import { DropAddress } from './MapDetail';
import { rowMatchesRider, rowsFromControl, rowsFromRiders, vehicleName, type RiderRow, type RiderTableFilter } from './riderTable';

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
    return { ...r, name: [info.nameMasked, info.riderNumber].filter(Boolean).join(' · ') };
  });
}

const isStale = (r: RiderRow) => r.loc !== 'ok';
const isDelivering = (r: RiderRow) => r.deliveries.length > 0;

/** "11. 19. 오후 3:14 · 3분 남음" */
function etaText(iso: string | null, nowMs: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const left = Math.max(0, Math.round((t - nowMs) / 60_000));
  return `${seoulTime(t).slice(0, 5)} · ${left}분 남음`;
}

/** 위 숫자 카드 — 누르면 목록이 그것만(백오피스와 같은 기준: 끊김 = 끊김 또는 위치 없음, 대기 = 배송 없음 · 끊김 아님) */
export function RiderKpis() {
  const app = useApp();
  const { sim } = app;
  const rows = useRiderRows();
  const board = sim.controlBoard?.() ?? null;
  const f = app.riderFilter;
  const card = (key: RiderTableFilter | null, label: string, n: number, dot: string, hint?: string) => (
    <button className={`rb-kpi ${key && f === key ? 'on' : ''} ${dot === 'red' && n > 0 ? 'alert' : ''}`} onClick={() => key && app.setRiderFilter(key)} disabled={!key}>
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
      {card(null, '대기', rows.filter((r) => !isDelivering(r) && !isStale(r)).length, 'green')}
      {card('stale', '위치 끊김·없음', rows.filter(isStale).length, 'red')}
    </div>
  );
}

const LIST_FILTERS: readonly (readonly [RiderTableFilter, string])[] = [
  ['all', '전체'],
  ['delivering', '배송 중'],
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
              <button className={`rb-item ${sel ? 'sel' : ''} ${isStale(r) ? 'stale' : ''}`} onClick={() => app.select(r.id)} title={r.id}>
                <span className="rb-item-1">
                  <b>{r.name}</b>
                  {r.loc === 'ok' ? <span className="rb-badge ok">수신 중</span> : <span className="rb-badge bad">{r.loc === 'stale' ? '끊김' : '위치 없음'}</span>}
                </span>
                <span className="rb-item-2">
                  {[vehicleName(r.vehicle), r.dispatchOn === null ? null : `신규배차 ${r.dispatchOn ? '켬' : '끔'}`, r.sinceSec === null ? null : `${dur(r.sinceSec)} 전`].filter(Boolean).join(' · ')}
                </span>
                {r.pos && <span className="rb-coord">{`${r.pos.lat.toFixed(5)}, ${r.pos.lng.toFixed(5)}`}</span>}
                {r.deliveries.map((d) => {
                  const op = cardOf.get(d.deliveryId);
                  const eta = etaText(d.etaDrop, nowMs);
                  return (
                    <span key={d.deliveryId} className="rb-item-del">
                      <span className="rb-item-del-1">
                        <b>{op ? deliveryLabel(op.card) : d.deliveryId.slice(-8)}</b>
                        <span className="rb-stage">{d.stageKey ? (STAGE_LABEL[d.stageKey] ?? d.stage) : d.stage}</span>
                      </span>
                      <span className="rb-item-del-2">{[op?.card.orderNumber ? `#${op.card.orderNumber}` : null, '픽업 부산진구 MFC'].filter(Boolean).join(' · ')}</span>
                      {eta && <span className="rb-item-del-2">도착 예정 {eta.split(' · ')[0]}</span>}
                    </span>
                  );
                })}
              </button>
            </li>
          );
        })}
        {shown.length === 0 && <li className="rb-empty">{rows.length ? '조건에 맞는 라이더가 없어요.' : '운행 중인 라이더가 없어요.'}</li>}
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
  const name = row?.name ?? ([info?.nameMasked, info?.riderNumber].filter(Boolean).join(' · ') || id);
  const onDuty = ago(row?.onDutySince ?? null);
  const waiting = ago(row?.waitingSince ?? null);
  return (
    <aside className="rb-panel" aria-label="라이더 상세">
      <div className="rb-panel-head">
        <div>
          <div className="rb-name" title={id}>
            {name}
          </div>
          {row && <div className="rb-sub">{[vehicleName(row.vehicle), row.dispatchOn === null ? null : `신규배차 ${row.dispatchOn ? '켬' : '끔'}`].filter(Boolean).join(' · ')}</div>}
          <div className="rb-info">
            <span className={`rb-badge ${restriction === 'NORMAL' ? 'plain' : 'bad'}`}>{RESTRICTION[restriction] ?? restriction}</span>
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
          tone={!row ? undefined : row.loc === 'ok' ? 'ok' : 'bad'}
          value={!row ? '—' : row.loc === 'ok' ? `수신 중${row.sinceSec !== null ? ` · ${dur(row.sinceSec)} 전` : ''}` : row.loc === 'stale' ? '끊김' : '위치 없음'}
          hint={row && row.loc === 'stale' && row.sinceSec !== null ? `${dur(row.sinceSec)} 전` : undefined}
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
      <div className="rb-del-no">{op ? deliveryLabel(op.card) : d.deliveryId}</div>
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
          <b>픽업 · 부산진구 MFC</b>
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
