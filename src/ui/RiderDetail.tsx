import { useState } from 'react';
import { useApp } from '../app/App';
import { displayStage } from '../domain/displayStage';
import { deliveryLabel, orderLabel } from '../domain/riderId';
import { BUCKET_LABEL } from './buckets';
import { dur, seoulTime } from './format';
import { DropAddress } from './MapDetail';
import type { OpsRow } from './ops';
import { Progress } from './Progress';
import { vehicleName, type RiderRow } from './riderTable';

/** 최근 배송 줄 수 [시뮬] */
const RECENT = 5;

/**
 * 라이더 상세 칸(라이더 관제 표 오른쪽) — 백오피스 "라이더 관제" 상세 칸과 같은 짜임:
 *   머리(가린 이름 · 화면 번호, 수단·신규 배차) → 요약 칸(위치·배송/대기·운행 시작·오늘 완료) → 진행 중 배송 카드 → 최근 배송 → (시뮬레이터 라이더) 엔진 기록.
 * 오늘 운행·접속·대기 합계(직원용 /rider-operating-time)는 넣었다가 뺐다(사용자 2026-11-18 "이거 없어도 될 것 같아").
 * 전달지 주소는 "전달지 보기"를 눌러야 읽는다(부를 때마다 백엔드 개인정보 열람 기록).
 */
