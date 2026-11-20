import { Fragment, useEffect, useRef, useState } from 'react';
import { useApp } from '../app/App';
import { isSimRiderId } from '../config';
import { deliveryKindName, displayStage } from '../domain/displayStage';
import { deliveryLabel, deliveryName, shortRiderId, riderName } from '../domain/riderId';
import { BUCKET_LABEL, type Bucket } from './buckets';
import { MapDetail } from './MapDetail';
import type { OpsRow } from './ops';
import { dur, seoulTime } from './format';
import { ActiveOrders } from './ActiveOrders';
import { OpsPanel } from './OpsPanel';
import { RiderDetail } from './RiderDetail';
import { Progress } from './Progress';
import { SearchFilterBar } from './SearchFilterBar';
import { locStatus, rowMatchesRider, rowsFromControl, rowsFromRiders, vehicleName, type RiderRow, type RiderTableFilter } from './riderTable';

const FILTERS: readonly (readonly [RiderTableFilter, string])[] = [
  ['all', '전체'],
  ['delivering', '배송 중'],
  ['stale', '위치 끊김·없음'],
  ['app', '라이더 앱'],
  ['sim', '시뮬레이터'],
];

/** 최근 배송 표 줄 수 [시뮬] */
const RECENT = 30;

/**
 * 라이더 관제(표) — 라이더 백오피스 "라이더 관제" 화면과 같은 내용을 이 시뮬레이터에서(백오피스가 안 열릴 때도 본다).
 *   숫자 카드(운행 중·배송 중·위치 끊김·없음) → 거르기·찾기 → 라이더 표 → 최근 배송 표 → (접기) 백오피스에서 열기.
 * 실서버 이 PC 는 관제 응답(GET /rider-locations) 그대로, 그 밖은 화면 라이더로 채운다(모르는 칸은 —).
 * 이 화면 안에서 배송을 누르면 아래 최근 배송 표에서 그 줄이 펼쳐진다(화면을 옮기지 않음 — 사용자 2026-11-20 "정신 사납게 배송관제로 넘어갈게 아니라 바로 아래쪽에").
 * 지도로 가는 것은 "지도에서 보기" 단추로만.
 */
