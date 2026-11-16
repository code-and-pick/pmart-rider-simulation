// 화면 표시용 "배송 단계" — 배차(dispatch)·수행(execution) 두 상태를 합쳐 사람이 읽는 한 줄로(docs/design.md §4).
// 정본 값이 아니다. 계산 규칙은 이 파일 한 곳에만 두고, 화면에는 원래 두 상태를 출처와 함께 작게 남긴다.

import type { DeliveryPurpose, DispatchState, ExecutionState } from './contract';

/** 0 배차 요청 · 1 배정 · 2 가게 도착 · 3 픽업 · 4 고객 도착 · 5 완료 */
export const STAGES = ['배차 요청', '배정', '가게 도착', '픽업', '고객 도착', '완료'] as const;
/** 오배송 회수: 잘못 둔 곳 → MFC 반납 */
export const RECOVERY_STAGES = ['배차 요청', '배정', '잘못 둔 곳', '회수', 'MFC 도착', '반납'] as const;
/** 고객 잘못 다시 배송: 잘못 둔 곳 → 실제 집 */
export const REDELIVERY_STAGES = ['배차 요청', '배정', '잘못 둔 곳', '받음', '고객 도착', '완료'] as const;

/** 배송 목적별 단계 이름(막대) */
export function stagesFor(purpose?: DeliveryPurpose | null): readonly string[] {
  if (purpose === 'MISDELIVERY_RECOVERY') return RECOVERY_STAGES;
  if (purpose === 'MISDELIVERY_REDELIVERY') return REDELIVERY_STAGES;
  return STAGES;
}

/** 배송 목적 짧은 이름(카드 꼬리표) — 일반 배송은 없음 */
export function purposeLabel(purpose?: DeliveryPurpose | null): string | null {
  switch (purpose) {
    case 'MISDELIVERY_RECOVERY':
      return '오배송 회수';
    case 'MISDELIVERY_RESHIPMENT':
      return '재발송';
    case 'MISDELIVERY_REDELIVERY':
      return '다시 배송';
    case 'CLAIM_RETURN':
      return '반품 회수';
    default:
      return null;
  }
}

export type StageTone = 'active' | 'done' | 'warn' | 'fail';

export interface StageView {
  /** 지금 단계(0~5) — 막대에서 여기까지 채운다 */
  index: number;
  tone: StageTone;
  /** 지금 무슨 일인지(한국어) */
  text: string;
  /** 막대 단계 이름(목적별) */
  labels: readonly string[];
}

export function displayStage(
  d: DispatchState | null,
  x: ExecutionState | null,
  radiusKm: number | null = null,
  purpose: DeliveryPurpose | null = null,
): StageView {
  const v = stageOf(d, x, radiusKm, purpose);
  return { ...v, labels: stagesFor(purpose) };
}

function stageOf(d: DispatchState | null, x: ExecutionState | null, radiusKm: number | null, purpose: DeliveryPurpose | null): Omit<StageView, 'labels'> {
  const wrongPlace = purpose === 'MISDELIVERY_RECOVERY' || purpose === 'MISDELIVERY_REDELIVERY';
  // 회수·다시 배송 — 가게 대신 잘못 둔 곳(2 단계)에서 받는다
  if (wrongPlace) {
    if (x === 'RETURN_PICKED_UP') return { index: 4, tone: 'active', text: '회수품 받음 — MFC 로 가는 중' };
    if (x === 'ASSIGNED') return { index: 2, tone: 'active', text: '배정 — 잘못 둔 곳으로 가는 중' };
    if (purpose === 'MISDELIVERY_REDELIVERY' && x === 'PICKED_UP') return { index: 3, tone: 'active', text: '잘못 둔 곳에서 받음 — 실제 집으로' };
    if (purpose === 'MISDELIVERY_REDELIVERY' && d === 'CREATED') return { index: 0, tone: 'warn', text: '결제 대기 — 다시 배송비 결제되면 배차' };
  }
  // 끝난 것·문제 먼저
  if (x === 'COMPLETED') return { index: 5, tone: 'done', text: '전달 완료' };
  if (x === 'FAILED') return { index: 4, tone: 'fail', text: '전달 실패 확정' };
  if (x === 'FAILURE_REPORTED') return { index: 4, tone: 'warn', text: '전달 실패 등록 — 운영자 확인 대기' };
  if (x === 'RETURNED_TO_STORE') return { index: 5, tone: 'done', text: '회수품 MFC 반납' };
  if (x === 'RETURN_PICKED_UP') return { index: 3, tone: 'active', text: '회수품 받아 MFC 로' };
  if (d === 'DISPATCH_FAILED') return { index: 0, tone: 'fail', text: '라이더를 못 찾음' };
  if (d === 'CANCELLED_BEFORE_PICKUP' || x === 'CANCELLED') return { index: 0, tone: 'fail', text: '픽업 전 취소' };
  if (d === 'BLOCKED') return { index: 0, tone: 'fail', text: '주문 취소로 배차 막힘' };

  // 진행 중 — 수행 쪽이 더 자세하다(가게·고객 도착은 수행만 안다)
  if (x === 'ARRIVED_AT_CUSTOMER') return { index: 4, tone: 'active', text: '고객 도착 — 전달 중' };
  if (x === 'PICKED_UP' || d === 'PICKED_UP') return { index: 3, tone: 'active', text: '픽업 완료 — 고객으로 가는 중' };
  if (x === 'ARRIVED_AT_STORE') return { index: 2, tone: 'active', text: '가게 도착 — 포장·인계 기다림' };
  if (x === 'ASSIGNED' || d === 'ASSIGNED') {
    return { index: 1, tone: 'active', text: x === 'ASSIGNED' ? '배정 — MFC 로 가는 중' : '배정 — 수행 쪽 반영 기다림' };
  }
  if (d === 'CLOSED') return { index: 5, tone: 'done', text: '배차 종료' };
  if (d === 'DISPATCHING') return { index: 0, tone: 'active', text: radiusKm ? `라이더 찾는 중(반경 ${radiusKm}km)` : '라이더 찾는 중' };
  if (d === 'CREATED') return { index: 0, tone: 'active', text: '배차 요청 기다림' };
  return { index: 0, tone: 'active', text: '확인 중' };
}
