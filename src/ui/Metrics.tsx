import type { MetricsSummary } from '../sim/world';
import { dur } from './format';

/** 구간 색(막대·범례) */
const SEG_COLOR: Record<string, string> = {
  findRider: '#8f7cff',
  toStore: '#4c8dff',
  atStore: '#d35cff',
  storeAll: '#4c8dff',
  toCustomer: '#ff8a3d',
};

/**
 * 오른쪽 위 지표 — 배송 수 네 칸 + "완료된 배송 n 건 평균"을 구간 막대로.
 * 칸·구간에 마우스를 올리면 정확히 무엇을 세거나 잰 것인지 나온다.
 */
export function Metrics({ m }: { m: MetricsSummary }) {
  const basis = m.timeBasis === 'sim' ? '시뮬레이션 시각(배속 반영)' : '실제 시각';
  return (
    <section className="metrics2" aria-label="지표">
      <div className="counts">
        <Count n={m.completed} label="전달 완료" tone="done" hint="가상 라이더가 사진·완료 처리까지 끝낸 배송(지금까지 누적)" />
        <Count n={m.delivering} label="배송 중" tone="active" hint="라이더가 배정돼 가게로·가게에서·고객에게 가는 중인 배송" />
        <Count n={m.searching} label="라이더 찾는 중" tone="wait" hint="점원 배차 요청 뒤 아직 라이더가 수락하지 않은 배송(반경 1→2→3km 제안 중)" />
        <Count n={m.dispatchFailed} label="배차 실패" tone="fail" hint="반경을 다 넓히고 재시도해도 라이더를 못 찾은 배송" />
        <Count n={m.deliveryFailed} label="전달 실패" tone="fail" hint="고객 부재 등으로 라이더가 전달 실패를 등록한 배송(확정 대기 + 확정)" />
        <Count
          n={m.responseLost}
          label="응답 끊김"
          tone="fail"
          hint="응답이 오지 않은 요청 수 — 라이더가 같은 키로 다시 보내 중복 없이 이어진다(재전송 횟수)"
        />
      </div>
      <div className="phases">
        {m.phases ? (
          <>
            <div className="ph-head">
              <span>
                배송 한 건 평균 <b>{dur(m.phases.totalSec)}</b>
              </span>
              <span className="muted" title={`완료된 배송 ${m.phases.n}건 평균 · ${basis}`}>
                완료 {m.phases.n}건 평균 · {m.timeBasis === 'sim' ? '시뮬 시각' : '실제 시각'}
              </span>
            </div>
            <div className="ph-bar" role="img" aria-label="구간별 평균 시간 막대">
              {m.phases.segments.map((s) => (
                <span
                  key={s.key}
                  className="ph-seg"
                  style={{ flexGrow: Math.max(s.sec, 1), background: SEG_COLOR[s.key] }}
                  title={`${s.label} ${dur(s.sec)} — ${s.hint}`}
                />
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
          </>
        ) : (
          <p className="muted ph-empty">전달 완료된 배송이 생기면 한 건이 어디서 얼마나 걸렸는지 구간별 평균이 보인다.</p>
        )}
      </div>
    </section>
  );
}

function Count({ n, label, tone, hint }: { n: number; label: string; tone: 'done' | 'active' | 'wait' | 'fail'; hint: string }) {
  return (
    <div className={`count tone-${tone} ${tone === 'fail' && n > 0 ? 'alert' : ''}`} title={hint}>
      <div className="count-n">{n}</div>
      <div className="count-l">{label}</div>
    </div>
  );
}
