import { useApp } from '../app/App';
import { displayStage } from '../domain/displayStage';
import { PHASE_COLOR } from '../render/colors';
import { PHASE_LABEL } from '../sim/rider';
import { friendlyNote } from './friendly';
import { Progress } from './Progress';

export function LeftPanel() {
  const app = useApp();
  const cards = app.sim.deliveryCards();
  const byId = new Map(cards.map((c) => [c.deliveryId, c]));
  return (
    <aside className="panel left" aria-label="라이더">
      <h2>
        가상 라이더 <span className="muted">{app.sim.riders.length}명</span>
      </h2>
      <p className="hint">누르면 오른쪽이 그 라이더로 걸러지고 지도에서 찾는다. 단계는 엔진 기준(백엔드 상태 아님).</p>
      <ul className="riders">
        {app.sim.riders.map((r) => {
          const card = r.deliveryId ? byId.get(r.deliveryId) : undefined;
          const stage = card ? displayStage(card.dispatchState, card.executionState, card.radiusKm) : null;
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
                  <span className="rc-id">
                    <span className="dot" />
                    {r.id}
                  </span>
                  <span className="rc-done" title="이 라이더가 완료한 배송">
                    완료 {done}
                  </span>
                </div>
                <div className="rc-phase">{PHASE_LABEL[r.phase]}</div>
                {card && stage && (
                  <div className="rc-delivery">
                    <span className="rc-dl">{card.deliveryId}</span>
                    <Progress stage={stage} compact />
                    <span className="rc-stage">{stage.text}</span>
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
