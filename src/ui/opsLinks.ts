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

export const OPS_SCREENS: readonly OpsScreen[] = [
  { key: 'cases', title: '접수 건', what: '도움요청·배차 실패·위치 끊김·오배송·배송 사고(배송 쪽 사건함)', path: '/cases' },
  { key: 'deliveries', title: '배송 찾기', what: '주문·라이더·상태로 배송 찾기, 수행·배차 상세', path: '/deliveries' },
  { key: 'control', title: '라이더 관제', what: '지도 위 라이더·진행 배송·경고(직원용 위치 목록 API 대기)', path: null },
  { key: 'riders', title: '라이더 찾기', what: '라이더 상세·계정 제한·수행료 조정', path: null },
];

/** 시뮬레이터 모드에 맞는 라이더 백오피스 주소 */
export function opsBase(mode: 'mock' | 'http'): string {
  return mode === 'http' ? OPS_BACKOFFICE.lan : OPS_BACKOFFICE.dev;
}

export function opsUrl(mode: 'mock' | 'http', screen: OpsScreen): string | null {
  return screen.path === null ? null : `${opsBase(mode)}${screen.path}`;
}