export function RiderControlPage({ onShowOnMap }: { onShowOnMap: () => void }) {
  const app = useApp();
  const { sim } = app;
  const board = sim.controlBoard?.() ?? null;
  const rows: RiderRow[] = board ? rowsFromControl(board.items, isSimRiderId) : rowsFromRiders(sim.riders, isSimRiderId);
  const [f, setF] = useState<RiderTableFilter>('all');
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => rowMatchesRider(r, f)).filter((r) => !needle || [r.id, r.name, ...r.deliveries.map((d) => d.deliveryId)].some((x) => x.toLowerCase().includes(needle)));
  const ops = app.board();
  const cardOf = new Map(ops.rows.map((r) => [r.card.deliveryId, r]));
  const busy = rows.filter((r) => r.deliveries.length > 0).length;
  const stale = rows.filter((r) => rowMatchesRider(r, 'stale')).length;
  // 아래 최근 배송 표에서 펼칠 배송 — n 은 같은 배송을 다시 눌러도 다시 펼치고 스크롤하려고
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const openBelow = (deliveryId: string) => setFocus((p) => ({ id: deliveryId, n: (p?.n ?? 0) + 1 }));
  const openOnMap = (deliveryId: string) => {
    onShowOnMap();
    app.setPanelTab('deliveries');
    app.setFilter(null, true);
    // 이미 고른 배송이어도 풀지 않는다. 지도는 아직 숨겨져 있어(크기 0) 범위 맞추기는 지도가 보인 뒤 controller 가 한다
    app.selectDelivery(deliveryId, true);
  };
  const source = board
    ? `실서버 라이더 관제 · ${seoulTime(Date.parse(board.asOf))} 기준 · 10초마다`
    : sim.mode === 'http'
      ? '이 기기에서는 관제 응답을 못 읽음(라이더 앱 위치는 개발 서버가 있는 PC 에서만) — 시뮬레이터 라이더만'
      : '가상(MOCK) 라이더';
  return (
    <section className="c-page c-roomy" aria-label="운영 현황">
      <div className="c-page-head">
        <div>
          <h2>운영 현황</h2>
          <p>진행 중 주문 · 라이더 · 최근 배송을 한 화면에서 봅니다.</p>
        </div>
        <span className="c-page-src">{source}</span>
      </div>

      <ActiveOrders onOpen={openBelow} />

      <h3 className="c-page-h3">
        라이더 <span className="c-muted">위치·끊김·진행 중 배송 · 줄을 누르면 오른쪽에 상세</span>
      </h3>
      <div className="c-page-stats">
        <button className={`c-kpi t-ink ${f === 'all' ? 'on' : ''}`} onClick={() => setF('all')}>
          <span className="c-kpi-l">{board ? '운행 중' : '라이더'}</span>
          <span className="c-kpi-v">
            {rows.length}
            <small>명</small>
          </span>
          <span className="c-kpi-s">{board ? '관제 응답 기준(운행 중만)' : '화면 라이더(운행 여부 모름)'}</span>
        </button>
        <button className={`c-kpi t-blue ${f === 'delivering' ? 'on' : ''}`} onClick={() => setF('delivering')}>
          <span className="c-kpi-l">배송 중</span>
          <span className="c-kpi-v">
            {busy}
            <small>명</small>
          </span>
          <span className="c-kpi-s">진행 중 배송이 있는 라이더</span>
        </button>
        <button className={`c-kpi t-red ${stale ? 'hot' : ''} ${f === 'stale' ? 'on' : ''}`} onClick={() => setF('stale')}>
          <span className="c-kpi-l">위치 끊김 · 없음</span>
          <span className="c-kpi-v">
            {stale}
            <small>명</small>
          </span>
          <span className="c-kpi-s">3분 넘게 안 들어오거나 위치 없음</span>
        </button>
      </div>

      <SearchFilterBar
        query={q}
        onQuery={setQ}
        placeholder="이름 · 라이더 번호 · 배송번호로 찾기"
        searchLabel="라이더 찾기"
        value={f}
        onValue={setF}
        options={FILTERS.map(([k, l]) => [k, l, rows.filter((r) => rowMatchesRider(r, k)).length] as const)}
        allKey="all"
        warnKeys={['stale']}
      />

      <div className="c-rider-split">
      <div className="c-table-wrap">
        <table className="c-table">
          <thead>
            <tr>
              <th>라이더</th>
              <th>수단</th>
              <th>신규 배차</th>
              <th>위치</th>
              <th>마지막 수신</th>
              <th>진행 중 배송</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className={`${app.selected === r.id ? 'sel' : ''} ${rowMatchesRider(r, 'stale') ? 'warn' : ''}`} onClick={() => app.select(app.selected === r.id ? null : r.id)} title="누르면 오른쪽에 라이더 상세">
                <td>
                  <b title={r.id}>{r.name}</b>
                  {r.external && <span className="c-tag">라이더 앱</span>}
                  {r.sim && <span className="c-tag gray">시뮬레이터</span>}
                  {r.restriction && <span className="c-tag red">{r.restriction}</span>}
                </td>
                <td>{vehicleName(r.vehicle)}</td>
                <td>{r.dispatchOn === null ? '—' : r.dispatchOn ? <span className="c-badge ok">받음</span> : <span className="c-badge">끔</span>}</td>
                <td>{r.loc === 'ok' ? <span className="c-badge ok">수신 중</span> : locStatus(r) === 'rest' ? <span className="c-badge" title="배송 없고 신규배차 꺼짐 — 문제 아님">쉬는 중</span> : r.loc === 'stale' ? <span className="c-badge bad">끊김</span> : <span className="c-badge bad">위치 없음</span>}</td>
                <td className="num">{r.sinceSec === null ? '—' : `${dur(r.sinceSec)} 전`}</td>
                <td>
                  {r.deliveries.length === 0 ? (
                    <span className="c-muted">—</span>
                  ) : (
                    r.deliveries.map((d) => {
                      const row = cardOf.get(d.deliveryId);
                      return (
                        <button
                          key={d.deliveryId}
                          className="c-dl"
                          title={`${d.deliveryId} — 누르면 아래 최근 배송에서 상세`}
                          onClick={(e) => {
                            e.stopPropagation();
                            openBelow(d.deliveryId);
                          }}
                        >
                          <b>{row ? deliveryName(row.card) : shortRiderId(d.deliveryId)}</b> {d.stage}
                          {d.etaDrop && <span className="c-muted"> · 도착 예정 {seoulTime(Date.parse(d.etaDrop))}</span>}
                          {!d.etaDrop && d.etaPickup && <span className="c-muted"> · 가게 예정 {seoulTime(Date.parse(d.etaPickup))}</span>}
                        </button>
                      );
                    })
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="c-empty">
                  맞는 라이더가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <RiderDetail row={rows.find((r) => r.id === app.selected)} onShowOnMap={openOnMap} onOpenDelivery={openBelow} />
      </div>

      <RecentDeliveries onOpen={openOnMap} focus={focus} />

      <details className="c-page-links">
        <summary>라이더 백오피스에서 열기(대시보드·라이더 찾기·배송 찾기·지원센터·수행료 …)</summary>
        <OpsPanel />
      </details>
    </section>
  );
}

function shortRiderLabel(id: string, riders: readonly { id: string; label?: string }[]): string {
  return riders.find((r) => r.id === id)?.label ?? riderName(id);
}


/** 최근 배송 상태 거르기 — 칸(bucket) + 지연·이상 */
type RecentFilter = 'all' | 'alert' | Bucket;
const RECENT_FILTERS: readonly (readonly [RecentFilter, string])[] = [
  ['all', '전체'],
  ['searching', '라이더 찾는 중'],
  ['delivering', '배송 중'],
  ['done', '전달 완료'],
  ['deliveryFailed', '전달 실패'],
  ['dispatchFailed', '배차 실패'],
  ['closed', '취소·기타'],
  ['alert', '지연·이상'],
];

/** 찾기 — 배송 번호·주문번호·시스템 ID(배송·주문·출고·라이더)·라이더 이름/번호 중 하나라도 들어 있으면 */
export function recentMatches(r: OpsRow, needle: string, riderLabel: (id: string) => string): boolean {
  if (!needle) return true;
  const c = r.card;
  const hay = [c.deliveryId, c.deliveryNumber, c.orderId, c.orderNumber, c.shipmentId, c.riderId, c.riderId ? riderLabel(c.riderId) : null];
  return hay.some((x) => x && x.toLowerCase().includes(needle));
}

/**
 * 최근 배송 표(백오피스 라이더 관제 "최근 배송"처럼) — 운영 현황·라이더 관제가 같이 쓴다.
 * 위에 찾기(번호·ID·라이더)와 상태 거르기(건수와 함께). 줄을 누르면 그 줄 아래로 상세가 펼쳐진다
 * (상세·주문·흐름·원래 상태 탭 — 배송 관제 상세 창과 같은 것, 사용자 2026-11-20 "넘어가도 나오는 정보는 짧거든 … 밑으로 탭이 펼쳐져서").
 * 지도로 가려면 펼친 칸의 "지도에서 보기"(onOpen).
 */
export function RecentDeliveries({ onOpen, focus }: { onOpen: (deliveryId: string) => void; focus?: { id: string; n: number } | null }) {
  const app = useApp();
  const { sim } = app;
  const ops = app.board();
  const [q, setQ] = useState('');
  const [f, setF] = useState<RecentFilter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const scrollTo = useRef<string | null>(null);
  // 위 칸(진행 중 주문·라이더 표·라이더 상세)에서 배송을 누르면 — 찾기·거르기를 풀고 그 줄을 펼친다
  useEffect(() => {
    if (!focus) return;
    setQ('');
    setF('all');
    setOpen(focus.id);
    scrollTo.current = focus.id;
  }, [focus]);
  // 펼친 줄이 그려진 뒤 그 자리로 스크롤
  useEffect(() => {
    const id = scrollTo.current;
    if (!id || open !== id) return;
    scrollTo.current = null;
    const row = [...(wrap.current?.querySelectorAll<HTMLTableRowElement>('tr[data-did]') ?? [])].find((el) => el.dataset.did === id);
    row?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const needle = q.trim().toLowerCase();
  const label = (id: string) => shortRiderLabel(id, sim.riders);
  const sorted = [...ops.rows].sort((a, b) => b.card.createdAt - a.card.createdAt);
  const searched = sorted.filter((r) => recentMatches(r, needle, label));
  const countOf = (k: RecentFilter) => (k === 'all' ? searched.length : k === 'alert' ? searched.filter((r) => r.alert).length : searched.filter((r) => r.bucket === k).length);
  const top = searched.filter((r) => (f === 'all' ? true : f === 'alert' ? !!r.alert : r.bucket === f)).slice(0, RECENT);
  // 위에서 고른 배송이 최근 목록 밖이면 맨 아래에 붙여서라도 펼친다
  const extra = open && !top.some((r) => r.card.deliveryId === open) ? searched.find((r) => r.card.deliveryId === open) : undefined;
  const recent = extra ? [...top, extra] : top;
  return (
    <>
      <h3 className="c-page-h3">
        최근 배송 <span className="c-n">{recent.length}건</span>
      </h3>
      <SearchFilterBar
        query={q}
        onQuery={setQ}
        placeholder="배송·주문번호, ID, 라이더 이름·번호로 찾기"
        searchLabel="최근 배송 찾기"
        value={f}
        onValue={setF}
        options={RECENT_FILTERS.map(([k, l]) => [k, l, countOf(k)] as const)}
        allKey="all"
        warnKeys={['alert']}
      />
      <div className="c-table-wrap" ref={wrap}>
        <table className="c-table c-recent">
          <thead>
            <tr>
              <th>배송</th>
              <th>상태</th>
              <th className="num">걸린 시간</th>
              <th>라이더</th>
              <th>흐름</th>
              <th className="num" title="배차 제안 횟수 · 거절·만료">제안</th>
              <th className="num sub">배차 요청</th>
              <th className="num sub">배정</th>
              <th className="num sub">픽업</th>
              <th className="num sub">끝남</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((r) => {
              const c = r.card;
              const stage = displayStage(c.dispatchState, c.executionState, c.radiusKm, c.purpose);
              // 배정·픽업·끝남 시각 — 흐름(배차·수행 기록)에서. 진행 중이면 끝남 = 진행 중
              const tl = sim.deliveryTimeline(c.deliveryId);
              const at = (pred: (k: string) => boolean) => tl?.steps.find((x) => pred(x.key))?.atMs ?? null;
              const assignedAt = at((k) => k === 'assigned');
              const pickedAt = at((k) => k.startsWith('x-PICKED_UP'));
              const offers = tl?.offers ?? [];
              const declined = offers.filter((o) => o.state === 'REJECTED' || o.state === 'EXPIRED').length;
              const isOpen = open === c.deliveryId;
              return (
                <Fragment key={c.deliveryId}>
                  <tr
                    className={`${r.alert ? `al-${r.alert.level}` : ''} ${isOpen ? 'open' : ''}`}
                    onClick={() => setOpen(isOpen ? null : c.deliveryId)}
                    title={c.deliveryId}
                    data-did={c.deliveryId}
                    aria-expanded={isOpen}
                  >
                    <td className="rd-id">
                      <span className="c-caret">{isOpen ? '▾' : '▸'}</span>
                      <span className="rd-id-t">
                        <b>{deliveryLabel(c)}</b>
                        <span>{deliveryKindName(c.purpose)}</span>
                      </span>
                    </td>
                    <td>
                      <span className={`rd-st b-${r.bucket}`}>
                        <i />
                        {r.bucket === 'closed' ? stage.text : BUCKET_LABEL[r.bucket]}
                      </span>
                      {r.alert && <span className={`rd-act ${r.alert.level}`}>조치 필요 · {r.alert.title}</span>}
                    </td>
                    <td className="num rd-dur">{r.totalSec === null ? '—' : `${dur(r.totalSec)}${r.bucket === 'searching' || r.bucket === 'delivering' ? '째' : ''}`}</td>
                    <td>{c.riderId ? label(c.riderId) : <span className="c-muted">—</span>}</td>
                    <td className="rd-flow">
                      <Progress stage={stage} compact />
                    </td>
                    <td className="num sub">
                      {offers.length ? offers.length : '—'}
                      {declined > 0 && <span className="rd-dec"> · 만료·거절 {declined}</span>}
                    </td>
                    <td className="num sub">{r.startMs ? seoulTime(r.startMs).slice(0, 5) : '—'}</td>
                    <td className="num sub">{assignedAt !== null ? seoulTime(assignedAt).slice(0, 5) : '—'}</td>
                    <td className="num sub">{pickedAt !== null ? seoulTime(pickedAt).slice(0, 5) : '—'}</td>
                    <td className="num sub">{tl?.endMs != null ? seoulTime(tl.endMs).slice(0, 5) : r.bucket === 'searching' || r.bucket === 'delivering' ? <span className="c-ongoing">진행 중</span> : '—'}</td>
                  </tr>
                  {isOpen && (
                    <tr className="c-recent-x">
                      <td colSpan={10}>
                        <MapDetail variant="inline" deliveryId={c.deliveryId} onClose={() => setOpen(null)} onShowOnMap={onOpen} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {recent.length === 0 && (
              <tr>
                <td colSpan={10} className="c-empty">
                  {needle || f !== 'all' ? '맞는 배송이 없습니다.' : '배송이 없습니다.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
