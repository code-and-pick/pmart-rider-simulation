import { useApp } from '../app/App';
import { dur } from './format';
import type { OpsFilter } from './ops';

/**
 * 관제 숫자 카드(Locus·PayBell 관제처럼 위 한 줄, 큰 숫자) — 누르면 오른쪽 목록·지도 핀이 그것만.
 * 숫자와 목록은 같은 규칙(ui/buckets·ui/ops)으로 센다. 시각 기준: 실서버 = 실제, MOCK = 시뮬레이션.
 */
export function KpiCards() {
  const app = useApp();
  const { sim } = app;
  const b = app.board();
  const m = sim.metrics();
  const f = app.filter;
  const c = b.counts;
  const failed = c.dispatchFailed + c.deliveryFailed;
  const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');
  const real = sim.mode === 'http';
  const card = (key: OpsFilter, value: number, label: string, sub: string, tone: string, hint: string) => (
    <button
      key={key}
      className={`c-kpi t-${tone} ${f === key ? 'on' : ''} ${tone === 'red' && value > 0 ? 'hot' : ''}`}
      aria-pressed={f === key}
      title={`${hint} — 누르면 목록·지도가 그것만`}
      onClick={() => {
        app.setFilter(key);
        app.setPanelTab(key === 'failedCalls' ? 'logs' : 'deliveries');
      }}
    >
      <span className="c-kpi-l">{label}</span>
      <span className="c-kpi-v">{value}</span>
      <span className="c-kpi-s">{sub}</span>
    </button>
  );
  return (
    <section className="c-kpis" aria-label="관제 숫자">
      {card('active', c.active, '진행 중 배송', `찾는 중 ${c.searching} · 배송 중 ${c.delivering}`, 'ink', '라이더를 찾는 중이거나 배송 중인 배송')}
      {card(
        'searching',
        c.searching,
        '라이더 찾는 중',
        '반경 1→2→3km 제안',
        'violet',
        '점원 배차 요청 뒤 아직 라이더가 수락하지 않은 배송',
      )}
      {card('delivering', c.delivering, '배송 중', 'MFC로 · 가게 · 고객에게', 'blue', '라이더가 배정돼 가게로·가게에서·고객에게 가는 중인 배송')}
      {card(
        'delayed',
        c.delayed,
        '지연 · 이상',
        `진행 중의 ${pct(c.delayed, c.active)}`,
        'red',
        '진행 중인데 기준을 넘긴 배송(라이더 못 찾음 5분+·가게 대기 10분+·배송 40분+ — config OPS_THRESHOLDS [가정])',
      )}
      {card('done', c.done, '전달 완료', m.phases ? `한 건 평균 ${dur(m.phases.totalSec)}` : '평균은 완료 뒤', 'green', '사진·완료 처리까지 끝난 배송(최근 목록 안)')}
      {card('failed', failed, '실패', `배차 ${c.dispatchFailed} · 전달 ${c.deliveryFailed}`, 'red', '배차 실패(라이더를 못 찾음) + 전달 실패(고객 부재 등)')}
      <button
        className={`c-kpi t-ink ${app.panelTab === 'riders' ? 'on' : ''}`}
        title="라이더 목록 보기(라이더 앱 포함 — 실서버 라이더 앱 위치는 이 PC 만)"
        onClick={() => app.setPanelTab('riders')}
      >
        <span className="c-kpi-l">라이더</span>
        <span className="c-kpi-v">
          {b.riders.busy}
          <small>/{b.riders.total}</small>
        </span>
        <span className={`c-kpi-s ${b.riders.stale ? 'warn' : ''}`}>{b.riders.stale ? `위치 끊김 ${b.riders.stale}` : '배송 중 / 전체'}</span>
      </button>
      {card(
        'failedCalls',
        m.responseLost,
        real ? '요청 실패' : '응답 끊김',
        b.recentFailures ? `최근 1분 ${b.recentFailures}` : '누적',
        'gray',
        real
          ? '이 화면이 실서버에 보낸 요청 중 응답 없음·서버 오류(5xx) 누적 — 대부분 조회라 다음 박자에 다시 읽는다. 백엔드 배포·재시작 중이면 오른다'
          : '쓰기 응답이 사라진 횟수(MOCK 장면) — 같은 키로 다시 보내 중복 없이 이어진다',
      )}
    </section>
  );
}
