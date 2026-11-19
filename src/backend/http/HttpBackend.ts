// 실서버 어댑터: 개발 서버 /api 프록시 → 게이트웨이 /api/v1 → 계약 API. 계약에 있는 경로만 부른다(추측 금지).
//
// 토큰은 브라우저가 갖지 않는다 — 라이더 호출은 `X-Sim-Rider`, 관찰 조회는 `X-Sim-Actor: observer` 만 보내면
// 개발 서버(server/devServer.ts)가 토큰을 붙인다(docs/design.md §6-4·§6-5).
// 응답 규칙(CLAUDE.md): 응답이 없거나(네트워크·시간 초과) 쓰기에 5xx 면 ResultUnknown — 실패로 단정하지 않고 같은 키로 다시 보낸다.
// 4xx 는 ApiProblem(서버가 확정한 거절). 로그에는 행위자·경로·상태 코드만(RR-01 조건 6) — 본문(전달지 등)은 남기지 않는다.

import { isSimRiderId } from '../../config';
import {
  ApiProblem,
  ResultUnknown,
  type Center,
  type CommandResponse,
  type ControlRiderList,
  type StaffDropLocation,
  type Delivery,
  type DeliveryExecution,
  type DeliveryListResponse,
  type DispatchSettings,
  type DropInfo,
  type EvidencePhoto,
  type HandoverAuthorization,
  type HandoverCommitResult,
  type HandoverResolution,
  type HelpRequest,
  type MyDeliveriesResponse,
  type Offer,
  type OfferListResponse,
  type OfferResponseResult,
  type OperatingState,
  type PickupPointList,
  type Problem,
  type RiderLocation,
  type RiderProfile,
  type Shipment,
  type StaffDeliveryListResponse,
  type StaffOrderDetail,
  type StaffPiiReveal,
  type StaffPiiRevealRequest,
  type Withdrawal,
} from '../../domain/contract';
import type {
  ApiCallRecord,
  ApiListener,
  EventListener,
  ObserverApi,
  RiderApi,
  RiderPort,
  WriteOptions,
} from '../port';

type Method = ApiCallRecord['method'];
/** control = 관제 계정(RR-08) — 개발 서버가 이 PC 의 GET /rider-locations 에만 토큰을 붙인다 */
type Actor = { rider: string } | 'observer' | 'control';

interface ReqOpts {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  form?: FormData;
  write?: WriteOptions;
}

export interface HttpBackendOptions {
  apiBase: string;
  sourceSystem: string;
  /** API 로그 시각(시뮬 초) */
  now: () => number;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const enc = encodeURIComponent;

export class HttpBackend implements RiderPort {
  readonly mode = 'http' as const;
  readonly observer: ObserverApi;
  private readonly apiListeners = new Set<ApiListener>();
  private readonly riderApis = new Map<string, RiderApi>();
  private readonly doFetch: typeof fetch;

  constructor(private readonly o: HttpBackendOptions) {
    this.doFetch = o.fetch ?? ((...a) => fetch(...a));
    this.observer = this.makeObserver();
  }

  /** execution 0.24.0 직원용 전달지(주소·좌표, 열람 기록) — 관제 계정, 이 PC 만. 응답은 화면 메모리에만(로그에는 경로·상태만) */
  getStaffDropLocation(deliveryId: string): Promise<StaffDropLocation> {
    return this.request<StaffDropLocation>('control', 'GET', `/deliveries/${enc(deliveryId)}/drop-location`);
  }

  /** order 0.13.1 직원용 주문 상세(품목·금액·결제 — 배송지·요청사항은 가린 값, 조회는 기록 안 함) — 관제 계정, 이 PC 만 */
  getStaffOrder(orderId: string): Promise<StaffOrderDetail> {
    return this.request<StaffOrderDetail>('control', 'GET', `/orders/lookups/${enc(orderId)}`);
  }

  /**
   * order 0.13.1 원문 열람 — 사유 필수, audit 열람 기록이 남은 뒤에만 원문(못 남기면 503 → 결과 불명, 같은 키로 다시).
   * 사용자 2026-11-19 "여기서 다 열람할 수 있게 해". 응답은 화면 메모리에만 — API 기록에는 경로·상태만(본문 없음).
   */
  revealOrderPii(orderId: string, body: StaffPiiRevealRequest, w: WriteOptions): Promise<StaffPiiReveal> {
    return this.request<StaffPiiReveal>('control', 'POST', `/orders/lookups/${enc(orderId)}/pii-reveals`, { body, write: w });
  }

