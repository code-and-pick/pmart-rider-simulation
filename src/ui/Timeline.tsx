import type { DeliveryTimeline } from '../sim/timeline';
import { dur, seoulTime } from './format';

/**
 * 배송 한 건의 흐름·시간 — 단계마다 시각, 앞 단계에서 걸린 시간, 출처(배차·수행·라이더 엔진).
 * 진행 중이면 마지막 단계부터 지금까지를 "진행 중"으로 잰다.
 */
export function Timeline({ t, nowMs }: { t: DeliveryTimeline; nowMs: number }) {
  const first = t.steps[0];
  const endMs = t.endMs ?? nowMs;
  const total = first ? (endMs - first.atMs) / 1000 : null;
  return (
    <section className="timeline" aria-label={`${t.deliveryId} 흐름·시간`}>
      <div className="tl-head">
        <span>
          {t.orderId ? (
            <>
              주문 <b>{t.orderId}</b>
            </>
          ) : (
            '주문 —'
          )}
        </span>
        <span title={t.basis === 'sim' ? '시뮬레이션 시각(배속 반영)' : '실제 시각'}>
          {t.endMs === null ? '지금까지 ' : '총 '}
          <b>{dur(total)}</b>
          <span className="muted"> · {t.basis === 'sim' ? '시뮬 시각' : '실제 시각'}</span>
        </span>
      </div>
      <ol className="tl-steps">
        {t.steps.map((s, i) => {
          const prev = t.steps[i - 1];
          return (
            <li key={s.key} className={s.bad ? 'bad' : ''}>
              <span className="time">{seoulTime(s.atMs)}</span>
              <span className="tl-label">
                {s.label}
                {s.detail && <span className="muted"> · {s.detail}</span>}
              </span>
              <span className="tl-gap">{prev ? `+${dur((s.atMs - prev.atMs) / 1000)}` : ''}</span>
              <span className={`tl-src src-${s.source === '라이더 엔진' ? 'engine' : 'server'}`} title={srcHint(s.source)}>
                {s.source}
              </span>
            </li>
          );
        })}
        {t.endMs === null && first && (
          <li className="now">
            <span className="time">{seoulTime(nowMs)}</span>
            <span className="tl-label">진행 중</span>
            <span className="tl-gap">+{dur((nowMs - (t.steps.at(-1) as { atMs: number }).atMs) / 1000)}</span>
            <span className="tl-src" />
          </li>
        )}
        {!first && <li className="empty">아직 기록된 단계가 없다.</li>}
      </ol>
      {t.gaps.map((g) => (
        <p key={g} className="tl-note muted">
          {g}
        </p>
      ))}
    </section>
  );
}

function srcHint(src: string): string {
  if (src === '배차') return 'delivery-dispatch 기록(배송 생성·제안·배정) 시각';
  if (src === '수행') return 'delivery-execution 기록(가게 도착·픽업·전달) 시각';
  return '시뮬레이터 가상 라이더가 잰 시각 — 서버 기록 아님';
}
