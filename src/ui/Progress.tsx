import type { StageView } from '../domain/displayStage';

/** 배송 단계 막대 — 배차 요청 → 배정 → 가게 도착 → 픽업 → 고객 도착 → 완료. compact 면 점만. */
export function Progress({ stage, compact = false }: { stage: StageView; compact?: boolean }) {
  return (
    <div className={`progress tone-${stage.tone} ${compact ? 'compact' : ''}`} role="img" aria-label={`배송 단계 ${stage.labels[stage.index]} — ${stage.text}`}>
      <ol>
        {stage.labels.map((label, i) => (
          <li key={label} className={i < stage.index ? 'past' : i === stage.index ? 'now' : ''}>
            <span className="dot" />
            {!compact && <span className="lbl">{label}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
