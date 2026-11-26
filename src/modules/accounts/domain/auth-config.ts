import type { Realm } from './apps.js';

export const AUTH_CONFIG = Symbol('AUTH_CONFIG');

export type AuthConfig = {
  issuer: string;
  secrets: Record<Realm, string>;
  accessTokenTtlSeconds: number;
  refreshTokenTtlMs: number;
  refreshTokenRememberTtlMs: number;
  refreshReuseGraceMs: number;
  maxFailedLogins: number;
  lockDurationMs: number;
};