  /** tracking 0.8.0 라이더 관제 — 운행 중 라이더(라이더 앱 포함)의 현재 위치. RIDER_OPS·OPERATOR_ADMIN 만(관제 계정, 이 PC 만) */
  listRiderLocations(mfcId: string): Promise<ControlRiderList> {
    return this.request<ControlRiderList>('control', 'GET', '/rider-locations', { query: { mfcId } });
  }

  asRider(riderId: string): RiderApi {
    if (!isSimRiderId(riderId)) throw new Error(`시뮬레이터 라이더 ID 가 아님: ${riderId}`);
    let api = this.riderApis.get(riderId);
    if (!api) {
      api = this.makeRiderApi(riderId);
      this.riderApis.set(riderId, api);
    }
    return api;
  }

  onApiCall(listener: ApiListener): () => void {
    this.apiListeners.add(listener);
    return () => this.apiListeners.delete(listener);
  }

  /** 실서버는 사건을 구독하지 못한다 — 조회로 본다. 등록만 받는다. */
  onEvent(_listener: EventListener): () => void {
    return () => undefined;
  }

  private log(actor: Actor, method: Method, path: string, status: number | 'ERR', ms: number, code?: string) {
    const rec: ApiCallRecord = {
      at: this.o.now(),
      actor: typeof actor === 'string' ? actor : actor.rider,
      method,
      path,
      status,
      code,
      ms: Math.round(ms),
    };
    for (const l of this.apiListeners) l(rec);
  }

