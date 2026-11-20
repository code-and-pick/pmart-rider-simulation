import type { DeliveryPurpose } from './contract';
import { deliveryKindName } from './displayStage';
// 화면용 번호 — 시스템 번호(DLV-·ORD-·RD- + UUID)는 길고 뜻이 없어서, 사람이 읽는 번호를 먼저 보이고 전체 번호는 마우스 설명에 둔다.
//   주문: 화면용 주문번호(8자리 — 고객·라이더·MFC·상담원이 같은 번호, order-service)
//   배송: 화면 배송 번호 = 주문번호-순번(예 74939255-1, ADR-0070) — 없으면 짧은 시스템 번호
//   라이더: 마스킹 이름 + 번호 앞 4자리(백엔드에 짧은 라이더 번호는 없음)

/**
 * 라이더 번호를 화면용으로 짧게 — 라이더 앱 계정은 백엔드 고유번호(`RD-5c41a0e7-2ac3-…`)라 앞 4자리 `5c41`,
 * 시뮬레이터 라이더(`RD-sim-01`)는 `sim-01`.
 */
export function shortRiderId(id: string): string {
  const uuid = /^RD-([0-9a-f]{4})[0-9a-f]{4}-[0-9a-f-]+$/i.exec(id);
  if (uuid) return uuid[1] as string;
  return id.replace(/^RD-/, '');
}

/**
 * 라이더 화면 표기 "김*수 · 482913"(ADR-0070) — 서버 묶음 조회(rider 0.18.0 display-names·관제 목록)로 채운다.
 * 화면은 시스템 ID(RD-…) 대신 이것을 먼저 보이고, 모르면 짧은 ID. 화면 메모리에만(저장소·로그에 안 남김).
 */
const displayNames = new Map<string, string>();

export function setRiderDisplayName(riderId: string, riderNumber: string | null | undefined, nameMasked: string | null | undefined): void {
  const label = [nameMasked, riderNumber].filter(Boolean).join(' · ');
  if (label) displayNames.set(riderId, label);
}

export function knownRiderName(riderId: string): string | null {
  return displayNames.get(riderId) ?? null;
}

/** 화면에 보일 라이더 이름 — 서버 표기 → 넘겨준 대체 → 짧은 ID */
export function riderName(riderId: string, fallback?: string | null): string {
  return displayNames.get(riderId) ?? fallback ?? shortRiderId(riderId);
}

/** `DLV-8704f124-3020-…` → `DLV-8704`, 출고 `ORD-4cd46d90-…-S1` → `ORD-4cd4-S1`. UUID 꼴이 아니면 그대로(MOCK `DL-m00005` 등) */
export function shortId(id: string): string {
  const m = /^([A-Z]+)-([0-9a-f]{4})[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-[A-Za-z0-9]+)?$/i.exec(id);
  return m ? `${m[1]}-${m[2]}${m[3] ?? ''}` : id;
}

/** 주문 — 화면용 주문번호, 없으면 짧은 주문 ID */
export function orderLabel(c: { orderNumber: string | null; orderId: string | null }): string | null {
  return c.orderNumber ?? (c.orderId ? shortId(c.orderId) : null);
}

/** 배송 이름 — "28767701-2 · 전달 실패 반납"(번호 + 무슨 배송인지). 번호(-1·-2)만으로는 관리자가 무슨 배송인지 모른다(사용자 2026-11-20) */
export function deliveryName(c: { deliveryNumber: string | null; deliveryId: string; purpose?: DeliveryPurpose | null }): string {
  return `${deliveryLabel(c)} · ${deliveryKindName(c.purpose)}`;
}

/** 배송 — 화면 배송 번호, 없으면 짧은 배송 ID */
export function deliveryLabel(c: { deliveryNumber: string | null; deliveryId: string }): string {
  return c.deliveryNumber ?? shortId(c.deliveryId);
}
