import { useState } from 'react';
import { useApp } from '../app/App';
import { dur } from './format';
import { deliveringStage, rowMatches, STAGE_FILTERS, type OpsFilter, type OpsRow } from './ops';

/*
 * 배송 관제 위 "흐름 막대" — 숫자 카드·목록 상태 칸·단계별 묶음이 같은 것을 세 번 보이던 것을 한 줄로 합침
 * (사용자 2026-11-19 "배송목록에 있는 단계랑 위에 엄청 큰 단계로 뜨는 거 겹치잖아. 더 똑똑하게").
 *   [진행 중 N] | 라이더 찾는 중 › 가게로 › 가게 대기 › 고객에게 › 고객 앞 › 전달 완료 | 지연·이상 · 실패 · 요청 실패
 * 칸을 누르면 아래 목록·지도 핀이 그 칸만(다시 누르면 진행 중 전체). 칸마다 지연 건수를 빨간 점으로.
 */

const STEP_LABEL: Record<string, string> = {
  searching: '라이더 찾는 중',
  toStore: '가게로',
  atStore: '가게 대기',
  toCustomer: '고객에게',
  atCustomer: '고객 앞',
  done: '전달 완료',
};

export function FlowBar() {
  const app = useApp();
  const { sim } = app;
  const b = app.board();
  const m = sim.metrics();
  const f = app.filter;
  const [ask, setAsk] = useState(false);
  const rows = b.rows;
  const c = b.counts;
  const late = (pred: (r: OpsRow) => boolean) => rows.filter((r) => pred(r) && r.alert).length;
  const stageCount = (n: number) => rows.filter((r) => deliveringStage(r) === n).length;
  const pick = (k: OpsFilter) => app.setFilter(f === k ? 'active' : k, true);

  const step = (key: OpsFilter, n: number, sub?: string) => {
    const lateN = key === 'done' ? 0 : late((r) => rowMatches(r, key));
    return (
      <button key={key} className={`fb-step ${f === key ? 'on' : ''} ${n === 0 ? 'zero' : ''}`} aria-pressed={f === key} onClick={() => pick(key)} title={`${STEP_LABEL[key]} — 누르면 목록·지도가 그것만`}>
        <span className="fb-l">{STEP_LABEL[key]}</span>
        <b className="fb-n">{n}</b>
        {lateN > 0 ? <span className="fb-late">지연 {lateN}</span> : sub ? <span className="fb-sub">{sub}</span> : null}
      </button>
    );
  };
  const real = sim.mode === 'http';
  const failed = c.dispatchFailed + c.deliveryFailed;
  return (
    <section className="fb" aria-label="배송 흐름">
      <button className={`fb-all ${f === 'active' || f === null ? 'on' : ''}`} onClick={() => app.setFilter('active', true)} title="진행 중 전체(라이더 찾는 중 + 배송 중)">
        <span className="fb-l">진행 중</span>
        <b className="fb-n">{c.active}</b>
        <span className="fb-sub">
          찾는 중 {c.searching} · 배송 중 {c.delivering}
        </span>
      </button>
      <div className="fb-flow" role="group" aria-label="단계">
        {step('searching', c.searching, '반경 1→2→3km')}
        <i className="fb-arrow" aria-hidden>
          ›
        </i>
        {STAGE_FILTERS.map(([k, n], i) => [
          step(k, stageCount(n)),
          <i key={`a${i}`} className="fb-arrow" aria-hidden>
            ›
          </i>,
        ])}
        {step('done', c.done, m.phases ? `평균 ${dur(m.phases.totalSec)}` : undefined)}
      </div>
      <div className="fb-issues" role="group" aria-label="문제">
        <button className={`fb-issue red ${f === 'delayed' ? 'on' : ''} ${c.delayed ? 'hot' : ''}`} onClick={() => pick('delayed')} title="진행 중인데 기준을 넘긴 배송(라이더 못 찾음 5분+·가게 대기 10분+·배송 40분+ — config OPS_THRESHOLDS [가정])">
          지연·이상 <b>{c.delayed}</b>
        </button>
        <button className={`fb-issue red ${f === 'failed' ? 'on' : ''} ${failed ? 'hot' : ''}`} onClick={() => pick('failed')} title={`배차 실패 ${c.dispatchFailed} · 전달 실패 ${c.deliveryFailed}`}>
          실패 <b>{failed}</b>
        </button>
        <span className="fb-pop-anchor">
          <button
            className={`fb-issue ${f === 'failedCalls' || ask ? 'on' : ''}`}
            onClick={() => setAsk((v) => !v)}
            aria-expanded={ask}
            title={real ? '이 화면이 실서버에 보낸 요청 중 응답 없음·서버 오류(5xx) 누적' : '쓰기 응답이 사라진 횟수(MOCK 장면)'}
          >
            {real ? '요청 실패' : '응답 끊김'} <b>{m.responseLost}</b>
          </button>
          {/* 이 칸만 다른 화면(기록)으로 가서 당황스럽다 — 먼저 알리고 고르게(사용자 2026-11-19). 브라우저 확인창 대신 화면 안 작은 창 */}
          {ask && (
            <div className="fb-pop" role="dialog" aria-label="기록 화면으로 이동">
              <p>
                <b>
                  {real ? '요청 실패' : '응답 끊김'} {m.responseLost}건
                </b>
                은 배송이 아니라 서버 요청 기록이에요.
                <br />
                <b>기록 화면(API)</b>으로 넘어갑니다.
              </p>
              <div className="fb-pop-f">
                <button className="c-btn-s" onClick={() => setAsk(false)}>
                  취소
                </button>
                <button
                  className="c-btn-s primary"
                  autoFocus
                  onClick={() => {
                    setAsk(false);
                    app.setFilter('failedCalls', true);
                    app.setView('logs');
                  }}
                >
                  기록으로 가기
                </button>
              </div>
            </div>
          )}
        </span>
        <button className={`fb-issue ${f === null ? 'on' : ''}`} onClick={() => app.setFilter(null, true)} title="끝난 배송까지 전부">
          전체 <b>{rows.length}</b>
        </button>
      </div>
    </section>
  );
}
