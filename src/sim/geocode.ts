// 주소 → 좌표 — 오배송 고객 잘못 다시 배송(MISDELIVERY_REDELIVERY)의 전달지는 주소 글자만 있고 지도 핀이 없다(execution).
// 가상 라이더는 이것으로 실제 집 위치를 찾는다. MOCK 은 MOCK 주소록, 실서버는 개발 서버 /sim-geocode(카카오 주소 검색 — 키는 서버에만).
// 주소는 화면·로그·기록에 남기지 않는다(CLAUDE.md). 찾을 수 없는 상태(키 없음·막힘)면 다시 배송 제안을 받지 않는다.

import type { LatLng } from '../util/geo';

export interface AddressLocator {
  /** 지금 주소로 위치를 찾을 수 있나 — 다시 배송 제안을 받을지 정할 때 */
  readonly ready: boolean;
  /** 도로명 주소 → 좌표(못 찾으면 null) */
  locate(roadAddress: string): Promise<LatLng | null>;
}

/** MOCK — MockBackend 주소록 */
export function mockLocator(find: (roadAddress: string) => LatLng | null): AddressLocator {
  return { ready: true, locate: async (a) => find(a) };
}

/** 실서버 — 개발 서버 /sim-geocode(이 PC 만). 처음엔 준비 안 됨, refresh() 로 상태를 읽는다. */
export class DevServerGeocoder implements AddressLocator {
  ready = false;
  /** 준비 안 된 이유(NO_KEY·KEY_REJECTED·QUOTA·DAILY_CAP …) — 화면 진단 */
  reason: string | null = '확인 전';

  constructor(private readonly doFetch: typeof fetch = (...a) => fetch(...a)) {}

  async refresh(): Promise<void> {
    try {
      const res = await this.doFetch('/sim-geocode/status', { cache: 'no-store', signal: AbortSignal.timeout(5_000) });
      const body = (await res.json()) as { ready?: boolean; reason?: string | null };
      this.ready = res.ok && body.ready === true;
      this.reason = this.ready ? null : (body.reason ?? `HTTP ${res.status}`);
    } catch {
      this.ready = false;
      this.reason = '개발 서버 응답 없음';
    }
  }

  async locate(roadAddress: string): Promise<LatLng | null> {
    try {
      const res = await this.doFetch('/sim-geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: roadAddress }),
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json()) as { kind?: string; lat?: number; lng?: number; reason?: string };
      if (res.ok && body.kind === 'FOUND' && typeof body.lat === 'number' && typeof body.lng === 'number') return { lat: body.lat, lng: body.lng };
      // 키 거절·사용량 끝이면 그날은 더 받지 않는다(이미 받은 배송은 도움요청 → 실패로)
      if (body.reason && body.reason !== 'NOT_FOUND' && body.reason !== 'UNAVAILABLE') {
        this.ready = false;
        this.reason = body.reason;
      }
      return null;
    } catch {
      return null;
    }
  }
}
