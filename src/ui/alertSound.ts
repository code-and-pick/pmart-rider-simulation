// 새 이상 상황 알림음(바로고 허브컨트롤룸 "알림음"·Urbantz 알림 종처럼) — 브라우저 Web Audio 로 짧은 소리. 외부 파일 없음.
// 켬·끔은 이 브라우저 localStorage(편의용 — 못 읽으면 끔). 브라우저는 사람이 누른 뒤에만 소리를 낸다(켜는 버튼이 그 누름).

import { useEffect, useRef, useState } from 'react';
import type { OpsAlert } from './ops';

const KEY = 'rider-sim.alert-sound';

let ctx: AudioContext | null = null;

/** 짧은 두 번 소리 — 심각이면 높게 */
export function beep(level: 'bad' | 'warn') {
  try {
    ctx ??= new AudioContext();
    const f = level === 'bad' ? 988 : 740;
    for (const [i, at] of [0, 0.18].entries()) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f + i * 120;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.14);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + 0.15);
    }
  } catch {
    /* 소리를 못 내도 화면 알림은 그대로 */
  }
}

/** 알림음 켬·끔 + 새로 생긴 알림이면 소리(처음 그릴 때 이미 있던 알림은 울리지 않는다) */
export function useAlertSound(alerts: readonly OpsAlert[]): [boolean, () => void] {
  const [on, setOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const keys = new Set(alerts.map((a) => a.key));
    if (seen.current && on) {
      const fresh = alerts.filter((a) => !seen.current?.has(a.key));
      if (fresh.length) beep(fresh.some((a) => a.level === 'bad') ? 'bad' : 'warn');
    }
    seen.current = keys;
  }, [alerts, on]);
  const toggle = () =>
    setOn((v) => {
      try {
        localStorage.setItem(KEY, v ? '0' : '1');
      } catch {
        /* 저장 못 해도 이번 화면에선 바뀐다 */
      }
      if (!v) beep('warn'); // 켤 때 한 번 — 소리가 나는지 바로 안다
      return !v;
    });
  return [on, toggle];
}
