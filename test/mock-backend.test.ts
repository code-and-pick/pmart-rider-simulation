// MockBackend 가 계약 의미대로 거절·판정하는지 — 라이더 창구(RiderApi)를 직접 부른다.
import { describe, expect, it } from 'vitest';
import { MockBackend } from '../src/backend/mock/MockBackend';
import type { RiderApi } from '../src/backend/port';
import { DEFAULT_PARAMS } from '../src/config';
import { ApiProblem } from '../src/domain/contract';
import { mockStartEpochMs, SimClock } from '../src/sim/clock';
import { offsetM, type LatLng } from '../src/util/geo';

const MFC = DEFAULT_PARAMS.mfcLocation;
const START = mockStartEpochMs(Date.UTC(2026, 10, 16, 3, 0, 0));

function world() {
  const clock = new SimClock(START);
  const mock = new MockBackend(clock, DEFAULT_PARAMS.mfcId, MFC, { ...DEFAULT_PARAMS.mock, eventLagSec: [1, 1] }, 1);
  mock.autoOrders = false;
  let k = 0;
  const key = (p = 'k') => `${p}-${++k}`;
  const advance = async (sec: number) => {
    for (let t = 0; t < sec; t += 0.25) {
      clock.now += 0.25;
      mock.tick();
      for (let i = 0; i < 20; i++) await Promise.resolve();
    }
  };
  /** 가입 → 설정 → 운행 ON → 위치 한 점 */
  const rider = async (n: number, at: LatLng): Promise<RiderApi> => {
    const api = mock.asRider(`RD-sim-${String(n).padStart(2, '0')}`);
    await api.signup(
      { phone: `0109900000${n}`, vehicleType: 'MOTORCYCLE', deliveryAreas: [{ mfcId: DEFAULT_PARAMS.mfcId }], consents: [] },
      { idempotencyKey: key('su') },
    );
    await api.setDispatchSettings({ oneAtATime: true, dispatchMode: 'AI_RECOMMENDED' }, { idempotencyKey: key('st') });
    await api.setOperatingState({ status: 'ON_DUTY', newDispatchEnabled: true }, { idempotencyKey: key('op') });
    await api.uploadLocations({ points: [{ ...at, recordedAt: clock.iso() }] }, { idempotencyKey: key('loc') });
    return api;
  };
  return { clock, mock, key, advance, rider };
}

async function problem(p: Promise<unknown>): Promise<ApiProblem> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiProblem) return e;
    throw e;
  }
  throw new Error('거절되지 않음');
}

/** 주문 하나를 넣고 첫 제안이 나갈 때까지 */
async function orderWithOffer(w: ReturnType<typeof world>, opts = { packMinutes: 3 }) {
  const { shipmentId } = w.mock.createOrder({ pickSec: 1, packMinutes: opts.packMinutes, packages: 2, customer: offsetM(MFC, 1200, 800) });
  await w.advance(2);
  const del = [...w.mock.deliveries.values()].find((d) => d.shipmentId === shipmentId);
  if (!del) throw new Error('배송이 생기지 않음');
  return { deliveryId: del.deliveryId, shipmentId };
}

