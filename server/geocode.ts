// 주소 → 좌표 — 카카오 로컬 주소 검색(GET /v2/local/search/address.json)을 Vite 개발 서버에서만 부른다(docs/design.md §3-1·§6-3).
// 쓰는 곳: 오배송 고객 잘못 다시 배송(MISDELIVERY_REDELIVERY) — 백엔드 전달지에 지도 핀이 없어(execution DropInfoService) 주소로 찾아간다.
// 사용자 결정 2026-11-16 "그렇게 해": 실서버 다시 배송을 받으려고 고객 주소(도로명 주소만)를 카카오 주소 검색에 보낸다.
//
// 개인정보 규칙(CLAUDE.md "로그·일지·화면에 주소를 남기지 않는다"):
//  - 보내는 것은 도로명 주소(roadAddress)만 — 상세 주소(동·호)·수령인·전화는 보내지 않는다(찾는 데 필요 없음).
//  - 주소·좌표를 로그에 남기지 않고, 보관(캐시)하지 않는다 — 횟수·결과 코드만.
//  - 브라우저 → 개발 서버는 POST 본문(주소가 URL·접근 로그에 남지 않게). 개발 서버 → 카카오는 카카오 API 가 GET 쿼리만 받는다(HTTPS).
// 키는 .env.local KAKAO_LOCAL_REST_KEY, 없으면 KAKAO_MOBILITY_REST_KEY(같은 카카오 앱 REST 키 — 시뮬레이터 전용, 백엔드와 나눠 쓰지 않음). VITE_ 아님.

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** NO_KEY 키 없음 · KEY_REJECTED 401/403(카카오맵 서비스 꺼짐 포함) · QUOTA 429 · DAILY_CAP 이 시뮬레이터 하루 상한 · NOT_FOUND 결과 없음 · UNAVAILABLE 장애·시간 초과 */
export type GeocodeFailReason = 'NO_KEY' | 'KEY_REJECTED' | 'QUOTA' | 'DAILY_CAP' | 'NOT_FOUND' | 'UNAVAILABLE';

export type GeocodeResult = ({ kind: 'FOUND' } & GeoPoint) | { kind: 'NONE'; reason: GeocodeFailReason };

const URL_BASE = 'https://dapi.kakao.com/v2/local/search/address.json';
/** 하루(서울 날짜) 주소 검색 상한 [시뮬] — 다시 배송 한 건에 한 번. 카카오 무료 사용량은 확인하지 않았다 [미검증] */
export const GEOCODE_DAILY_CAP = 200;
/** 주소 길이 상한 [시뮬] — 도로명 주소 한 줄 */
export const ADDRESS_MAX = 200;

const seoulDay = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);

export class GeocodeService {
  private day = '';
  private calls = 0;
  /** 키 거절·사용량 끝이면 그날은 다시 부르지 않는다 */
  private blocked: { day: string; reason: GeocodeFailReason } | null = null;

  constructor(
    private readonly restKey: string | null,
    private readonly doFetch: typeof fetch = (...a) => fetch(...a),
    private readonly now: () => number = () => Date.now(),
    private readonly dailyCap: number = GEOCODE_DAILY_CAP,
  ) {}

  /** 지금 찾을 수 있나 — 다시 배송 제안을 받을지 정할 때(값 없음) */
  status(): { ready: boolean; reason: GeocodeFailReason | null } {
    if (!this.restKey) return { ready: false, reason: 'NO_KEY' };
    const today = seoulDay(this.now());
    if (this.blocked?.day === today) return { ready: false, reason: this.blocked.reason };
    if (this.day === today && this.calls >= this.dailyCap) return { ready: false, reason: 'DAILY_CAP' };
    return { ready: true, reason: null };
  }

  async geocode(roadAddress: string): Promise<GeocodeResult> {
    if (!this.restKey) return { kind: 'NONE', reason: 'NO_KEY' };
    const today = seoulDay(this.now());
    if (this.day !== today) {
      this.day = today;
      this.calls = 0;
    }
    if (this.blocked?.day === today) return { kind: 'NONE', reason: this.blocked.reason };
    if (this.calls >= this.dailyCap) return { kind: 'NONE', reason: 'DAILY_CAP' };
    this.calls++;
    let res: Response;
    try {
      res = await this.doFetch(`${URL_BASE}?query=${encodeURIComponent(roadAddress)}&analyze_type=similar&size=1`, {
        headers: { Authorization: `KakaoAK ${this.restKey}` },
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      return { kind: 'NONE', reason: 'UNAVAILABLE' };
    }
    if (res.status === 401 || res.status === 403) return this.block(today, 'KEY_REJECTED');
    if (res.status === 429) return this.block(today, 'QUOTA');
    if (!res.ok) return { kind: 'NONE', reason: 'UNAVAILABLE' };
    const body = (await res.json().catch(() => ({}))) as { documents?: { x?: string; y?: string }[] };
    const d = body.documents?.[0];
    const lng = Number(d?.x);
    const lat = Number(d?.y);
    if (!d || !Number.isFinite(lat) || !Number.isFinite(lng)) return { kind: 'NONE', reason: 'NOT_FOUND' };
    if (lat < 32 || lat > 39.5 || lng < 124 || lng > 132) return { kind: 'NONE', reason: 'NOT_FOUND' };
    return { kind: 'FOUND', lat, lng };
  }

  private block(day: string, reason: GeocodeFailReason): GeocodeResult {
    this.blocked = { day, reason };
    console.warn(`[sim-geocode] 카카오 주소 검색 ${reason} — 오늘은 다시 배송을 받지 않음`);
    return { kind: 'NONE', reason };
  }
}

/** 요청 본문에서 도로명 주소 하나 — 문자열·길이만 본다(내용은 로그에 남기지 않음) */
export function parseAddressBody(raw: string): string | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  const a = (v as { address?: unknown } | null)?.address;
  if (typeof a !== 'string') return null;
  const t = a.trim();
  return t.length >= 2 && t.length <= ADDRESS_MAX ? t : null;
}
