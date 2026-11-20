import { useState } from 'react';
import { useApp } from '../app/App';
import { useAlertSound } from './alertSound';
import { dur } from './format';
import type { OpsAlert } from './ops';

/*
 * "확인할 일" 바 — 라이더 관제·배송 관제 맨 위 전체 폭(사용자 2026-11-19 "이상 상황이 눈에 덜 띄게, 직관적이지 않게 보이는 것 같아").
 * 예전엔 배송 관제 왼쪽 목록 위 작은 칸에만 있어 라이더 관제에서는 안 보였고, 문장 한 줄이라 무엇을 해야 할지 읽어야 했다.
 *   없음 = 얇은 초록 줄. 있음 = 심각이면 빨강·주의면 주황 한 줄 띠(2026-11-20 MFC 시뮬레이터처럼 얇게 — 큰 상자가 화면 위를 다 차지했다)
 *   + 알림마다 알약(무엇 · 어느 배송 · 기준 초과), 누르면 그 상세. 4건 넘으면 "n건 더"로 펼침.
 * 알림 규칙·기준은 ui/ops(config OPS_THRESHOLDS [가정]) 그대로.
 */

const ICON: Record<OpsAlert['kind'], string> = {
  SEARCH_LONG: '🔍',
  STORE_WAIT: '⏳',
  LATE: '🕒',
  DISPATCH_FAILED: '✕',
  DELIVERY_FAILED: '✕',
  RIDER_STALE: '📡',
  CALL_FAILURES: '⚡',
};

/** 한 번에 보이는 카드 수 — 넘으면 "n건 더" [시뮬] */
const SHOWN = 4;

export function IssueBar() {
  const app = useApp();
  const { alerts } = app.board();
  const [open, setOpen] = useState(false);
  const [sound, toggleSound] = useAlertSound(alerts);
  const bad = alerts.filter((a) => a.level === 'bad').length;
  const warn = alerts.length - bad;

  if (!alerts.length) {
    return (
      <div className="ib ib-ok" role="status">
        <span>● 이상 없음 — 지금 확인할 일이 없어요</span>
        <SoundButton on={sound} toggle={toggleSound} />
      </div>
    );
  }

  const shown = open ? alerts : alerts.slice(0, SHOWN);
  const go = (a: OpsAlert) => {
    if (a.deliveryId) {
      // 라이더 관제면 그 라이더도 고른다(오른쪽 상세 + 지도 위 주문 창), 배송 관제면 오른쪽 칸에 배송 상세
      if (a.riderId && app.view === 'control') app.select(a.riderId);
      if (app.view !== 'control' && app.view !== 'field') app.setView('field');
      app.selectDelivery(a.deliveryId, true);
    } else if (a.riderId) {
      app.setView('control');
      app.select(a.riderId);
    } else {
      app.setFilter('failedCalls', true);
      app.setView('logs');
    }
  };
  return (
    <section className={`ib ib-line ${bad ? 'ib-bad' : 'ib-warn'} ${open ? 'open' : ''}`} aria-label="확인할 일" aria-live="polite">
      <span className="ib-sum">
        <span className="ib-dot" aria-hidden />
        <b>확인할 일 {alerts.length}건</b>
        {bad > 0 && <em className="bad">심각 {bad}</em>}
        {warn > 0 && <em className="warn">주의 {warn}</em>}
      </span>
      <ul className="ib-chips">
        {shown.map((a) => {
          const [target, ...rest] = a.detail.split(' — ');
          const over = a.overSec !== undefined && a.overSec > 0 ? Math.max(1, Math.round(a.overSec / 60)) : null;
          return (
            <li key={a.key}>
              <button className={`ib-chip ${a.level}`} onClick={() => go(a)} title={`${a.title} — ${a.detail}${rest.length ? '' : a.sec ? ` · ${dur(a.sec)}째` : ''} · 누르면 상세`}>
                <span className="t">
                  <span aria-hidden>{ICON[a.kind]}</span> {a.title}
                </span>
                <b>{target}</b>
                {over !== null && <span className="ib-over">+{over}분</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <span className="ib-side">
        {alerts.length > SHOWN && (
          <button className="ib-more" onClick={() => setOpen(!open)}>
            {open ? '접기' : `${alerts.length - SHOWN}건 더`}
          </button>
        )}
        <SoundButton on={sound} toggle={toggleSound} />
      </span>
    </section>
  );
}

function SoundButton({ on, toggle }: { on: boolean; toggle: () => void }) {
  return (
    <button className={`ib-sound ${on ? 'on' : ''}`} aria-pressed={on} onClick={toggle} title={`새 알림이 생기면 소리 — 누르면 ${on ? '끄기' : '켜기'}`}>
      {on ? '🔔 소리 켬' : '🔕 소리 끔'}
    </button>
  );
}
