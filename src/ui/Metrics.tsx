import type { MetricsSummary } from '../sim/world';
import { dur } from './format';

/** 구간 색(막대·범례) */
const SEG_COLOR: Record<string, string> = {
  findRider: '#2dd4bf',
  toStore: '#4c8dff',
  atStore: '#facc15',
  storeAll: '#4c8dff',
  toCustomer: '#ff8a3d',
};

/**
 * 완료된 배송 n 건의 구간별 평균(접기) + MOCK 사건 수. 상태별 숫자는 위 숫자 카드(KpiCards), 이 요약은 기록 탭 "구간 평균".
 * 구간에 마우스를 올리면 어디서 어디까지 쟀는지 나온다.
 */
export function PhaseSummary({ m, open = false }: { m: MetricsSummary; open?: boolean }) {
  const basis = m.timeBasis === 'sim' ? '시뮬레이션 시각(배속 반영)' : '실제 시각';
  const inc = m.incidents;
  return (
    <details className="phases-box" open={open}>
      <summary>
        구간별 평균 {m.phases ? <b>{dur(m.phases.totalSec)}</b> : <span className="muted">— 완료 배송이 생기면</span>}
        {m.phases && <span className="muted"> · 완료 {m.phases.n}건 · {m.timeBasis === 'sim' ? '시뮬 시각' : '실제 시각'}</span>}
      </summary>
      {inc && inc.assignmentCancelled + inc.locationStale + inc.helpRequests > 0 && (
        <div className="incidents" title="지금까지 난 사건 수(MOCK 사건 기록 — 사건 탭에서 하나씩 볼 수 있다)">
          <span title="라이더가 픽업 전 배정을 취소해 다른 라이더에게 재배차(DeliveryAssignmentChanged)">
            배정 취소 <b>{inc.assignmentCancelled}</b>
          </span>
          <span title="진행 중 배송의 라이더 위치가 3분 넘게 안 들어옴(RiderLocationStale — 알림만, 배송 상태는 그대로)">
            위치 끊김 <b>{inc.locationStale}</b>
          </span>
          <span title="라이더 도움요청(DeliveryIncidentRaised → 지원센터)">
            도움요청 <b>{inc.helpRequests}</b>
          </span>
        </div>
      )}
      {m.phases && (
        <div className="phases">
          <div className="ph-bar" role="img" aria-label={`구간별 평균 시간 막대 — ${basis}`}>
            {m.phases.segments.map((s) => (
              <span key={s.key} className="ph-seg" style={{ flexGrow: Math.max(s.sec, 1), background: SEG_COLOR[s.key] }} title={`${s.label} ${dur(s.sec)} — ${s.hint}`} />
            ))}
          </div>
          <ul className="ph-legend">
            {m.phases.segments.map((s) => (
              <li key={s.key} title={s.hint}>
                <span className="sw" style={{ background: SEG_COLOR[s.key] }} />
                <span className="ph-label">{s.label}</span>
                <b className="ph-time">{dur(s.sec)}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}
