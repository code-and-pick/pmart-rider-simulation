import { useState } from 'react';

/**
 * 표 위 [찾기 칸][깔때기 → 상태 고르기 팝업][고른 상태 ✕] — 왼쪽에 모아서(사용자 2026-11-20 "검색창도 왼쪽 … 필터는 그 옆에 깔때기 … 팝업창에서 선택").
 * 운영 현황의 라이더 표·최근 배송 표가 같이 쓴다. 건수 0 인 선택지는 흐리게 못 누름(지금 고른 것·전체는 예외).
 */
export function SearchFilterBar<K extends string>({
  query,
  onQuery,
  placeholder,
  searchLabel,
  value,
  onValue,
  options,
  allKey,
  warnKeys = [],
}: {
  query: string;
  onQuery: (q: string) => void;
  placeholder: string;
  searchLabel: string;
  value: K;
  onValue: (k: K) => void;
  /** [키, 이름, 건수] */
  options: readonly (readonly [K, string, number])[];
  allKey: K;
  warnKeys?: readonly K[];
}) {
  const [open, setOpen] = useState(false);
  const cur = options.find(([k]) => k === value);
  return (
    <div className="c-recent-bar">
      <input className="c-recent-q" type="search" value={query} onChange={(e) => onQuery(e.target.value)} placeholder={placeholder} aria-label={searchLabel} />
      <div className="c-recent-fwrap">
        <button
          className={`c-recent-funnel ${value !== allKey ? 'on' : ''}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label="상태로 거르기"
          title="상태로 거르기"
          onClick={() => setOpen(!open)}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M1.5 2.5h13l-5 6v5l-3-1.5v-3.5z" fill="currentColor" />
          </svg>
        </button>
        {open && (
          <>
            <div className="c-pop-back" onClick={() => setOpen(false)} />
            <ul className="c-pop" role="listbox" aria-label="상태">
              {options.map(([k, l, n]) => (
                <li key={k}>
                  <button
                    role="option"
                    aria-selected={value === k}
                    className={`${value === k ? 'on' : ''} ${warnKeys.includes(k) && n ? 'warn' : ''}`}
                    disabled={k !== allKey && k !== value && n === 0}
                    onClick={() => {
                      onValue(k);
                      setOpen(false);
                    }}
                  >
                    <span className="ck">{value === k ? '✓' : ''}</span>
                    <span className="l">{l}</span>
                    <b>{n}</b>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {value !== allKey && cur && (
        <span className="c-recent-chip">
          {cur[1]}
          <button aria-label="거르기 풀기" onClick={() => onValue(allKey)}>
            ✕
          </button>
        </span>
      )}
    </div>
  );
}
