import { useState } from 'react';
import { useApp } from '../app/App';
import type { OrderShippingAddress, OrderStatus, StaffOrderDetail, StaffPiiField } from '../domain/contract';
import { ALL_PII_FIELDS, reasonProblem } from '../sim/orderLookup';
import { seoulTime } from './format';

/*
 * 주문 창 "주문" 탭 — 품목·금액·결제·받는 분·배송지·요청사항(사용자 2026-11-19 "주문 상세도 … 여기서 다 열람할 수 있게 해").
 * 실서버 = order-service 직원용 주문 상세(가린 값) + 원문 열람(사유 필수, 백엔드가 열람 기록을 남긴 뒤에만 원문).
 * 원문은 화면 메모리에만 — 다른 배송을 고르거나 창을 닫으면 지운다(MapDetail). 복사·로그·저장 안 함.
 */

const STATUS: Record<OrderStatus, string> = {
  DRAFT: '작성 중',
  RESOURCE_PENDING: '재고 확인 중',
  PAYMENT_PENDING: '결제 대기',
  PAYMENT_UNKNOWN: '결제 확인 중',
  CONFIRMED: '주문 확정',
  PREPARING: '상품 준비 중',
  PARTIALLY_HANDED_OVER: '일부 인계',
  IN_DELIVERY: '배송 중',
  PARTIALLY_DELIVERED: '일부 전달',
  COMPLETED: '배송 완료',
  CANCELLED: '취소',
  EXPIRED: '만료',
};
const MODE: Record<StaffOrderDetail['deliveryMode'], string> = { SINGLE: '바로 배송', BUNDLED: '묶음 배송', SCHEDULED: '예약 배송' };
const TIP_REASON: Record<string, string> = { STANDARD: '기본', OVER_30000: '3만 원 이상 무료', FIRST_PURCHASE: '첫 구매', NONE: '없음' };
const ENTRANCE: Record<string, string> = { FREE: '자유 출입', PASSWORD: '공동현관 비밀번호', CALL: '호출', OTHER: '기타' };
const ISSUE: Record<string, string> = { QUALITY_HOLD: '품질 격리', COUNT_LOSS: '실사 손실', SHORT: '피킹 결품', DAMAGED: '파손', BLOCKED: '피킹 차단', UNKNOWN: '사유 모름' };
const FIELD: Record<StaffPiiField, string> = { NAME: '수령인', PHONE: '연락처', ADDRESS: '상세 주소·핀', ENTRANCE: '출입 메모·요청사항' };
const QUICK_REASONS = ['고객 문의 — 배송지 확인', '라이더 문의 — 출입 방법', '배송 사고·오배송 확인'];

