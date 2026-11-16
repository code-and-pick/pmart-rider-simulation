import { useApp } from '../app/App';
import { PHASE_COLOR } from '../render/colors';
import { PHASE_LABEL } from '../sim/rider';

export function LeftPanel() {
  const app = useApp();
  return (
    <aside className="panel left" aria-label="라이더">
      <h2>
        가상 라이더 <span className="muted">{app.sim.riders.length}명</span>
      </h2>
      <p className="hint">단계는 엔진 기준(백엔드 상태 아님). 누르면 지도에서 찾는다.</p>
      <ul className="riders">
        {app.sim.riders.map((r) => (
          <li key={r.id}>
            <button className={`rider ${app.selected === r.id ? 'sel' : ''}`} onClick={() => app.select(app.selected === r.id ? null : r.id)}>
              <span className="dot" style={{ background: PHASE_COLOR[r.phase] }} />
              <span className="rid">{r.id}</span>
              <span className="phase">{PHASE_LABEL[r.phase]}</span>
              {r.deliveryId && <span className="dl">{r.deliveryId}</span>}
              {r.note && <span className="note">{r.note}</span>}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
