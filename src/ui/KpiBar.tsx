import { useApp } from '../app/App';
import { dur } from './format';
import type { OpsFilter } from './ops';

/**
 * 관제 숫자 줄(지도 위 가로 한 줄) — 상태별 배송 수·지연·라이더·요청 실패. 누르면 오른쪽 목록이 그 칸으로 걸러진다(다시 누르면 풀림).
 * 숫자와 목록은 같은 규칙(ui/buckets·ui/ops)으로 센다.
 */
export function KpiBar() {
  const app = useApp();
  const { sim } = app;
  const b = app.board();
  const m = sim.metrics();
  const f = app.filter;
  const real = sim.mode === 'http';
  const tile = (key: OpsFilter, n: number, label: string, tone: string, hint: string, sub?: string) => (
    <button
      key={key}
      className={`kpi tone-${tone} ${f === key ? 'on' : ''} ${tone === 'bad' && n > 0 ? 'alert' : ''}`}
      aria-pressed={f === key}
      title={`${hint} — 누르면 그것만`}
      onClick={() => app.setFilter(key)}
    >
      <span className="kpi-n">{n}</span>
      <span className="kpi-l">
        {label}
        {sub && <span className="kpi-sub">{sub}</span>}
      </span>
    </button>
  );
  return (
    <div className="kpibar" role="toolbar" aria-label="관제 숫자 — 누르면 그것만 보기">
      <div className="kpi-group" aria-label="진행 중">
        <span className="kpi-cap">진행 중 {b.counts.active}</span>
        {tile('searching', b.counts.searching, '라이더 찾는 중', 'wait', '점원 배차 요청 뒤 아직 라이더가 수락하지 않은 배송(반경 1→2→3km 제안 중)')}
        {tile('delivering', b.counts.delivering, '배송 중', 'active', '라이더가 배정돼 가게로·가게에서·고객에게 가는 중인 배송')}
        {tile('delayed', b.counts.delayed, '지연·이상', 'bad', '진행 중인데 기준을 넘긴 배송(라이더 못 찾음 5분+·가게 대기 10분+·배송 40분+ 등 — config OPS_THRESHOLDS [가정])')}
      </div>
      <div className="kpi-group" aria-label="끝남">
        <span className="kpi-cap">끝남</span>
        {tile('done', b.counts.done, '전달 완료', 'done', '사진·완료 처리까지 끝난 배송')}
        {tile('dispatchFailed', b.counts.dispatchFailed, '배차 실패', 'bad', '반경을 다 넓히고 재시도해도 라이더를 못 찾은 배송')}
        {tile('deliveryFailed', b.counts.deliveryFailed, '전달 실패', 'bad', '고객 부재 등으로 라이더가 전달 실패를 등록한 배송(확정 대기 + 확정)')}
      </div>
      <div className="kpi-group kpi-info" aria-label="라이더·연결">
        <span className="kpi-cap">라이더</span>
        <span className="kpi-stat" title="배송 중 / 전체 라이더(라이더 앱 포함)">
          <b>{b.riders.busy}</b>/{b.riders.total} 배송 중
        </span>
        {b.riders.stale > 0 && (
          <span className="kpi-stat bad" title="위치가 안 들어오는 라이더(실서버 관제 3분 기준·MOCK 위치 끊김 장면)">
            위치 끊김 <b>{b.riders.stale}</b>
          </span>
        )}
        {tile(
          'failedCalls',
          m.responseLost,
          real ? '요청 실패' : '응답 끊김',
          'muted',
          real
            ? '이 화면이 실서버에 보낸 요청 중 응답 없음·서버 오류(5xx) 누적 — 대부분 조회라 다음 박자에 다시 읽는다. 백엔드 배포·재시작 중이면 오른다'
            : '쓰기 응답이 사라진 횟수(MOCK 장면) — 같은 키로 다시 보내 중복 없이 이어진다',
          b.recentFailures > 0 ? `최근 1분 ${b.recentFailures}` : undefined,
        )}
        {m.phases && (
          <span className="kpi-stat" title={`완료 ${m.phases.n}건 평균 — 배차 요청부터 전달 완료까지(${m.timeBasis === 'sim' ? '시뮬 시각' : '실제 시각'})`}>
            한 건 평균 <b>{dur(m.phases.totalSec)}</b>
          </span>
        )}
      </div>
    </div>
  );
}
