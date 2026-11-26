import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { configureApiProxy, pmartDevServer } from './server/devServer';

// 실서버 모드는 브라우저에서 게이트웨이를 직접 부르면 CORS 에 막힐 수 있어 개발 서버가 /api 를 게이트웨이로 넘긴다.
// 주소는 PMART_GATEWAY 로 바꾼다. 기본값 = LAN 게이트웨이(pmart-backend deploy/lan/checks/rider_e2e.py 37행과 같은 곳 — 그쪽은 /api/v1 까지 붙임).
const gateway = process.env.PMART_GATEWAY ?? 'http://192.168.0.40:8080';

export default defineConfig(({ mode }) => {
  // .env.local 의 모든 값(접두어 없이) — 개발 서버(Node)에서만 쓴다. 브라우저에는 VITE_ 로 시작하는 값만 간다.
  const env = loadEnv(mode, process.cwd(), '');
  // REST 키가 실수로 VITE_ 이름이 되면 화면 코드(번들)에 들어간다 — 시작을 거부한다.
  const leaked = Object.keys(env).filter((k) => k.startsWith('VITE_') && /REST|MOBILITY|SECRET|PASSWORD/i.test(k));
  if (leaked.length) {
    throw new Error(`브라우저로 나가면 안 되는 키가 VITE_ 이름이다: ${leaked.join(', ')} — VITE_ 를 빼라(예: KAKAO_MOBILITY_REST_KEY)`);
  }

  return {
    plugins: [react(), pmartDevServer({ kakaoRestKey: env.KAKAO_MOBILITY_REST_KEY ?? null, kakaoLocalKey: env.KAKAO_LOCAL_REST_KEY ?? null, gateway, operatorIps: env.SIM_OPERATOR_IPS ?? null })],
    server: {
      port: 5181, // MFC 시뮬레이터 5180 과 겹치지 않게
      strictPort: true, // 카카오 콘솔 Web 플랫폼에 등록한 주소와 포트가 달라지지 않게
      host: true, // LAN 다른 기기에서 보기·운행 — server/lanPolicy.ts(보기 = GET 허용 목록, 운행 기기 = 시뮬레이터 라이더 쓰기도, §6-4)
      proxy: {
        // 토큰은 server/devServer.ts 가 붙인다(브라우저는 토큰을 모른다). 401 이면 그 토큰을 버린다.
        '/api': { target: gateway, changeOrigin: true, configure: (proxy) => configureApiProxy(proxy) },
      },
      fs: {
        // 개발 서버가 파일로 내주지 않을 것(기본 .env·.env.* 에 더해)
        deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.secrets/**'],
      },
    },
    preview: {
      port: 5181,
      strictPort: true,
    },
    test: {
      environment: 'node',
      include: ['test/**/*.test.ts'],
    },
  };
});
