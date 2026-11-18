import { useState } from 'react';
import { useApp } from '../app/App';
import { displayStage } from '../domain/displayStage';
import { deliveryLabel } from '../domain/riderId';
import { PHASE_COLOR } from '../render/colors';
import { PHASE_LABEL, type RiderJob } from '../sim/rider';
import { friendlyNote } from './friendly';
import { Progress } from './Progress';

function jobText(j: RiderJob): string {
  const parts: string[] = [];
  if (j.orderNumber) parts.push(`주문 ${j.orderNumber}`);
  if (j.lines !== null) parts.push(`품목 ${j.lines}종`);
  if (j.itemAmount !== null) parts.push(`${j.itemAmount.toLocaleString('ko-KR')}원`);
  if (j.etaSec !== null) parts.push(`예상 ${Math.max(1, Math.round(j.etaSec / 60))}분`);
  return parts.join(' · ');
}

type RiderShow = 'all' | 'busy' | 'app';

export function LeftPanel() {
  const app = useApp();
  const cards = app.sim.deliveryCards();
  const byId = new Map(cards.map((c) => [c.deliveryId, c]));
  const [q, setQ] = useState('');
  const [show, setShow] = useState<RiderShow>('all');
  const all = app.sim.riders;
  const appCount = all.filter((r) => r.external).length;
  const busyCount = all.filter((r) => r.deliveryId).length;
  const needle = q.trim().toLowerCase();
  const riders = all
    .filter((r) => (show === 'busy' ? !!r.deliveryId : show === 'app' ? !!r.external : true))
    .filter((r) => !needle || r.id.toLowerCase().includes(needle) || (r.label ?? '').toLowerCase().includes(needle) || (r.deliveryId ?? '').toLowerCase().includes(needle))
    // 배송 중인 라이더 먼저(찾기 쉽게) — 같은 무리 안에서는 원래 순서
    .sort((a, b) => Number(!!b.deliveryId) - Number(!!a.deliveryId));
  return (
    <aside className="panel left" aria-label="라이더">
      <h2>
        라이더{' '}
        <span className="muted">
          {all.length - appCount}명{appCount > 0 && ` · 라이더 앱 ${appCount}명`}
        </span>
      </h2>
      <input
        className="rider-search"
        type="search"
        placeholder="이름·번호·배송번호로 찾기"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="라이더 찾기"
      />
      <div className="rider-show" role="group" aria-label="라이더 거르기">
        {(
          [
            ['all', `전체 ${all.length}`],
            ['busy', `배송 중 ${busyCount}`],
            ...(appCount > 0 ? [['app', `라이더 앱 ${appCount}`] as const] : []),
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={show === k ? 'on' : ''} aria-pressed={show === k} onClick={() => setShow(k)}>
            {l}
          </button>
        ))}
      </div>
      <p className="hint">누르면 오른쪽이 그 라이더로 걸러지고 지도에서 찾는다. 배송 중인 라이더가 위에.</p>
      <ul className="riders">
        {riders.length === 0 && <li className="empty">맞는 라이더가 없다.</li>}
        {riders.map((r) => {
          const card = r.deliveryId ? byId.get(r.deliveryId) : undefined;
          const stage = card ? displayStage(card.dispatchState, card.executionState, card.radiusKm, card.purpose) : null;
          const done = cards.filter((c) => c.riderId === r.id && c.executionState === 'COMPLETED').length;
          const sel = app.selected === r.id;
          return (
            <li key={r.id}>
              <button
                className={`rider-card ${sel ? 'sel' : ''}`}
                style={{ ['--rider-color' as string]: PHASE_COLOR[r.phase] }}
                aria-pressed={sel}
                onClick={() => app.select(sel ? null : r.id)}
              >
                <div className="rc-head">
                  <span className="rc-id" title={r.id}>
                    <span className="dot" />
                    {r.label ?? r.id}
                    {r.external && <span className="rc-app">라이더 앱</span>}
                  </span>
                  <span className="rc-done" title="이 라이더가 완료한 배송">
                    완료 {done}
                  </span>
                </div>
                <div className="rc-phase">
                  {PHASE_LABEL[r.phase]}
                  {r.locationOffline && (
                    <span className="rc-offline" title="위치 전송이 끊긴 중 — 3분 넘으면 백엔드가 위치 끊김(RiderLocationStale)을 낸다. 배송 상태는 그대로">
                      📡 위치 끊김
                    </span>
                  )}
                </div>
                {card && stage && (
                  <div className="rc-delivery">
                    <span className="rc-dl" title={card.deliveryId}>{deliveryLabel(card)}</span>
                    <Progress stage={stage} compact />
                    <span className="rc-stage">{stage.text}</span>
                  </div>
                )}
                {r.deliveryId && r.job && (
                  <div className="rc-job" title="수락한 제안의 주문 요약(dispatch order)과 예상 소요(pickupEta + dropEta). 고객 요청사항·주소는 보이지 않는다">
                    {jobText(r.job)}
                  </div>
                )}
                {r.note && <div className="rc-note">{friendlyNote(r.note)}</div>}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
