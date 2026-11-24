// 실서버 운행 지킴이 — 맥박이 끊기거나 페이지가 떠나면 라이더 OFF_DUTY(진행 중 배송이면 신규배차만 끔)
import { describe, expect, it } from 'vitest';
import { decideLanRequest } from '../../server/lanPolicy';
import { OperationWatch, parseWatchBody, type StateWrite } from '../../server/operationWatch';

function setup(answer: (riderId: string, body: StateWrite) => number | 'ERR' = () => 200) {
  let t = 0;
  const sent: string[] = [];
  const watch = new OperationWatch(
    async (riderId, body) => {
      sent.push(`${riderId} ${body.status}${body.newDispatchEnabled ? '+' : '-'}`);
      return answer(riderId, body);
    },
    150_000,
    () => t,
    () => undefined,
  );
  return { watch, sent, at: (sec: number) => (t = sec * 1000) };
}

describe('운행 지킴이', () => {
  it('맥박이 이어지면 아무것도 안 하고, 150초 넘게 끊기면 OFF_DUTY — 다시 맥박이 오면 stopped', async () => {
    const { watch, sent, at } = setup();
    expect(watch.beat('page-0001', ['RD-sim-01', 'RD-sim-02']).stopped).toBe(false);
    at(140);
    expect(await watch.check()).toEqual([]);
    expect(watch.beat('page-0001', ['RD-sim-01', 'RD-sim-02']).stopped).toBe(false);
    at(140 + 151);
    const r = await watch.check();
    expect(r.map((x) => x.outcome)).toEqual(['OFF', 'OFF']);
    expect(sent).toEqual(['RD-sim-01 OFF_DUTY-', 'RD-sim-02 OFF_DUTY-']);
    expect(watch.beat('page-0001', ['RD-sim-01']).stopped).toBe(true);
    expect(await watch.check()).toEqual([]); // 두 번 하지 않음
  });

  it('진행 중 배송이라 OFF 가 409 면 신규배차만 끔, 그것도 안 되면 FAILED', async () => {
    const { watch, sent } = setup((id, b) => (b.status === 'OFF_DUTY' ? 409 : id === 'RD-sim-02' ? 'ERR' : 200));
    watch.beat('page-0002', ['RD-sim-01', 'RD-sim-02']);
    const r = await watch.end('page-0002');
    expect(r).toEqual([
      { riderId: 'RD-sim-01', outcome: 'NO_DISPATCH', status: 200 },
      { riderId: 'RD-sim-02', outcome: 'FAILED', status: 'ERR' },
    ]);
    expect(sent).toEqual(['RD-sim-01 OFF_DUTY-', 'RD-sim-01 ON_DUTY-', 'RD-sim-02 OFF_DUTY-', 'RD-sim-02 ON_DUTY-']);
  });

  it('정상 운행 종료(release)면 끊겨도 건드리지 않음, 시뮬레이터 라이더가 아니면 싣지 않음', async () => {
    const { watch, sent, at } = setup();
    watch.beat('page-0003', ['RD-sim-01', 'R-real-1', 'RD-sim-99']);
    expect(watch.watching()).toEqual(['RD-sim-01']);
    watch.release('page-0003');
    at(1000);
    expect(await watch.check()).toEqual([]);
    expect(await watch.end('page-0003')).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('같은 라이더를 다른 살아 있는 페이지가 돌리면 옛 페이지가 떠나도 건드리지 않음', async () => {
    const { watch, sent } = setup();
    watch.beat('old-page-1', ['RD-sim-01', 'RD-sim-02']);
    watch.beat('new-page-1', ['RD-sim-01']);
    await watch.end('old-page-1');
    expect(sent).toEqual(['RD-sim-02 OFF_DUTY-']);
  });

  it('본문 검사·이 PC 만', () => {
    expect(parseWatchBody('{"session":"abcd-1234","riders":["RD-sim-01"]}')).toEqual({ session: 'abcd-1234', riders: ['RD-sim-01'] });
    expect(parseWatchBody('{"session":"x"}')).toBeNull();
    expect(parseWatchBody('nope')).toBeNull();
    expect(decideLanRequest('POST', '/sim-operation/end', '192.168.0.77')).toMatchObject({ allow: false, code: 'LOOPBACK_ONLY' });
    expect(decideLanRequest('POST', '/sim-operation/beat', '127.0.0.1')).toMatchObject({ allow: true });
  });
});
