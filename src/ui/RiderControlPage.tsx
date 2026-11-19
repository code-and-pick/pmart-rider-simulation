import { useState } from 'react';
import { useApp } from '../app/App';
import { isSimRiderId } from '../config';
import { displayStage } from '../domain/displayStage';
import { deliveryLabel, shortRiderId } from '../domain/riderId';
import { BUCKET_LABEL } from './buckets';
import { dur, seoulTime } from './format';
import { ActiveOrders } from './ActiveOrders';
import { OpsPanel } from './OpsPanel';
import { RiderDetail } from './RiderDetail';
import { Progress } from './Progress';
import { rowMatchesRider, rowsFromControl, rowsFromRiders, vehicleName, type RiderRow, type RiderTableFilter } from './riderTable';

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
 * 배송 줄을 누르면 "관제" 지도로 가서 그 배송 상세를 연다.
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
  const stale = rows.filter((r) => r.loc !== 'ok').length;
  const recent = [...ops.rows].sort((a, b) => b.card.createdAt - a.card.createdAt).slice(0, RECENT);
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
    <section className="c-page" aria-label="라이더 관제">
      <div className="c-page-head">
        <div>
          <h2>라이더 관제</h2>
          <p>진행 중 주문마다 라이더 현황, 그 아래 라이더 목록·상세. 라이더 백오피스 "라이더 관제"와 같은 내용입니다.</p>
        </div>
        <span className="c-page-src">{source}</span>
      </div>

      <ActiveOrders onOpen={openOnMap} />

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

      <div className="c-page-tools">
        <div className="c-status" role="tablist" aria-label="라이더 거르기">
          {FILTERS.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={f === k} className={f === k ? 'on' : ''} onClick={() => setF(k)}>
              {l} <b>{rows.filter((r) => rowMatchesRider(r, k)).length}</b>
            </button>
          ))}
        </div>
        <input className="c-search" type="search" placeholder="이름 · 라이더 번호 · 배송번호" value={q} onChange={(e) => setQ(e.target.value)} aria-label="라이더 찾기" />
      </div>

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
              <tr key={r.id} className={`${app.selected === r.id ? 'sel' : ''} ${r.loc !== 'ok' ? 'warn' : ''}`} onClick={() => app.select(app.selected === r.id ? null : r.id)} title="누르면 오른쪽에 라이더 상세">
                <td>
                  <b title={r.id}>{r.name}</b>
                  {r.external && <span className="c-tag">라이더 앱</span>}
                  {r.sim && <span className="c-tag gray">시뮬레이터</span>}
                  {r.restriction && <span className="c-tag red">{r.restriction}</span>}
                </td>
                <td>{vehicleName(r.vehicle)}</td>
                <td>{r.dispatchOn === null ? '—' : r.dispatchOn ? <span className="c-badge ok">받음</span> : <span className="c-badge">끔</span>}</td>
                <td>{r.loc === 'ok' ? <span className="c-badge ok">수신 중</span> : r.loc === 'stale' ? <span className="c-badge bad">끊김</span> : <span className="c-badge bad">위치 없음</span>}</td>
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
                          title={`${d.deliveryId} — 누르면 관제 지도에서`}
                          onClick={(e) => {
                            e.stopPropagation();
                            openOnMap(d.deliveryId);
                          }}
                        >
                          <b>{row ? deliveryLabel(row.card) : shortRiderId(d.deliveryId)}</b> {d.stage}
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
      <RiderDetail row={rows.find((r) => r.id === app.selected)} onShowOnMap={openOnMap} />
      </div>

      <h3 className="c-page-h3">최근 배송 <span className="c-muted">끝난 것까지 · 최근 {RECENT}건 · 줄을 누르면 관제 지도에서</span></h3>
      <div className="c-table-wrap">
        <table className="c-table">
          <thead>
            <tr>
              <th>배송</th>
              <th>상태</th>
              <th>흐름</th>
              <th>라이더</th>
              <th title="배차 제안 횟수 · 거절·만료(누가 거절했는지는 줄을 눌러 흐름 탭)">제안</th>
              <th>배차 요청</th>
              <th>배정</th>
              <th>픽업</th>
              <th>끝남</th>
              <th>걸린 시간</th>
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
              const t = (ms: number | null) => (ms !== null ? seoulTime(ms) : <span className="c-muted">—</span>);
              return (
                <tr key={c.deliveryId} className={r.alert ? `al-${r.alert.level}` : ''} onClick={() => openOnMap(c.deliveryId)} title={c.deliveryId}>
                  <td>
                    <b>{deliveryLabel(c)}</b>
                  </td>
                  <td>
                    <span className={`c-st b-${r.bucket}`}>{r.bucket === 'closed' ? stage.text : BUCKET_LABEL[r.bucket]}</span>
                    {r.alert && <span className={`c-mini ${r.alert.level}`}> {r.alert.title}</span>}
                  </td>
                  <td>
                    <Progress stage={stage} compact />
                  </td>
                  <td>{c.riderId ? shortRiderLabel(c.riderId, sim.riders) : <span className="c-muted">—</span>}</td>
                  <td className="num">
                    {offers.length ? offers.length : <span className="c-muted">—</span>}
                    {declined > 0 && <span className="c-mini warn"> 거절·만료 {declined}</span>}
                  </td>
                  <td className="num">{r.startMs ? seoulTime(r.startMs) : '—'}</td>
                  <td className="num">{t(assignedAt)}</td>
                  <td className="num">{t(pickedAt)}</td>
                  <td className="num">{tl?.endMs != null ? seoulTime(tl.endMs) : r.bucket === 'searching' || r.bucket === 'delivering' ? <span className="c-ongoing">진행 중</span> : <span className="c-muted">—</span>}</td>
                  <td className="num">{r.totalSec === null ? '—' : `${dur(r.totalSec)}${r.bucket === 'searching' || r.bucket === 'delivering' ? '째' : ''}`}</td>
                </tr>
              );
            })}
            {recent.length === 0 && (
              <tr>
                <td colSpan={10} className="c-empty">
                  배송이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <details className="c-page-links">
        <summary>라이더 백오피스에서 열기(대시보드·라이더 찾기·배송 찾기·지원센터·수행료 …)</summary>
        <OpsPanel />
      </details>
    </section>
  );
}

function shortRiderLabel(id: string, riders: readonly { id: string; label?: string }[]): string {
  return riders.find((r) => r.id === id)?.label ?? shortRiderId(id);
}
