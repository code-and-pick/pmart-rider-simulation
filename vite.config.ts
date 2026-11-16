import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { configureApiProxy, pmartDevServer } from './server/devServer';

// 실서버 모드는 브라우저에서 게이트웨이를 직접 부르면 CORS 에 막힐 수 있어 개발 서버가 /api 를 게이트웨이로 넘긴다.
// 주소는 PMART_GATEWAY 로 바꾼다. 기본값 = LAN 게이트웨이(pmart-backend deploy/lan/checks/rider_e2e.py 37행과 같은 곳 — 그쪽은 /api/v1 까지 붙임).
const gateway = process.env.PMART_GATEWAY ?? 'http://192.168.0.40:8080';

export default defineConfig({
  plugins: [react(), pmartDevServer()],
  server: {
    port: 5181, // MFC 시뮬레이터 5180 과 겹치지 않게
    strictPort: true, // 카카오 콘솔 Web 플랫폼에 등록한 주소와 포트가 달라지지 않게
    host: true, // LAN 다른 기기에서 보기 — 다른 기기 요청은 server/lanPolicy.ts 가 GET·HEAD 허용 목록만 넘긴다(§6-4)
    proxy: {
      // 토큰은 server/devServer.ts 가 붙인다(브라우저는 토큰을 모른다). 401 이면 그 토큰을 버린다.
      '/api': { target: gateway, changeOrigin: true, configure: (proxy) => configureApiProxy(proxy) },
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
});