const won = (n: number | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`;

export function OrderTab({ orderId }: { orderId: string | null }) {
  const app = useApp();
  const orders = app.sim.orders;
  if (!orderId) return <p className="c-muted">주문이 없는 배송입니다(오배송 회수 등).</p>;
  if (!orders) return <p className="c-muted">이 화면에서는 주문을 읽지 않습니다.</p>;
  const v = orders.detail(orderId);
  if (v.state === 'loading') return <p className="c-muted">주문 읽는 중…</p>;
  if (v.state === 'none') {
    return (
      <p className="c-muted">
        {v.reason}{' '}
        <button className="link" onClick={() => orders.refresh(orderId)}>
          다시 읽기
        </button>
      </p>
    );
  }
  return <OrderBody o={v.detail} />;
}

function OrderBody({ o }: { o: StaffOrderDetail }) {
  const app = useApp();
  const orders = app.sim.orders!;
  const rv = orders.revealView(o.orderId);
  const revealed = rv.state === 'ok' ? rv.reveal : null;
  const addr: OrderShippingAddress | null = revealed?.shippingAddress ?? o.shippingAddress ?? null;
  const opened = new Set(revealed?.fields ?? []);
  const units = o.lines.reduce((a, l) => a + (l.originalQty ?? 0), 0);
  const discount = o.lines.reduce((a, l) => a + (l.discountShare ?? 0), 0);
  const note = opened.has('ENTRANCE') ? (revealed?.deliveryNote ?? null) : null;
  const confirmed = Date.parse(o.confirmedAt);

  return (
    <div className="od">
      <div className="od-head">
        <span className={`od-status s-${o.status}`}>{STATUS[o.status] ?? o.status}</span>
        <span className="c-muted">
          확정 {Number.isFinite(confirmed) ? `${new Date(confirmed + 9 * 3600_000).toISOString().slice(5, 10).replace('-', '/')} ${seoulTime(confirmed).slice(0, 5)}` : '—'} · {MODE[o.deliveryMode] ?? o.deliveryMode}
          {o.arrivalWindow && ` ${o.arrivalWindow.start}~${o.arrivalWindow.end}`}
        </span>
      </div>

      <section className="od-sec" aria-label="품목">
        <h4>
          품목 <span className="c-muted">{o.lines.length}종 · {units}개</span>
        </h4>
        <ul className="od-lines">
          {o.lines.map((l, i) => (
            <li key={l.orderLineId ?? i}>
              <span className="nm">
                {l.productName ?? l.sku}
                {l.optionLabel && <small> · {l.optionLabel}</small>}
                {!!l.unfulfilledQty && <em className="od-tag bad">결품 {l.unfulfilledQty}</em>}
                {!!l.cancelledBeforeShipQty && <em className="od-tag">출고 전 취소 {l.cancelledBeforeShipQty}</em>}
                {!!l.returnedQty && <em className="od-tag">반품 {l.returnedQty}</em>}
              </span>
              <span className="q">×{l.originalQty ?? '—'}</span>
              <span className="a">{won(l.lineAmount)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="od-sec" aria-label="금액">
        <h4>금액</h4>
        <dl className="od-amt">
          <dt>상품</dt>
          <dd>{won(o.amounts.itemAmount)}</dd>
          {discount > 0 && (
            <>
              <dt>할인</dt>
              <dd>-{won(discount)}</dd>
            </>
          )}
          <dt>배달팁</dt>
          <dd>
            {won(o.amounts.deliveryTip)} <small className="c-muted">{TIP_REASON[o.amounts.deliveryTipReason] ?? o.amounts.deliveryTipReason}</small>
          </dd>
          {o.amounts.bagFee > 0 && (
            <>
              <dt>봉투</dt>
              <dd>{won(o.amounts.bagFee)}</dd>
            </>
          )}
          <dt className="tot">합계</dt>
          <dd className="tot">{won(o.amounts.totalAmount)}</dd>
          <dt>결제 승인</dt>
          <dd>
            {won(o.amounts.approvedAmount)}
            {o.amounts.approvedAmount !== o.amounts.totalAmount && <em className="od-tag bad">합계와 다름</em>}
          </dd>
        </dl>
      </section>

      <section className="od-sec" aria-label="받는 분·배송지">
        <h4>
          받는 분·배송지{' '}
          {revealed ? (
            <span className="od-open">
              원문 · 열람 기록 남음 {seoulTime(Date.parse(revealed.recordedAt)).slice(0, 5)}
              <button className="link" onClick={() => orders.hide(o.orderId)}>
                가리기
              </button>
            </span>
          ) : (
            <span className="c-muted">가린 값</span>
          )}
        </h4>
        {addr ? (
          <dl className="od-kv">
            <dt>수령인</dt>
            <dd className={opened.has('NAME') ? 'raw' : ''}>{addr.receiverName ?? '—'}</dd>
            <dt>연락처</dt>
            <dd className={opened.has('PHONE') ? 'raw' : ''}>{addr.receiverPhone ?? '—'}</dd>
            <dt>주소</dt>
            <dd className={opened.has('ADDRESS') ? 'raw' : ''}>
              {[addr.roadAddress, addr.detailAddress].filter(Boolean).join(' ')}
              {addr.postalCode && <small className="c-muted"> ({addr.postalCode})</small>}
            </dd>
            <dt>출입</dt>
            <dd className={opened.has('ENTRANCE') ? 'raw' : ''}>
              {addr.entranceMethod ? (ENTRANCE[addr.entranceMethod] ?? addr.entranceMethod) : '—'}
              {opened.has('ENTRANCE') && addr.entranceNote && ` · ${addr.entranceNote}`}
              {!opened.has('ENTRANCE') && addr.entranceMethod && addr.entranceMethod !== 'FREE' && <small className="c-muted"> · 메모 가림</small>}
            </dd>
            <dt>요청사항</dt>
            <dd className={opened.has('ENTRANCE') ? 'raw' : ''}>
              {opened.has('ENTRANCE') ? (note ?? '없음') : o.deliveryNoteMasked ? <span className="c-muted">있음 · 가림</span> : (o.deliveryNote ?? '없음')}
            </dd>
          </dl>
        ) : (
          <p className="c-muted">주문 당시 배송지 사본이 없는 옛 주문(2026-11-02 이전)입니다.</p>
        )}
        {addr && !revealed && <RevealForm orderId={o.orderId} />}
      </section>

      {o.fulfillmentIssues.length > 0 && (
        <section className="od-sec" aria-label="이행 확인 필요">
          <h4>
            이행 확인 필요 <span className="c-muted">{o.fulfillmentIssues.length}건</span>
          </h4>
          <ul className="od-issues">
            {o.fulfillmentIssues.map((f, i) => (
              <li key={f.issueId ?? i}>
                {f.sku} · {ISSUE[f.reason ?? 'UNKNOWN'] ?? f.reason} {f.blockedQty ?? 0}개 · <b>{f.state === 'OPEN' ? '확인 필요' : f.state === 'ACKNOWLEDGED' ? '확인함' : '해결'}</b>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="od-foot c-muted">
        결제 {o.payment.pgTransactionId ? `PG ${o.payment.pgTransactionId}` : o.payment.paymentAttemptId} · 결품 시 {o.outOfStockPreference === 'CANCEL_ALL' ? '전체 취소' : '결품만 취소'}
        {app.sim.mode === 'mock' && ' · 가상(MOCK) 주문 — 금액·배송지·요청사항 모두 가짜'}
      </p>
    </div>
  );
}

/** 원문 열람 — 사유(필수)·항목 고르기 → 열람(백엔드가 열람 기록을 남긴 뒤에만 원문) */
function RevealForm({ orderId }: { orderId: string }) {
  const app = useApp();
  const orders = app.sim.orders!;
  const rv = orders.revealView(orderId);
  const [reason, setReason] = useState('');
  const [fields, setFields] = useState<StaffPiiField[]>([...ALL_PII_FIELDS]);
  const bad = reasonProblem(reason);
  const sending = rv.state === 'sending';
  const toggle = (f: StaffPiiField) => setFields((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : ALL_PII_FIELDS.filter((x) => x === f || cur.includes(x))));
  return (
    <form
      className="od-reveal"
      onSubmit={(e) => {
        e.preventDefault();
        if (!bad && fields.length) void orders.reveal(orderId, reason, fields);
      }}
    >
      <div className="od-reveal-h">
        원문 열람 <span className="c-muted">사유를 적으면 열람 기록이 남고 원문이 보입니다</span>
      </div>
      <div className="od-quick">
        {QUICK_REASONS.map((q) => (
          <button type="button" key={q} className={reason === q ? 'on' : ''} onClick={() => setReason(q)}>
            {q}
          </button>
        ))}
      </div>
      <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="열람 사유(2자 이상) — 예: 고객 문의 — 배송지 확인" aria-label="열람 사유" />
      <div className="od-fields" role="group" aria-label="열람할 항목">
        {ALL_PII_FIELDS.map((f) => (
          <label key={f}>
            <input type="checkbox" checked={fields.includes(f)} onChange={() => toggle(f)} />
            {FIELD[f]}
          </label>
        ))}
      </div>
      <div className="od-reveal-f">
        <button type="submit" className="c-btn-s primary" disabled={!!bad || !fields.length || sending}>
          {sending ? '여는 중…' : rv.state === 'unknown' ? '다시 보내기(같은 요청)' : '열람'}
        </button>
        {(rv.state === 'failed' || rv.state === 'unknown') && <span className={rv.state === 'failed' ? 'bad' : 'warn'}>{rv.reason}</span>}
      </div>
    </form>
  );
}
