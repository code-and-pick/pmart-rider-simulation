import { useApp } from '../app/App';
import { OPS_SCREENS, opsBase, opsUrl } from './opsLinks';

/** 운영 화면 탭: 라이더 백오피스의 메뉴를 목록으로 — 누르면 새 탭으로 연다(가상 현장 지도는 그대로 돈다). */
export function OpsPanel() {
  const { sim } = useApp();
  const mode = sim.mode === 'http' ? 'http' : 'mock';
  return (
    <section className="ops" aria-label="운영 화면">
      <h2>운영 화면 — 라이더 백오피스</h2>
      <p className="ops-note">
        {mode === 'http'
          ? `실서버: LAN 라이더 백오피스(${opsBase(mode)})를 엽니다. 직원 계정(라이더 운영)으로 로그인하면 이 가상 현장의 배송·접수 건이 그대로 보여요.`
          : `MOCK: 라이더 백오피스 목 모드(${opsBase(mode)})를 엽니다. pmart-clients 에서 "npm run dev -w web/rider-backoffice" 를 먼저 켜 주세요. 목 데이터라 이 시뮬레이터 MOCK 과 숫자가 다릅니다.`}
      </p>
      <ul className="ops-list">
        {OPS_SCREENS.map((s) => {
          const url = opsUrl(mode, s);
          return (
            <li key={s.key} className={url ? '' : 'pending'}>
              <div>
                <strong>{s.title}</strong>
                <span>{s.what}</span>
              </div>
              {url ? (
                <a className="btn" href={url} target="_blank" rel="noopener noreferrer">
                  새 탭으로 열기 ↗
                </a>
              ) : (
                <span className="chip">준비 중</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
