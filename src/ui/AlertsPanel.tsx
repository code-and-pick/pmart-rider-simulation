import { useState } from 'react';
import { useApp } from '../app/App';

/** 처음에 보이는 알림 수 — 넘치면 "더 보기" */
const FIRST = 4;

/**
 * 이상 상황 — 지연·실패·위치 끊김·요청 실패. 심각한 것·오래된 것 먼저.
 * 누르면 그 배송(또는 라이더)을 지도에서 보여 준다. 화면 알림일 뿐 배송 상태를 바꾸지 않는다.
 */
export function AlertsPanel() {
  const app = useApp();
  const { alerts } = app.board();
  const [more, setMore] = useState(false);
  if (!alerts.length) {
    return (
      <section className="alerts ok" aria-label="이상 상황">
        <span className="alerts-ok">● 이상 없음</span>
        <span className="muted"> — 지연·실패·위치 끊김이 생기면 여기 뜬다</span>
      </section>
    );
  }
  const bad = alerts.filter((a) => a.level === 'bad').length;
  const shown = more ? alerts : alerts.slice(0, FIRST);
  return (
    <section className="alerts" aria-label="이상 상황">
      <div className="alerts-head">
        <b>이상 상황 {alerts.length}</b>
        {bad > 0 && <span className="pill bad">심각 {bad}</span>}
        <button className="link" onClick={() => app.setFilter('delayed')} title="진행 중 배송 가운데 지연·이상만 목록에">
          지연만 보기
        </button>
      </div>
      <ul>
        {shown.map((a) => (
          <li key={a.key}>
            <button
              className={`alert-row ${a.level}`}
              onClick={() => (a.deliveryId ? app.selectDelivery(a.deliveryId) : a.riderId ? app.select(a.riderId) : app.setFilter('failedCalls'))}
              title={a.deliveryId ? '누르면 지도에서 이 배송을 보여 준다' : a.riderId ? '누르면 이 라이더를 찾는다' : '누르면 실패한 요청 목록'}
            >
              <span className="alert-dot" />
              <span className="alert-title">{a.title}</span>
              <span className="alert-detail">{a.detail}</span>
            </button>
          </li>
        ))}
      </ul>
      {alerts.length > FIRST && (
        <button className="link" onClick={() => setMore(!more)}>
          {more ? '접기' : `${alerts.length - FIRST}개 더 보기`}
        </button>
      )}
    </section>
  );
}
