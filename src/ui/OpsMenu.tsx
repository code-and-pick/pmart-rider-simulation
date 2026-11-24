import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app/App';
import { OPS_SCREENS, opsBase, opsUrl } from './opsLinks';

/**
 * 머리줄 "라이더 백오피스 ▾" — 백오피스 메뉴로 바로 이동(새 탭, 가상 현장 지도는 그대로 돈다).
 * 예전엔 운영 현황 아래 접힌 "운영 화면" 목록에 모아 뒀다 → 사용자 2026-11-24 "모아두지 말고 상단바에 이동 버튼".
 */
export function OpsMenu() {
  const { sim } = useApp();
  const mode = sim.mode === 'http' ? 'http' : 'mock';
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="c-ops" ref={box}>
      <button
        className={`c-btn ${open ? 'on' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={mode === 'http' ? `LAN 라이더 백오피스(${opsBase(mode)}) — 직원 로그인` : `라이더 백오피스 목 모드(${opsBase(mode)}) — pmart-clients 에서 먼저 켜야 열림`}
      >
        라이더 백오피스 ▾
      </button>
      {open && (
        <ul className="c-ops-menu" role="menu">
          {OPS_SCREENS.map((s) => {
            const url = opsUrl(mode, s);
            return (
              <li key={s.key} role="none">
                {url ? (
                  <a role="menuitem" href={url} target="_blank" rel="noopener noreferrer" title={s.what} onClick={() => setOpen(false)}>
                    {s.title} <span aria-hidden>↗</span>
                  </a>
                ) : (
                  <span className="off">{s.title} · 준비 중</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