export function RiderDetail({ row, onShowOnMap }: { row: RiderRow | undefined; onShowOnMap: (deliveryId: string) => void }) {
  const app = useApp();
  const { sim } = app;
  if (!row) {
    return (
      <aside className="c-rd empty" aria-label="라이더 상세">
        표에서 라이더를 누르면 여기에 위치·배송·운행 상세가 나옵니다.
      </aside>
    );
  }
  const nowMs = sim.clock.epochMs();
  const ago = (iso: string | null) => (iso ? Math.max(0, (nowMs - Date.parse(iso)) / 1000) : null);
  const mine = app.board().rows.filter((r) => r.card.riderId === row.id);
  const done = mine.filter((r) => r.bucket === 'done');
  const avg = done.filter((r) => r.totalSec !== null).reduce((a, r, _, arr) => a + (r.totalSec as number) / arr.length, 0);
  const active = row.deliveries;
  const recent = mine.filter((r) => r.bucket !== 'searching' && r.bucket !== 'delivering').sort((a, b) => b.card.createdAt - a.card.createdAt).slice(0, RECENT);
  const notes = sim.notes.filter((n) => n.riderId === row.id).slice(-5).reverse();
  const waiting = ago(row.waitingSince);
  const onDuty = ago(row.onDutySince);
  return (
    <aside className="c-rd" aria-label="라이더 상세">
      <div className="c-rd-head">
        <div>
          <div className="c-rd-name" title={row.id}>
            {row.name}
            {row.external && <span className="c-tag">라이더 앱</span>}
            {row.sim && <span className="c-tag gray">시뮬레이터</span>}
            {row.restriction && <span className="c-tag red">{row.restriction}</span>}
          </div>
          <div className="c-rd-sub">
            {vehicleName(row.vehicle)} · 신규 배차 {row.dispatchOn === null ? '—' : row.dispatchOn ? '켬' : '끔'}
          </div>
        </div>
        <button className="c-btn-s" onClick={() => app.select(null)} aria-label="상세 닫기">
          닫기
        </button>
      </div>

      <div className="c-rd-tiles">
        <Tile label="위치" tone={row.loc === 'ok' ? 'ok' : 'bad'} value={row.loc === 'ok' ? '수신 중' : row.loc === 'stale' ? '끊김' : '위치 없음'} hint={row.sinceSec === null ? undefined : `마지막 수신 ${dur(row.sinceSec)} 전`} />
        <Tile
          label="배송"
          tone={active.length ? 'info' : 'ok'}
          value={active.length ? `배송 중 ${active.length}건` : waiting !== null ? `대기 ${dur(waiting)}째` : '대기'}
          hint={active.length ? active.map((d) => d.stage).join(' · ') : row.waitingSince ? `${seoulTime(Date.parse(row.waitingSince))}부터 기다림` : '대기 시작 시각 모름'}
        />
        <Tile label="운행 시작" value={onDuty !== null ? `${dur(onDuty)}째` : '—'} hint={row.onDutySince ? `${seoulTime(Date.parse(row.onDutySince))} 운행 시작` : '관제 응답에 있을 때만'} />
        <Tile label="완료(최근 목록)" value={`${done.length}건`} hint={done.length ? `한 건 평균 ${dur(avg)}` : '이 화면 최근 목록 기준'} />
      </div>

      {active.length > 0 && <h4 className="c-rd-h">진행 중 배송</h4>}
      {active.map((d) => (
        <ActiveCard key={d.deliveryId} d={d} op={mine.find((r) => r.card.deliveryId === d.deliveryId)} onShowOnMap={onShowOnMap} />
      ))}

      <h4 className="c-rd-h">최근 배송</h4>
      {recent.length === 0 && <p className="c-muted">끝난 배송이 없습니다(최근 목록 안).</p>}
      <ul className="c-rd-list">
        {recent.map((r) => (
          <li key={r.card.deliveryId}>
            <button onClick={() => onShowOnMap(r.card.deliveryId)} title={r.card.deliveryId}>
              <b>{deliveryLabel(r.card)}</b>
              <span className={`c-st b-${r.bucket}`}>{r.bucket === 'closed' ? '끝남' : BUCKET_LABEL[r.bucket]}</span>
              <span className="c-time">{r.totalSec === null ? '' : `총 ${dur(r.totalSec)}`}</span>
            </button>
          </li>
        ))}
      </ul>

      {row.sim && (
        <>
          <h4 className="c-rd-h">엔진 기록 <span className="c-muted">시뮬레이터 라이더 — 백엔드 상태 아님</span></h4>
          {notes.length === 0 && <p className="c-muted">이 화면이 움직이지 않는 라이더라 기록이 없습니다.</p>}
          <ul className="c-rd-notes">
            {notes.map((n, i) => (
              <li key={i}>
                <span className="c-muted">{seoulTime(sim.clock.epochMs(n.at))}</span> {n.text}
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string | undefined; tone?: 'ok' | 'bad' | 'info' }) {
  return (
    <div className={`c-rd-tile ${tone ?? ''}`}>
      <span className="c-rd-tile-l">{label}</span>
      <span className="c-rd-tile-v">{value}</span>
      {hint && <span className="c-rd-tile-h">{hint}</span>}
    </div>
  );
}

function ActiveCard({ d, op, onShowOnMap }: { d: RiderRow['deliveries'][number]; op: OpsRow | undefined; onShowOnMap: (id: string) => void }) {
  const [showAddr, setShowAddr] = useState(false);
  const mock = useApp().sim.mode === 'mock';
  const c = op?.card;
  const stage = c ? displayStage(c.dispatchState, c.executionState, c.radiusKm, c.purpose) : null;
  return (
    <div className={`c-rd-card ${op?.alert ? `al-${op.alert.level}` : ''}`}>
      <div className="c-item-1">
        <b className="c-no">{c ? deliveryLabel(c) : d.deliveryId}</b>
        {op && <span className={`c-st b-${op.bucket}`}>{op.bucket === 'closed' ? '끝남' : BUCKET_LABEL[op.bucket]}</span>}
        <span className="c-time">{op?.totalSec != null ? `${dur(op.totalSec)} 경과` : ''}</span>
      </div>
      {stage && (
        <div className="c-item-flow">
          <Progress stage={stage} compact />
        </div>
      )}
      <dl className="c-rd-facts">
        <dt>단계</dt>
        <dd>{d.stage}</dd>
        {c && orderLabel(c) && (
          <>
            <dt>주문</dt>
            <dd>{orderLabel(c)}</dd>
          </>
        )}
        <dt>도착 예정</dt>
        <dd>
          {d.etaPickup ? `가게 ${seoulTime(Date.parse(d.etaPickup))}` : ''}
          {d.etaPickup && d.etaDrop ? ' · ' : ''}
          {d.etaDrop ? `고객 ${seoulTime(Date.parse(d.etaDrop))}` : ''}
          {!d.etaPickup && !d.etaDrop && <span className="c-muted">{mock ? 'MOCK 은 도착 예정 없음' : '없음(백엔드 ETA 계산이 꺼져 있으면 비어 있음)'}</span>}
        </dd>
        <dt>전달지</dt>
        <dd>
          {showAddr ? (
            <DropAddress deliveryId={d.deliveryId} open={op ? op.bucket === 'delivering' || op.bucket === 'deliveryFailed' : true} />
          ) : (
            <button className="c-link" onClick={() => setShowAddr(true)} title="누르면 직원용 전달지를 읽는다 — 백엔드에 개인정보 열람 기록이 남는다">
              전달지 보기(열람 기록 남음)
            </button>
          )}
        </dd>
      </dl>
      {op?.alert && <div className={`c-item-al ${op.alert.level}`}>⚠ {op.alert.title} — {op.alert.detail.split(' — ').at(-1)}</div>}
      <button className="c-btn-s" onClick={() => onShowOnMap(d.deliveryId)}>
        지도에서 보기
      </button>
    </div>
  );
}
