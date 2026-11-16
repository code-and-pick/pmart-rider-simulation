import { CONTRACT, DEFAULT_PARAMS } from '../config';

// P0 골격 화면 — 카카오 지도·MOCK 백엔드·가상 라이더 상태기계는 P1(docs/design.md §9).
// 키 값은 화면에 보이지 않는다. 있는지만 표시한다.
const hasKakaoKey = Boolean(import.meta.env.VITE_KAKAO_JS_KEY);

export function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, lineHeight: 1.6 }}>
      <h1 style={{ fontSize: 20, margin: '0 0 12px' }}>PMart 배송·라이더 가상 현장</h1>
      <p style={{ margin: 0 }}>P0 골격 — 지도·가상 라이더는 P1 에서 붙는다.</p>
      <ul>
        <li>모드 기본값: {DEFAULT_PARAMS.mode === 'mock' ? 'MOCK' : '실서버'}</li>
        <li>
          대상 MFC: {DEFAULT_PARAMS.mfcId} ({DEFAULT_PARAMS.mfcLocation.lat}, {DEFAULT_PARAMS.mfcLocation.lng}) — 가정값
        </li>
        <li>시험 라이더 접두어: {CONTRACT.simRiderPrefix}</li>
        <li>카카오 JavaScript 키: {hasKakaoKey ? '있음' : '없음 — 좌표 평면 대체 화면으로 돈다'}</li>
      </ul>
    </main>
  );
}
