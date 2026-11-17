// 운영 화면 목록 — 라이더 운영 화면은 라이더 백오피스(pmart-clients `web/rider-backoffice`)에 만든다(사용자 2026-11-17
// "백오피스에 만들고 시뮬에 탭"). 시뮬레이터는 화면을 다시 만들지 않고 그 화면으로 가는 길만 둔다(새 탭으로 연다).
// - MOCK: 라이더 백오피스 목 모드(`npm run dev -w web/rider-backoffice`, http://localhost:5176 — 목 데이터, 이 시뮬레이터 MOCK 과는 별개)
// - 실서버: LAN 라이더 백오피스(https://192.168.0.40:8446 — 직원 로그인, 같은 실서버 배송이 보인다)
import { OPS_BACKOFFICE } from '../config';

export interface OpsScreen {
  readonly key: string;
  readonly title: string;
  readonly what: string;
  /** 라이더 백오피스 경로. null 이면 아직 화면이 없다(준비 중) */
  readonly path: string | null;
}

// 라이더 백오피스 메뉴(2026-11-17 라이더 운영 화면 — pmart-clients web/rider-backoffice nav.ts 와 같은 순서·경로)
export const OPS_SCREENS: readonly OpsScreen[] = [
  { key: 'dashboard', title: '라이더 대시보드', what: '라이더 수·제한·진행 중 배송·도움요청·운영 알림', path: '/dashboard' },
  { key: 'control', title: '위치 모니터링', what: '센터의 운행 중 라이더 현재 위치·위치 끊김·진행 배송(10초마다)', path: '/control' },
  { key: 'deliveries', title: '배송·배차 현황', what: '배송 찾기·수행·배차 상세, 전달 실패 확정·배차 취소·상태 정정', path: '/deliveries' },
  { key: 'help-requests', title: '도움요청', what: '라이더 도움요청 대기열·지원센터 대화·처리', path: '/help-requests' },
  { key: 'cases', title: '접수 건', what: '도움요청·배차 실패·위치 끊김·오배송·배송 사고(배송 쪽 사건함)', path: '/cases' },
  { key: 'riders', title: '라이더 목록', what: '라이더 상세·계정 제한·계약 종료·배송 이력·수행료', path: '/riders' },
  { key: 'signups', title: '가입 승인', what: '최근 가입(지금은 가입 즉시 자동 승인)', path: '/signups' },
  { key: 'restriction-reviews', title: '제한 검토', what: '컴플레인 누적 검토', path: '/restriction-reviews' },
  { key: 'inquiries', title: '라이더 문의', what: '배송 밖 문의 대화·답변·닫기', path: '/inquiries' },
  { key: 'adjustments', title: '수행료 조정', what: '산정 불가 수행료(전달 실패·자동 완료) — 귀책으로 지급/미지급', path: '/adjustments' },
  { key: 'surcharges', title: '추가 배달료', what: '엘리베이터 고장 추가 배달료 신청 승인·반려', path: '/surcharges' },
];

/** 시뮬레이터 모드에 맞는 라이더 백오피스 주소 */
export function opsBase(mode: 'mock' | 'http'): string {
  return mode === 'http' ? OPS_BACKOFFICE.lan : OPS_BACKOFFICE.dev;
}

export function opsUrl(mode: 'mock' | 'http', screen: OpsScreen): string | null {
  return screen.path === null ? null : `${opsBase(mode)}${screen.path}`;
}
