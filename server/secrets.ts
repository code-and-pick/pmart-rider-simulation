// LAN 비밀 파일 읽기 — PMART_SECRETS_DIR(기본 ../pmart-backend/deploy/lan/.secrets). 읽기만 한다(RR-01 조건 2).
// 값을 로그·응답에 넣지 않는다. 파일 이름만 다룬다.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const SECRET_FILES = {
  riderKey: 'rider-auth-signing-key.pem',
  riderKid: 'rider-auth-signing-kid',
  observerPassword: 'keycloak-claude-mfc-wrk-password',
  /** 관제 계정(claude-dev, OPERATOR_ADMIN) — GET /rider-locations 한 가지에만 쓴다(RR-08, 사용자 2026-11-18 "1번으로 해") */
  controlPassword: 'keycloak-claude-dev-password',
} as const;

export function secretsDir(projectRoot: string): string {
  return process.env.PMART_SECRETS_DIR ?? path.resolve(projectRoot, '..', 'pmart-backend', 'deploy', 'lan', '.secrets');
}

export class Secrets {
  constructor(readonly dir: string) {}

  has(name: string): boolean {
    return existsSync(path.join(this.dir, name));
  }

  read(name: string): string {
    return readFileSync(path.join(this.dir, name), 'utf8').trim();
  }

  /** 실서버 모드에 필요한 파일이 있는지(값은 보지 않는다) */
  status(): { riderSigning: boolean; observer: boolean; control: boolean } {
    return {
      riderSigning: this.has(SECRET_FILES.riderKey) && this.has(SECRET_FILES.riderKid),
      observer: this.has(SECRET_FILES.observerPassword),
      control: this.has(SECRET_FILES.controlPassword),
    };
  }
}
