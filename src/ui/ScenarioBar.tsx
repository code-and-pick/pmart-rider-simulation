import { useApp } from '../app/App';
import { DEFAULT_PARAMS } from '../config';
import type { ScenarioKnobs } from '../sim/world';

/** 정상 = 설정 기본값. 묶음은 정상에서 몇 개만 바꾼 것 [시뮬] */
const NORMAL: ScenarioKnobs = {
  ordersPerHour: DEFAULT_PARAMS.mock.ordersPerHour,
  acceptProbability: DEFAULT_PARAMS.acceptProbability,
  packTimeScale: DEFAULT_PARAMS.mock.packTimeScale,
  customerAbsentRate: DEFAULT_PARAMS.customerAbsentRate,
  networkDropRate: DEFAULT_PARAMS.mock.networkDropRate,
  riderCancelRate: DEFAULT_PARAMS.riderCancelRate,
  locationOutageRate: DEFAULT_PARAMS.locationOutageRate,
  misdeliveryRate: DEFAULT_PARAMS.mock.misdeliveryRate,
};

const PRESETS: { label: string; hint: string; knobs: Partial<ScenarioKnobs> }[] = [
  { label: '정상', hint: '기본값으로', knobs: {} },
  { label: '바쁜 시간', hint: '주문 시간당 60건 — 라이더가 모자라 "라이더 찾는 중"이 쌓이고 배차 실패가 날 수 있다', knobs: { ordersPerHour: 60 } },
  { label: '라이더 부족·거절', hint: '수락률 30% — 거절·무응답으로 반경이 넓어지고 배차 실패', knobs: { ordersPerHour: 20, acceptProbability: 0.3 } },
  { label: '포장 지연', hint: '포장 시간 3배 — 라이더가 가게에서 오래 기다리고, 10분 넘으면 도움요청(STORE_WAITING)', knobs: { packTimeScale: 3 } },
  { label: '고객 부재 많음', hint: '고객 부재 40% — 연락 2번·사진 → 전달 실패 등록 → 확정 → 상품 들고 복귀', knobs: { customerAbsentRate: 0.4 } },
  { label: '네트워크 불안', hint: '쓰기 응답 25% 끊김 — 같은 키로 다시 보내 중복 없이 이어지는지', knobs: { networkDropRate: 0.25 } },
  { label: '라이더 취소', hint: '수락한 라이더 30%가 가게 가는 길에 배정 취소 — 그 라이더를 빼고 다른 라이더에게 재배차', knobs: { riderCancelRate: 0.3 } },
  { label: '위치 끊김', hint: '고객에게 가는 라이더 50%가 4분 동안 위치를 못 올림 — 3분 지나면 위치 끊김 사건(배송 상태는 그대로)', knobs: { locationOutageRate: 0.5 } },
  {
    label: '오배송',
    hint: '전달 완료 30%가 5분 뒤 오배송으로 확인 — 반은 MFC 회수 + 재발송, 반은 고객 잘못 다시 배송(200m 미만 원래 기사 먼저 0원, 이상 결제 대기)',
    knobs: { misdeliveryRate: 0.3 },
  },
];

interface Slider {
  key: keyof ScenarioKnobs;
  label: string;
  min: number;
  max: number;
  step: number;
  /** 화면 표시 */
  show: (v: number) => string;
  hint: string;
}

const SLIDERS: Slider[] = [
  { key: 'ordersPerHour', label: '주문량', min: 0, max: 60, step: 1, show: (v) => `시간당 ${v}건`, hint: '시간당 주문 수 — 많으면 라이더가 모자란다' },
  { key: 'acceptProbability', label: '라이더 수락률', min: 0, max: 1, step: 0.05, show: (v) => `${Math.round(v * 100)}%`, hint: '제안을 받은 라이더가 수락할 확률 — 나머지 반은 거절, 반은 무응답(1분 뒤 만료)' },
  { key: 'packTimeScale', label: '포장 시간', min: 0.5, max: 5, step: 0.5, show: (v) => `×${v}`, hint: 'MFC 포장 시간 배율 — 크면 라이더가 가게에서 기다린다' },
  { key: 'customerAbsentRate', label: '고객 부재', min: 0, max: 1, step: 0.05, show: (v) => `${Math.round(v * 100)}%`, hint: '고객 도착 뒤 부재일 확률 — 연락 2번·사진 → 전달 실패 등록(운영자 확정은 MOCK 이 1분 뒤 대신)' },
  { key: 'riderCancelRate', label: '라이더 취소', min: 0, max: 1, step: 0.05, show: (v) => `${Math.round(v * 100)}%`, hint: '수락한 라이더가 가게 가는 길에 배정을 취소할 확률(픽업 전, RIDER_UNABLE) — 취소한 라이더를 빼고 재배차' },
  { key: 'locationOutageRate', label: '위치 끊김', min: 0, max: 1, step: 0.05, show: (v) => `${Math.round(v * 100)}%`, hint: '고객에게 가는 중 위치 전송이 4분 멈출 확률 — 3분 지나면 tracking 이 위치 끊김(RiderLocationStale)을 낸다. 배송 상태는 바뀌지 않는다' },
  { key: 'misdeliveryRate', label: '오배송', min: 0, max: 1, step: 0.05, show: (v) => `${Math.round(v * 100)}%`, hint: '전달 완료가 5분 뒤 오배송으로 확인될 확률(MOCK 이 상담원 대신) — 라이더·시스템 잘못이면 회수 + 재발송, 고객 잘못이면 다시 배송' },
  { key: 'networkDropRate', label: '응답 끊김', min: 0, max: 0.5, step: 0.05, show: (v) => `${Math.round(v * 100)}%`, hint: '쓰기 요청 응답이 사라질 확률 — 절반은 처리 전, 절반은 처리 뒤 끊김. 라이더는 같은 키로 다시 보낸다' },
];

/** MOCK 시나리오 조절 바 — 실패를 보려고 값을 바꾼다. 바로 반영. 실서버에서는 쓰지 않는다. */
export function ScenarioBar() {
  const app = useApp();
  const k = app.sim.getKnobs();
  const isNormal = (Object.keys(NORMAL) as (keyof ScenarioKnobs)[]).every((x) => Math.abs(k[x] - NORMAL[x]) < 1e-9);
  return (
    <section className="scenario" aria-label="시나리오 조절">
      <div className="sc-presets">
        <span className="sc-title">시나리오 [시뮬]</span>
        {PRESETS.map((p) => (
          <button key={p.label} className="sc-preset" title={p.hint} onClick={() => app.setKnobs({ ...NORMAL, ...p.knobs })}>
            {p.label}
          </button>
        ))}
        {!isNormal && <span className="sc-changed">기본값과 다름</span>}
      </div>
      <div className="sc-sliders">
        {SLIDERS.map((s) => (
          <label key={s.key} className="sc-slider" title={s.hint}>
            <span className="sc-label">
              {s.label} <b>{s.show(k[s.key])}</b>
            </span>
            <input
              type="range"
              min={s.min}
              max={s.max}
              step={s.step}
              value={k[s.key]}
              onChange={(e) => app.setKnobs({ [s.key]: Number(e.target.value) })}
            />
          </label>
        ))}
      </div>
    </section>
  );
}