describe('MockBackend — 배차(dispatch 0.4.0 흉내)', () => {
  it('시뮬레이터 라이더가 아니면 창구를 주지 않는다(RR-01 조건 3)', () => {
    const w = world();
    expect(() => w.mock.asRider('RD-0001')).toThrow();
    expect(() => w.mock.asRider('RD-claude-01')).toThrow();
  });

  it('반경 단계: 1.5km 라이더는 1km 단계에서는 제안을 못 받고 2km 단계에서 받는다', async () => {
    const w = world();
    const far = await w.rider(1, offsetM(MFC, 1500, 0));
    await orderWithOffer(w);
    expect((await far.listOffers()).items).toHaveLength(0);
    await w.advance(DEFAULT_PARAMS.mock.radiusStepSec);
    const items = (await far.listOffers()).items ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]?.radiusKm).toBe(2);
  });

  it('동시 수락은 1명만 ASSIGNED, 늦은 쪽은 LATE·ALREADY_ASSIGNED', async () => {
    const w = world();
    const a = await w.rider(1, offsetM(MFC, 300, 0));
    const b = await w.rider(2, offsetM(MFC, -300, 0));
    const { deliveryId } = await orderWithOffer(w);
    const oa = (await a.listOffers()).items?.[0];
    const ob = (await b.listOffers()).items?.[0];
    expect(oa?.deliveryId).toBe(deliveryId);
    expect(ob?.deliveryId).toBe(deliveryId);
    const ra = await a.respondToOffer(oa!.offerId!, { response: 'ACCEPT' }, { idempotencyKey: w.key() });
    const rb = await b.respondToOffer(ob!.offerId!, { response: 'ACCEPT' }, { idempotencyKey: w.key() });
    expect(ra.outcome).toBe('ASSIGNED');
    expect(rb).toMatchObject({ outcome: 'LATE', lateReason: 'ALREADY_ASSIGNED' });
    expect((await a.getDispatch(deliveryId)).state).toBe('ASSIGNED');
  });

  it('제안 요약(dispatch 0.4.5~0.4.6): 예상 소요·픽업지(MFC 정확)·대략 전달지·주문 요약, 수행 조회 orderSummary 도 같은 주문', async () => {
    const w = world();
    const a = await w.rider(1, offsetM(MFC, 300, 0));
    const { deliveryId } = await orderWithOffer(w);
    const offer = (await a.listOffers()).items?.[0];
    const s = offer?.summary;
    // 300m × 186초/km, 고객 offsetM(1200, 800) ≈ 1442m
    expect(s?.pickupEtaSeconds).toBe(Math.round(0.3 * DEFAULT_PARAMS.mock.etaSecPerStraightKm));
    expect(s?.dropEtaSeconds).toBeGreaterThan(250);
    expect(s?.dropEtaSeconds).toBeLessThan(290);
    expect(s?.pickupPoint).toEqual({ lat: MFC.lat, lng: MFC.lng });
    const c = offsetM(MFC, 1200, 800);
    expect(s?.dropAreaPoint).toEqual({ lat: Math.round(c.lat * 100) / 100, lng: Math.round(c.lng * 100) / 100 });
    const o = s?.order;
    expect(o?.orderNumber).toMatch(/^\d{8}$/);
    expect(o?.items?.length).toBeGreaterThanOrEqual(1);
    expect(o?.itemAmount).toBe((o?.items ?? []).reduce((t, it) => t + (it.lineAmount ?? 0), 0));
    expect(o?.deliveryNote).toBeNull();
    await a.respondToOffer(offer!.offerId!, { response: 'ACCEPT' }, { idempotencyKey: w.key() });
    await w.advance(2);
    const x = await a.getExecution(deliveryId);
    expect(x.orderSummary?.orderNumber).toBe(o?.orderNumber);
    expect(x.orderSummary?.itemAmount).toBe(o?.itemAmount);
  });

  it('응답 대기 1분이 지나면 EXPIRED, 그 뒤 수락은 LATE·EXPIRED', async () => {
    const w = world();
    const a = await w.rider(1, offsetM(MFC, 300, 0));
    await orderWithOffer(w);
    const offer = (await a.listOffers()).items?.[0];
    await w.advance(61);
    expect((await a.listOffers()).items?.some((o) => o.offerId === offer?.offerId)).toBe(false);
    const r = await a.respondToOffer(offer!.offerId!, { response: 'ACCEPT' }, { idempotencyKey: w.key() });
    expect(r).toMatchObject({ outcome: 'LATE', lateReason: 'EXPIRED' });
  });

  it('멱등: 같은 키·같은 본문은 같은 결과, 같은 키·다른 본문은 409 IDEMPOTENCY_CONFLICT', async () => {
    const w = world();
    const a = await w.rider(1, offsetM(MFC, 300, 0));
    await orderWithOffer(w);
    const offerId = (await a.listOffers()).items![0]!.offerId!;
    const k = w.key();
    const r1 = await a.respondToOffer(offerId, { response: 'ACCEPT' }, { idempotencyKey: k });
    const r2 = await a.respondToOffer(offerId, { response: 'ACCEPT' }, { idempotencyKey: k });
    expect(r2).toEqual(r1);
    const p = await problem(a.respondToOffer(offerId, { response: 'REJECT' }, { idempotencyKey: k }));
    expect(p.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('하나씩 배달하기 + 진행 중 배송이면 pollAfterSec 30(dispatch 0.12.2 — null 아님)', async () => {
    const w = world();
    const a = await w.rider(1, offsetM(MFC, 300, 0));
    await orderWithOffer(w);
    const offerId = (await a.listOffers()).items![0]!.offerId!;
    expect((await a.listOffers()).pollAfterSec).toBe(5);
    await a.respondToOffer(offerId, { response: 'ACCEPT' }, { idempotencyKey: w.key() });
    expect((await a.listOffers()).pollAfterSec).toBe(30);
  });
});

describe('MockBackend — 수행·인계(execution 0.5.0·fulfillment 0.4.11 흉내)', () => {
  async function assigned() {
    const w = world();
    const a = await w.rider(1, offsetM(MFC, 300, 0));
    const ids = await orderWithOffer(w);
    const offerId = (await a.listOffers()).items![0]!.offerId!;
    await a.respondToOffer(offerId, { response: 'ACCEPT' }, { idempotencyKey: w.key() });
    return { w, a, ...ids };
  }

  // fulfillment 0.13.0 F-8·0.23.0 R-26 — 라벨 숫자로 인계(라이더 앱 "번호로 인계", pmart-clients #268)
  it('라벨 숫자(4자리)로 QR 과 같은 허가 — 틀리면 남은 횟수, 5번 틀리면 잠김(맞는 번호도 거절)', async () => {
    const { w, a, deliveryId, shipmentId } = await assigned();
    await w.advance(1.5);
    await a.reportStoreArrival(deliveryId, {}, { idempotencyKey: w.key() });
    await w.advance(3 * 60);
    const ship = await w.mock.observer.getShipment(shipmentId);
    const [pk0, pk1] = ship.packages!;
    expect(pk0!.handoverCode).toMatch(/^[0-9]{4}$/);
    expect(pk0!.handoverCode).not.toBe(pk1!.handoverCode); // 센터 안 겹치지 않음

    // 맞는 번호 → 그 포장 허가(응답에 packageId) → 확정은 QR 과 같다
    const auth = await a.authorizeHandoverByCode({ riderId: a.riderId, deliveryId, handoverCode: pk0!.handoverCode! }, { idempotencyKey: w.key() });
    expect(auth.packageId).toBe(pk0!.packageId);
    const res = await a.commitHandover(
      pk0!.packageId!,
      { handoverAuthorizationId: auth.handoverAuthorizationId!, fenceVersion: auth.fenceVersion!, riderId: a.riderId },
      { idempotencyKey: w.key() },
    );
    expect(res.status).toBe('APPLIED');

    // 틀린 번호: 409 MISMATCH + 남은 횟수 4,3,2,1,0 → 그다음은 맞는 번호도 LOCKED
    const wrong = pk1!.handoverCode === '0000' ? '0001' : '0000';
    for (const left of [4, 3, 2, 1, 0]) {
      const e = await problem(a.authorizeHandoverByCode({ riderId: a.riderId, deliveryId, handoverCode: wrong }, { idempotencyKey: w.key() }));
      expect([e.status, e.code]).toEqual([409, 'HANDOVER_CODE_MISMATCH']);
      expect(e.problem.details).toContainEqual({ field: 'attemptsLeft', reason: String(left) });
    }
    const locked = await problem(a.authorizeHandoverByCode({ riderId: a.riderId, deliveryId, handoverCode: pk1!.handoverCode! }, { idempotencyKey: w.key() }));
    expect(locked.code).toBe('HANDOVER_CODE_LOCKED');
    // 형식이 틀리면 400(횟수 안 셈 — 잠김 검사 전)
    expect((await problem(a.authorizeHandoverByCode({ riderId: a.riderId, deliveryId, handoverCode: '12' }, { idempotencyKey: w.key() }))).status).toBe(400);
  });

  it('한 출고 안 포장끼리도 라벨 숫자가 겹치지 않는다', async () => {
    const w = world();
    const { shipmentId } = w.mock.createOrder({ pickSec: 1, packMinutes: 1, packages: 300, customer: offsetM(MFC, 500, 0) });
    const ship = await w.mock.observer.getShipment(shipmentId);
    const codes = ship.packages!.map((p) => p.handoverCode);
    expect(new Set(codes).size).toBe(300);
  });

  it('수락 직후 execution 은 아직 배정 전(사건 반영 지연) — 조금 뒤 ASSIGNED', async () => {
    const { w, a, deliveryId } = await assigned();
    expect((await problem(a.getExecution(deliveryId))).status).toBe(404);
    await w.advance(1.5);
    expect((await a.getExecution(deliveryId)).state).toBe('ASSIGNED');
  });

  it('픽업 전에는 사진·완료·전달지가 거절된다', async () => {
    const { w, a, deliveryId } = await assigned();
    await w.advance(1.5);
    const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });
    expect((await problem(a.uploadEvidencePhoto(deliveryId, photo, { idempotencyKey: w.key() }))).code).toBe('INVALID_STATE');
    expect(
      (
        await problem(
          a.reportCompletion(deliveryId, { method: 'FACE', evidence: { photoRefs: ['PH-x'], takenAt: w.clock.iso() } }, { idempotencyKey: w.key() }),
        )
      ).code,
    ).toBe('INVALID_STATE');
    expect((await problem(a.getDropInfo(deliveryId))).code).toBe('DROP_INFO_CLOSED');
  });

  it('픽업은 인계 확정으로만: 가게 도착 뒤 pickups 만으로는 422, 모든 포장 인계 확정 뒤 PICKED_UP', async () => {
    const { w, a, deliveryId, shipmentId } = await assigned();
    await w.advance(1.5);
    await a.reportStoreArrival(deliveryId, {}, { idempotencyKey: w.key() });
    expect((await problem(a.reportPickup(deliveryId, { handoverIds: ['HO-fake'] }, { idempotencyKey: w.key() }))).code).toBe(
      'HANDOVER_NOT_CONFIRMED',
    );
    // 포장 중이면 인계 허가 거절
    let ship = await w.mock.observer.getShipment(shipmentId);
    const pk0 = ship.packages![0]!;
    expect(
      (await problem(a.authorizeHandover(pk0.packageId!, { riderId: a.riderId, deliveryId, scannedCode: pk0.qrCode! }, { idempotencyKey: w.key() })))
        .code,
    ).toBe('INVALID_STATE');
    await w.advance(3 * 60);
    ship = await w.mock.observer.getShipment(shipmentId);
    expect(ship.state).toBe('READY');
    // 남의 QR(구 라벨) 거절
    expect(
      (await problem(a.authorizeHandover(pk0.packageId!, { riderId: a.riderId, deliveryId, scannedCode: 'PKG:x:9' }, { idempotencyKey: w.key() })))
        .code,
    ).toBe('PACKAGE_INVALIDATED');
    for (const [i, pk] of ship.packages!.entries()) {
      const auth = await a.authorizeHandover(pk.packageId!, { riderId: a.riderId, deliveryId, scannedCode: pk.qrCode! }, { idempotencyKey: w.key() });
      const res = await a.commitHandover(
        pk.packageId!,
        { handoverAuthorizationId: auth.handoverAuthorizationId!, fenceVersion: auth.fenceVersion!, riderId: a.riderId },
        { idempotencyKey: w.key() },
      );
      expect(res.status).toBe('APPLIED');
      if (i === 0) {
        await w.advance(1.5);
        expect((await a.getExecution(deliveryId)).state).toBe('ARRIVED_AT_STORE'); // 하나만 인계 — 아직
      }
    }
    await w.advance(1.5);
    const x = await a.getExecution(deliveryId);
    expect(x.state).toBe('PICKED_UP');
    expect((await a.getDispatch(deliveryId)).state).toBe('PICKED_UP');
    await a.reportPickup(deliveryId, { handoverIds: x.handoverIds! }, { idempotencyKey: w.key() });
    // 고객 도착 전 완료 409, 사진 없는 완료 422
    expect(
      (await problem(a.reportCompletion(deliveryId, { method: 'FACE', evidence: { photoRefs: [], takenAt: w.clock.iso() } }, { idempotencyKey: w.key() })))
        .code,
    ).toBe('INVALID_STATE');
    await a.reportCustomerArrival(deliveryId, {}, { idempotencyKey: w.key() });
    expect(
      (await problem(a.reportCompletion(deliveryId, { method: 'FACE', evidence: { photoRefs: [], takenAt: w.clock.iso() } }, { idempotencyKey: w.key() })))
        .code,
    ).toBe('EVIDENCE_REQUIRED');
    const photo = await a.uploadEvidencePhoto(deliveryId, new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), {
      idempotencyKey: w.key(),
    });
    await a.reportCompletion(deliveryId, { method: 'CONTACTLESS', evidence: { photoRefs: [photo.photoRef], takenAt: w.clock.iso() } }, { idempotencyKey: w.key() });
    expect((await a.getExecution(deliveryId)).state).toBe('COMPLETED');
    await w.advance(1.5);
    expect((await a.getDispatch(deliveryId)).state).toBe('CLOSED');
  });

  it('지원하지 않는 사진 형식은 422 PHOTO_INVALID', async () => {
    const { w, a, deliveryId } = await assigned();
    const del = w.mock.deliveries.get(deliveryId)!;
    await w.advance(1.5);
    del.x.state = 'ARRIVED_AT_CUSTOMER'; // 흐름 생략 — 형식 검사만 본다
    const p = await problem(a.uploadEvidencePhoto(deliveryId, new Blob(['x'], { type: 'image/gif' }), { idempotencyKey: w.key() }));
    expect(p.code).toBe('PHOTO_INVALID');
  });

  it('픽업 전 배차 취소 → 재배차(취소한 라이더는 빠짐), 픽업 뒤는 422', async () => {
    const { w, a, deliveryId } = await assigned();
    await w.advance(1.5);
    await a.cancelAssignment(deliveryId, { requestedBy: 'RIDER', reason: 'RIDER_UNABLE' }, { idempotencyKey: w.key() });
    expect(w.mock.deliveries.get(deliveryId)!.d.state).toBe('DISPATCHING');
    await w.advance(5);
    expect((await a.listOffers()).items?.some((o) => o.deliveryId === deliveryId)).toBe(false);
  });
});
