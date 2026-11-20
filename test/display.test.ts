// 화면 표시 — 배송 단계(두 상태를 합친 화면용 계산, docs/design.md §4)와 라이더 메모 쉬운 말.
import { describe, expect, it } from 'vitest';
import { displayStage } from '../src/domain/displayStage';
import { friendlyNote } from '../src/ui/friendly';

describe('배송 단계(화면용)', () => {
  it('정상 흐름 — design §4 표의 순서대로 0→5', () => {
    expect(displayStage('DISPATCHING', 'UNASSIGNED', 2)).toMatchObject({ index: 0, tone: 'active', text: '라이더 찾는 중(반경 2km)' });
    expect(displayStage('ASSIGNED', 'UNASSIGNED')).toMatchObject({ index: 1, text: '배정 — 수행 쪽 반영 기다림' }); // 반영 지연
    expect(displayStage('ASSIGNED', 'ASSIGNED')).toMatchObject({ index: 1, text: '배정 — MFC 로 가는 중' });
    expect(displayStage('ASSIGNED', 'ARRIVED_AT_STORE').index).toBe(2);
    expect(displayStage('PICKED_UP', 'ARRIVED_AT_STORE').index).toBe(3); // dispatch 가 먼저 PICKED_UP
    expect(displayStage('PICKED_UP', 'ARRIVED_AT_CUSTOMER').index).toBe(4);
    expect(displayStage('PICKED_UP', 'COMPLETED')).toMatchObject({ index: 5, tone: 'done' }); // CLOSED 반영 전
    expect(displayStage('CLOSED', 'COMPLETED')).toMatchObject({ index: 5, tone: 'done' });
  });

  it('문제 — 라이더 없음·취소·실패 등록·확정', () => {
    expect(displayStage('DISPATCH_FAILED', 'UNASSIGNED')).toMatchObject({ tone: 'fail', text: '라이더를 못 찾음' });
    expect(displayStage('CANCELLED_BEFORE_PICKUP', 'CANCELLED').tone).toBe('fail');
    expect(displayStage('BLOCKED', null).tone).toBe('fail');
    expect(displayStage('PICKED_UP', 'FAILURE_REPORTED')).toMatchObject({ index: 4, tone: 'warn' });
    expect(displayStage('CLOSED', 'FAILED')).toMatchObject({ tone: 'fail' });
  });

  it('실패 반납(dispatch 0.6.0) — 바로 배정 → MFC 반납, 막대 이름도 따로', () => {
    expect(displayStage('ASSIGNED', 'ASSIGNED', null, 'FAILED_DELIVERY_RETURN')).toMatchObject({ index: 3, tone: 'active', text: '실패 상품 들고 MFC 로' });
    expect(displayStage('CLOSED', 'RETURNED_TO_STORE', null, 'FAILED_DELIVERY_RETURN')).toMatchObject({ index: 5, tone: 'done', text: '실패 상품 MFC 반납' });
    expect(displayStage('ASSIGNED', 'ASSIGNED', null, 'FAILED_DELIVERY_RETURN').labels[5]).toBe('반납');
  });

  it('실서버에서 아직 못 읽은 값', () => {
    expect(displayStage(null, 'ASSIGNED').index).toBe(1);
    expect(displayStage(null, null)).toMatchObject({ index: 0, text: '확인 중' });
  });
});

describe('라이더 메모 쉬운 말', () => {
  it('백엔드 용어를 풀어 쓴다', () => {
    expect(friendlyNote('늦은 수락: ALREADY_ASSIGNED')).toBe('늦은 수락 — 다른 라이더가 먼저 가져감');
    expect(friendlyNote('늦은 수락: EXPIRED')).toBe('늦은 수락 — 응답 시간(1분)이 지남');
    expect(friendlyNote('거절(TOO_FAR)')).toBe('제안 거절(너무 멂)');
    expect(friendlyNote('제안을 받을 수 없는 상태(pollAfterSec null)')).toBe('지금은 제안을 받을 수 없음');
    expect(friendlyNote('포장 대기(출고 PREPARING)')).toBe('포장이 끝나길 기다리는 중');
    expect(friendlyNote('수락 → 배정 DL-m00013')).toBe('DL-m00013 수락 — 배정됨');
    expect(friendlyNote('제안 응답 거절됨(409 INVALID_STATE) — 대기로')).toBe('응답하려 했지만 제안이 이미 닫힘(다른 라이더 배정 등)');
  });

  it('모르는 문장은 그대로', () => {
    expect(friendlyNote('QR 인계 PK-m0001r')).toBe('QR 인계 PK-m0001r');
    expect(friendlyNote('')).toBe('');
  });
});

describe('오배송 배송의 단계(화면용)', () => {
  it('회수: 잘못 둔 곳 → 회수 → MFC 반납, 막대 이름도 회수용', () => {
    const a = displayStage('ASSIGNED', 'ASSIGNED', null, 'MISDELIVERY_RECOVERY');
    expect(a).toMatchObject({ index: 2, text: '배정 — 잘못 둔 곳으로 가는 중' });
    expect(a.labels[3]).toBe('회수');
    expect(displayStage('PICKED_UP', 'RETURN_PICKED_UP', null, 'MISDELIVERY_RECOVERY').index).toBe(4);
    expect(displayStage('CLOSED', 'RETURNED_TO_STORE', null, 'MISDELIVERY_RECOVERY')).toMatchObject({ index: 5, tone: 'done' });
  });
  it('다시 배송: 결제 대기 → 잘못 둔 곳에서 받음 → 완료, 일반 배송은 그대로', () => {
    expect(displayStage('CREATED', 'UNASSIGNED', null, 'MISDELIVERY_REDELIVERY')).toMatchObject({ index: 0, tone: 'warn' });
    expect(displayStage('PICKED_UP', 'PICKED_UP', null, 'MISDELIVERY_REDELIVERY')).toMatchObject({ index: 3, text: '잘못 둔 곳에서 받음 — 실제 집으로' });
    expect(displayStage('CLOSED', 'COMPLETED', null, 'MISDELIVERY_REDELIVERY')).toMatchObject({ index: 5, tone: 'done' });
    expect(displayStage('ASSIGNED', 'ASSIGNED', null, 'MISDELIVERY_RESHIPMENT')).toMatchObject({ index: 1, text: '배정 — MFC 로 가는 중' });
    expect(displayStage('ASSIGNED', 'ASSIGNED').labels[2]).toBe('가게 도착');
  });
});