  /** 요청 하나. ok 상태(2xx)면 본문 JSON(없으면 {}). */
  async request<T>(actor: Actor, method: Method, path: string, opts: ReqOpts = {}): Promise<T> {
    const qs = opts.query
      ? Object.entries(opts.query)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => `${enc(k)}=${enc(String(v))}`)
          .join('&')
      : '';
    const logPath = qs ? `${path}?${qs}` : path;
    const headers: Record<string, string> = { Accept: 'application/json, application/problem+json' };
    if (typeof actor === 'string') headers['X-Sim-Actor'] = actor;
    else headers['X-Sim-Rider'] = actor.rider;
    if (opts.write) {
      headers['Idempotency-Key'] = opts.write.idempotencyKey;
      headers['X-Source-System'] = this.o.sourceSystem;
      if (opts.write.expectedVersion !== undefined) headers['X-Expected-Version'] = String(opts.write.expectedVersion);
    }
    let body: BodyInit | undefined;
    if (opts.form) body = opts.form;
    else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    const t0 = performance.now();
    let res: Response;
    try {
      res = await this.doFetch(`${this.o.apiBase}${logPath}`, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 15_000),
      });
    } catch (e) {
      this.log(actor, method, logPath, 'ERR', performance.now() - t0, e instanceof Error ? e.name : undefined);
      throw new ResultUnknown(`응답 없음: ${method} ${path}`);
    }
    const text = await res.text().catch(() => '');
    let json: unknown = {};
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = {};
      }
    }
    const problem = json as Partial<Problem>;
    this.log(actor, method, logPath, res.status, performance.now() - t0, res.ok ? undefined : problem.code);
    if (res.ok) return json as T;
    if (res.status >= 500 && method !== 'GET') throw new ResultUnknown(`결과 불명: ${method} ${path} → ${res.status} ${problem.code ?? ''}`.trim());
    throw new ApiProblem(res.status, { ...problem, status: res.status });
  }

  private makeRiderApi(riderId: string): RiderApi {
    const me: Actor = { rider: riderId };
    const r = <T>(method: Method, path: string, opts?: ReqOpts) => this.request<T>(me, method, path, opts);
    return {
      riderId,
      // rider-service 0.4.0
      getMe: () => r<RiderProfile>('GET', '/riders/me'),
      signup: (body, w) => r<RiderProfile>('POST', '/riders/signups', { body, write: w }),
      getOperatingState: () => r<OperatingState>('GET', '/riders/me/state'),
      setOperatingState: (body, w) => r<OperatingState>('PUT', '/riders/me/state', { body, write: w }),
      getDispatchSettings: () => r<DispatchSettings>('GET', '/riders/me/settings'),
      setDispatchSettings: (body, w) => r<DispatchSettings>('PUT', '/riders/me/settings', { body, write: w }),
      withdraw: (body, w) => r<CommandResponse>('POST', '/riders/me/withdrawals', { body, write: w }),
      getWithdrawal: (id) => r<Withdrawal>('GET', `/riders/me/withdrawals/${enc(id)}`),
      // delivery-tracking 0.4.0
      uploadLocations: (body, w) => r<CommandResponse>('POST', '/riders/me/locations', { body, write: w }),
      getLatestLocation: () => r<RiderLocation>('GET', '/riders/me/locations/latest'),
      // delivery-dispatch 0.4.0
      listOffers: (q) => r<OfferListResponse>('GET', '/offers', { query: { state: q?.state, size: q?.size, cursor: q?.cursor } }),
      getOffer: (id) => r<Offer>('GET', `/offers/${enc(id)}`),
      respondToOffer: (id, body, w) => r<OfferResponseResult>('POST', `/offers/${enc(id)}/responses`, { body, write: w }),
      listDeliveryList: () => r<DeliveryListResponse>('GET', '/delivery-list'),
      acceptFromDeliveryList: (id, w) => r<OfferResponseResult>('POST', `/delivery-list/${enc(id)}/acceptances`, { write: w }),
      getDispatch: (id) => r<Delivery>('GET', `/deliveries/${enc(id)}/dispatch`),
      cancelAssignment: (id, body, w) => r<CommandResponse>('POST', `/deliveries/${enc(id)}/assignment-cancellations`, { body, write: w }),
      // delivery-execution 0.5.0
      getExecution: (id) => r<DeliveryExecution>('GET', `/deliveries/${enc(id)}`),
      listMyDeliveries: (q) =>
        r<MyDeliveriesResponse>('GET', '/riders/me/deliveries', { query: { date: q?.date, state: q?.state, size: q?.size, cursor: q?.cursor } }),
      reportStoreArrival: (id, body, w) => r<CommandResponse>('POST', `/deliveries/${enc(id)}/store-arrivals`, { body, write: w }),
      reportPickup: (id, body, w) => r<CommandResponse>('POST', `/deliveries/${enc(id)}/pickups`, { body, write: w }),
      getDropInfo: (id) => r<DropInfo>('GET', `/deliveries/${enc(id)}/drop-info`),
      reportCustomerArrival: (id, body, w) => r<CommandResponse>('POST', `/deliveries/${enc(id)}/customer-arrivals`, { body, write: w }),
      uploadEvidencePhoto: (id, file, w) => {
        const form = new FormData();
        form.append('file', file, file.type === 'image/png' ? 'evidence.png' : file.type === 'image/webp' ? 'evidence.webp' : 'evidence.jpg');
        return r<EvidencePhoto>('POST', `/deliveries/${enc(id)}/evidence-photos`, { form, write: w });
      },
      reportCompletion: (id, body, w) => r<CommandResponse>('POST', `/deliveries/${enc(id)}/completions`, { body, write: w }),
      reportFailure: (id, body, w) => r<CommandResponse>('POST', `/deliveries/${enc(id)}/failures`, { body, write: w }),
      createHelpRequest: (id, body, w) => r<CommandResponse>('POST', `/deliveries/${enc(id)}/help-requests`, { body, write: w }),
      getHelpRequest: (id, reqId) => r<HelpRequest>('GET', `/deliveries/${enc(id)}/help-requests/${enc(reqId)}`),
      reportReturnPickup: (id, body, w) => r<CommandResponse>('POST', `/deliveries/${enc(id)}/returns/pickups`, { body, write: w }),
      reportReturnStoreDelivery: (id, body, w) =>
        r<CommandResponse>('POST', `/deliveries/${enc(id)}/returns/store-deliveries`, { body, write: w }),
      // center-master 0.2.0
      listMfcPickupPoints: () => r<PickupPointList>('GET', '/mfc-pickup-points'),
      // mfc-fulfillment 0.4.11 인계
      authorizeHandover: (pkg, body, w) => r<HandoverAuthorization>('POST', `/packages/${enc(pkg)}/handover-authorizations`, { body, write: w }),
      commitHandover: (pkg, body, w) => r<HandoverCommitResult>('POST', `/packages/${enc(pkg)}/handover-commits`, { body, write: w }),
      getHandoverResolution: (pkg) => r<HandoverResolution>('GET', `/packages/${enc(pkg)}/handover-resolution`),
    };
  }

  private makeObserver(): ObserverApi {
    const r = <T>(path: string, opts?: ReqOpts) => this.request<T>('observer', 'GET', path, opts);
    return {
      searchDeliveries: (q) =>
        r<StaffDeliveryListResponse>('/deliveries', {
          query: { mfcId: q.mfcId, orderId: q.orderId, riderId: q.riderId, state: q.state, sort: q.sort, size: q.size, cursor: q.cursor },
        }),
      getExecution: (id) => r<DeliveryExecution>(`/deliveries/${enc(id)}`),
      getDispatch: (id) => r<Delivery>(`/deliveries/${enc(id)}/dispatch`),
      getShipment: (id) => r<Shipment>(`/shipments/${enc(id)}`),
      getCenter: (id) => r<Center>(`/centers/${enc(id)}`),
    };
  }
}
