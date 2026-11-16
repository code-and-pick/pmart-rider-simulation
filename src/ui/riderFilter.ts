// 라이더 하나로 거르기 — 화면 오른쪽 탭(배송·사건·API·기록). React 에 의존하지 않는다(시험).
// riderId 가 null 이면 거르지 않는다.

import type { ApiCallRecord, DomainEventRecord } from '../backend/port';
import type { DeliveryCard, NoteRecord } from '../sim/world';

/** 이 라이더가 제안을 받았거나 배정된 배송 */
export function cardsFor(cards: DeliveryCard[], riderId: string | null): DeliveryCard[] {
  if (!riderId) return cards;
  return cards.filter((c) => c.riderId === riderId || c.riderIds.includes(riderId));
}

/** 이 라이더에게 이 배송은 무엇이었나 — 배정 / 제안만 받음(다른 라이더가 가져갔거나 응답 안 함) */
export function roleOf(card: DeliveryCard, riderId: string): '배정' | '제안만 받음' {
  return card.riderId === riderId ? '배정' : '제안만 받음';
}

/**
 * 이 라이더의 사건: 라이더가 적힌 사건 + 라이더가 적히지 않은 배송 단위 사건 중 이 라이더에게 배정된 배송의 것
 * (예: ShipmentReady·PickupCompleted). 제안만 받은 배송의 뒷일(다른 라이더의 인계 등)은 넣지 않는다.
 */
export function eventsFor(events: readonly DomainEventRecord[], cards: DeliveryCard[], riderId: string | null): DomainEventRecord[] {
  if (!riderId) return [...events];
  const mine = new Set(cards.filter((c) => c.riderId === riderId).map((c) => c.deliveryId));
  return events.filter((e) => e.riderId === riderId || (!e.riderId && e.deliveryId !== undefined && mine.has(e.deliveryId)));
}

/** 이 라이더 토큰으로 부른 API(관찰 계정 조회는 빠진다) */
export function apiFor(api: readonly ApiCallRecord[], riderId: string | null): ApiCallRecord[] {
  if (!riderId) return [...api];
  return api.filter((r) => r.actor === riderId);
}

export function notesFor(notes: readonly NoteRecord[], riderId: string | null): NoteRecord[] {
  if (!riderId) return [...notes];
  return notes.filter((n) => n.riderId === riderId);
}
