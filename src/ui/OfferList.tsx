import { useApp } from '../app/App';
import { isSimRiderId } from '../config';
import { shortRiderId } from '../domain/riderId';
import { OFFER_STATE_LABEL, type OfferRow } from '../sim/timeline';
import { seoulTime } from './format';
import { riderIndex } from './riderTable';

/*
 * 배차 제안 목록 — 누가 거절·만료·수락했나(사용자 2026-11-19 "라이더가 거절한 기록 어디서 확인할 수 있지?" → "응 넣어줘").
 * 백오피스 배송 상세 "배차 시도" 표와 같은 자료(dispatch GET /deliveries/{id}/dispatch 의 attempts[].offers[]).
 * 계약 Offer 에는 거절 사유 칸이 없다 — 사유는 어디에도 남지 않는다.
 */

const TRIGGER: Record<string, string> = { AUTO: '자동', STORE_STAFF: '점원 요청', REASSIGN: '재배차', RETRY: '재시도' };

export function OfferList({ offers }: { offers: readonly OfferRow[] | undefined }) {
  const app = useApp();
  if (!offers) return null;
  if (offers.length === 0) return <p className="c-muted of-empty">제안 기록이 아직 없습니다(배차 관점을 못 읽었거나 아직 안 보냄).</p>;
  const idx = riderIndex(app.sim.controlBoard?.()?.items ?? null, app.sim.riders, isSimRiderId);
  const name = (id: string | null) => (id ? (idx.get(id)?.name ?? shortRiderId(id)) : '—');
  const count = (s: OfferRow['state']) => offers.filter((o) => o.state === s).length;
  const rejected = count('REJECTED');
  const expired = count('EXPIRED');
  const attempts = new Set(offers.map((o) => o.attempt)).size;
  return (
    <section className="of" aria-label="배차 제안">
      <h4>
        배차 제안 <span className="c-muted">{offers.length}번</span>
        {rejected > 0 && <span className="of-pill rej">거절 {rejected}</span>}
        {expired > 0 && <span className="of-pill exp">만료 {expired}</span>}
        {count('ACCEPTED') > 0 && <span className="of-pill ok">수락 {count('ACCEPTED')}</span>}
      </h4>
      <table className="of-table">
        <thead>
          <tr>
            <th>보낸 시각</th>
            <th>라이더</th>
            <th>반경</th>
            <th>결과</th>
          </tr>
        </thead>
        <tbody>
          {offers.map((o, i) => {
            const newAttempt = attempts > 1 && (i === 0 || offers[i - 1]!.attempt !== o.attempt);
            return [
              newAttempt && (
                <tr key={`a-${o.attempt}-${i}`} className="of-attempt">
                  <td colSpan={4}>
                    {o.attempt}번째 배차 시도{o.trigger ? ` · ${TRIGGER[o.trigger] ?? o.trigger}` : ''}
                  </td>
                </tr>
              ),
              <tr key={o.offerId} className={`s-${o.state ?? 'none'}`}>
                <td className="num">{o.sentAtMs !== null ? seoulTime(o.sentAtMs) : '—'}</td>
                <td title={o.riderId ?? ''}>
                  {name(o.riderId)}
                  {o.fromList && <small className="c-muted"> · 배달리스트</small>}
                </td>
                <td className="num">{o.radiusKm !== null ? `${o.radiusKm}km` : '—'}</td>
                <td>
                  <span className={`of-st s-${o.state ?? 'none'}`}>{o.state ? OFFER_STATE_LABEL[o.state] : '—'}</span>
                </td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
      <p className="c-muted of-note">거절 사유는 백엔드 기록에 없습니다(제안 기록에 사유 칸이 없음).</p>
    </section>
  );
}
