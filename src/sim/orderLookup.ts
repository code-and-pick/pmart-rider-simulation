// 주문 창 "주문" 탭 — 직원용 주문 상세와 원문 열람(사용자 2026-11-19 "여기서 다 열람할 수 있게 해").
// 실서버 = order-service 0.13.1 GET /orders/lookups/{id} · POST …/pii-reveals(관제 계정, 이 PC 만), MOCK = 가상 값.
// React 에 의존하지 않는다(화면 없이 시험). 값은 이 객체 메모리에만 — 로그·저장소에 남기지 않는다.
//
// 열람(쓰기)은 서버가 확정한 결과만 확정으로 그린다: 응답이 없거나 5xx(감사 기록을 못 남김)면 "결과 불명" —
// 같은 사유·항목으로 다시 누르면 같은 Idempotency-Key 로 다시 보낸다(같은 열람 기록으로 이어짐, 계약).

import type { WriteOptions } from '../backend/port';
import { ApiProblem, ResultUnknown, type StaffOrderDetail, type StaffPiiField, type StaffPiiReveal, type StaffPiiRevealRequest } from '../domain/contract';

export type OrderDetailView = { state: 'loading' } | { state: 'ok'; detail: StaffOrderDetail } | { state: 'none'; reason: string };

export type OrderRevealView =
  | { state: 'none' }
  | { state: 'sending' }
  | { state: 'ok'; reveal: StaffPiiReveal }
  | { state: 'unknown'; reason: string }
  | { state: 'failed'; reason: string };

export interface OrderSource {
  getOrder(orderId: string): Promise<StaffOrderDetail>;
  reveal(orderId: string, body: StaffPiiRevealRequest, w: WriteOptions): Promise<StaffPiiReveal>;
}

export const ALL_PII_FIELDS: readonly StaffPiiField[] = ['NAME', 'PHONE', 'ADDRESS', 'ENTRANCE'];

/** 사유 규칙(계약: 앞뒤 공백 빼고 2~200자) — 맞으면 null */
export function reasonProblem(reason: string): string | null {
  const t = reason.trim();
  if (t.length < 2) return '열람 사유를 2자 이상 적어 주세요';
  if (t.length > 200) return '열람 사유는 200자까지';
  return null;
}

export class OrderLookup {
  private readonly details = new Map<string, OrderDetailView>();
  private readonly reveals = new Map<string, OrderRevealView>();
  /** 결과 불명일 때 같은 키로 다시 보내려고 — 주문마다 (사유·항목 → 키) */
  private readonly pending = new Map<string, { sig: string; key: string }>();

  constructor(
    private readonly src: OrderSource,
    /** 지금 부를 수 없는 이유(다른 기기·관제 계정 없음 등) — 부를 수 있으면 null */
    private readonly blocked: () => string | null = () => null,
    private readonly newKey: () => string = randomKey,
  ) {}

  /** 주문 상세 — 처음 부르면 읽기 시작(loading). 한 번 읽은 값은 그대로(다시 읽기는 refresh) */
  detail(orderId: string): OrderDetailView {
    const why = this.blocked();
    if (why) return { state: 'none', reason: why };
    const cur = this.details.get(orderId);
    if (cur) return cur;
    this.details.set(orderId, { state: 'loading' });
    this.src.getOrder(orderId).then(
      (detail) => this.details.set(orderId, { state: 'ok', detail }),
      (e: unknown) => this.details.set(orderId, { state: 'none', reason: detailError(e) }),
    );
    return { state: 'loading' };
  }

  refresh(orderId: string): void {
    this.details.delete(orderId);
  }

  revealView(orderId: string): OrderRevealView {
    return this.reveals.get(orderId) ?? { state: 'none' };
  }

  /** 원문 열람 — 사유 필수, 서버가 열람 기록을 남긴 뒤에만 원문이 온다 */
  async reveal(orderId: string, reason: string, fields: readonly StaffPiiField[]): Promise<void> {
    const why = this.blocked() ?? reasonProblem(reason);
    if (why) {
      this.reveals.set(orderId, { state: 'failed', reason: why });
      return;
    }
    if (this.reveals.get(orderId)?.state === 'sending') return;
    const body: StaffPiiRevealRequest = { reason: reason.trim(), fields: [...fields] };
    const sig = JSON.stringify(body);
    const prev = this.pending.get(orderId);
    const key = prev && prev.sig === sig ? prev.key : this.newKey();
    this.pending.set(orderId, { sig, key });
    this.reveals.set(orderId, { state: 'sending' });
    try {
      const reveal = await this.src.reveal(orderId, body, { idempotencyKey: key });
      this.pending.delete(orderId);
      this.reveals.set(orderId, { state: 'ok', reveal });
    } catch (e) {
      if (e instanceof ResultUnknown || (e instanceof ApiProblem && e.status >= 500)) {
        // 키를 남긴다 — 같은 사유·항목으로 다시 누르면 같은 키
        this.reveals.set(orderId, { state: 'unknown', reason: '결과를 모름(응답 없음·열람 기록을 못 남김) — 다시 누르면 같은 요청으로 다시 보냄' });
      } else {
        this.pending.delete(orderId);
        this.reveals.set(orderId, { state: 'failed', reason: revealError(e) });
      }
    }
  }

  /** 원문 가리기 — 화면 메모리에서 지운다 */
  hide(orderId: string): void {
    this.reveals.delete(orderId);
  }
}

/** 요청 키 — crypto.randomUUID 는 보안 출처(https·localhost)에서만 있어 LAN 주소(http://192.168…)로 열면 없다. getRandomValues 는 어디서나 */
function randomKey(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return `pii-${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

function detailError(e: unknown): string {
  if (e instanceof ApiProblem) {
    if (e.status === 403) return '권한 없음(라이더 운영·고객센터·관리자만)';
    if (e.status === 404) return '확정 전이거나 없는 주문';
    return `주문을 못 읽음(${e.status} ${e.code ?? ''})`.trim();
  }
  return '주문을 못 읽음(응답 없음) — 탭을 다시 열면 다시 읽음';
}

function revealError(e: unknown): string {
  if (e instanceof ApiProblem) {
    if (e.status === 400) return '사유·항목이 계약에 맞지 않음(사유 2~200자)';
    if (e.status === 403) return '권한 없음(라이더 운영·고객센터·관리자만)';
    if (e.status === 404) return e.code === 'SHIPPING_COPY_NOT_FOUND' ? '배송지 사본이 없는 옛 주문(2026-11-02 이전)' : '없는 주문';
    if (e.status === 409) return '같은 요청 키에 다른 사유·항목 — 다시 눌러 주세요';
    return `열람 못 함(${e.status} ${e.code ?? ''})`.trim();
  }
  return '열람 못 함';
}
