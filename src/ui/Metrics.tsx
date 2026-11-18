import type { MetricsSummary } from '../sim/world';
import { BUCKET_LABEL, type Bucket } from './buckets';
import { dur } from './format';

/** 구간 색(막대·범례) */
const SEG_COLOR: Record<string, string> = {
  findRider: '#8f7cff',
  toStore: '#4c8dff',
  atStore: '#d35cff',
  storeAll: '#4c8dff',
  toCustomer: '#ff8a3d',
};

/** 숫자 칸을 눌렀을 때 — 배송 칸이면 그 배송만, failedCalls 면 실패한 요청 목록 */
export type MetricPick = Exclude<Bucket, 'closed'> | 'failedCalls';

const HINT: Record<Exclude<Bucket, 'closed'>, string> = {
  done: '전달 완료된 배송(사진·완료 처리까지 끝남)',
  delivering: '라이더가 배정돼 가게로·가게에서·고객에게 가는 중인 배송',
  searching: '점원 배차 요청 뒤 아직 라이더가 수락하지 않은 배송(반경 1→2→3km 제안 중)',
  dispatchFailed: '반경을 다 넓히고 재시도해도 라이더를 못 찾은 배송',
  deliveryFailed: '고객 부재 등으로 라이더가 전달 실패를 등록한 배송(확정 대기 + 확정)',
};
const TONE: Record<Exclude<Bucket, 'closed'>, 'done' | 'active' | 'wait' | 'fail'> = {
  done: 'done',
  delivering: 'active',
  searching: 'wait',
  dispatchFailed: 'fail',
  deliveryFailed: 'fail',
};

/**
 * 오른쪽 위 지표 — 배송 수 다섯 칸 + 요청 실패 + "완료된 배송 n 건 평균"을 구간 막대로.
 * 칸을 누르면 아래 목록이 그 칸으로 걸러진다(다시 누르면 풀림). 마우스를 올리면 무엇을 세는지 나온다.
 */
export function Metrics({
  m,
  counts,
  mode,
  active,
  onPick,
}: {
  m: MetricsSummary;
  counts: Record<Bucket, number>;
  mode: 'mock' | 'http';
  active: MetricPick | null;
  onPick: (p: MetricPick | null) => void;
}) {
  const basis = m.timeBasis === 'sim' ? '시뮬레이션 시각(배속 반영)' : '실제 시각';
  const pick = (p: MetricPick) => onPick(active === p ? null : p);
  const failLabel = mode === 'mock' ? '응답 끊김' : '요청 실패';
  const failHint =
    mode === 'mock'
      ? '쓰기 요청의 응답이 오지 않은 횟수(MOCK 장면) — 라이더가 같은 키로 다시 보내 중복 없이 이어진다. 누르면 어떤 요청인지'
      : '이 화면이 실서버에 보낸 요청 중 응답이 없거나(네트워크·시간 초과) 서버 오류(5xx)로 끝난 수(화면을 연 뒤 누적). 대부분 조회라 다음 박자에 다시 읽는다 — 백엔드 배포·재시작 중이면 오른다. 누르면 어떤 요청인지';
  return (
    <section className="metrics2" aria-label="지표">
      <div className="counts">
        {(Object.keys(BUCKET_LABEL) as (keyof typeof BUCKET_LABEL)[]).map((k) => (
          <Count key={k} n={counts[k]} label={BUCKET_LABEL[k]} tone={TONE[k]} hint={`${HINT[k]} — 누르면 그 배송만`} on={active === k} onClick={() => pick(k)} />
        ))}
        <Count n={m.responseLost} label={failLabel} tone="fail" hint={failHint} on={active === 'failedCalls'} onClick={() => pick('failedCalls')} />
      </div>
      {m.incidents && m.incidents.assignmentCancelled + m.incidents.locationStale + m.incidents.helpRequests > 0 && (
        <div className="incidents" title="지금까지 난 사건 수(MOCK 사건 기록 — 사건 탭에서 하나씩 볼 수 있다)">
          <span title="라이더가 픽업 전 배정을 취소해 다른 라이더에게 재배차(DeliveryAssignmentChanged)">
            배정 취소 <b>{m.incidents.assignmentCancelled}</b>
          </span>
          <span title="진행 중 배송의 라이더 위치가 3분 넘게 안 들어옴(RiderLocationStale — 알림만, 배송 상태는 그대로)">
            위치 끊김 <b>{m.incidents.locationStale}</b>
          </span>
          <span title="라이더 도움요청(DeliveryIncidentRaised → 지원센터)">
            도움요청 <b>{m.incidents.helpRequests}</b>
          </span>
        </div>
      )}
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

function Count({
  n,
  label,
  tone,
  hint,
  on,
  onClick,
}: {
  n: number;
  label: string;
  tone: 'done' | 'active' | 'wait' | 'fail';
  hint: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`count tone-${tone} ${tone === 'fail' && n > 0 ? 'alert' : ''} ${on ? 'on' : ''}`} title={hint} aria-pressed={on} onClick={onClick}>
      <div className="count-n">{n}</div>
      <div className="count-l">{label}</div>
    </button>
  );
}
