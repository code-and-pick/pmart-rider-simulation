/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 카카오맵 웹 JS SDK JavaScript 키 — .env.local(Git 제외). 없으면 좌표 평면 대체 화면(docs/design.md §6-1) */
  readonly VITE_KAKAO_JS_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
