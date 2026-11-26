import { createHash, randomBytes } from 'node:crypto';
import type { StaffApp } from './apps.js';

/**
 * Um refresh token salvo. O valor em si nunca é guardado, só o SHA-256 (`tokenHash`).
 * `familyId` agrupa todas as rotações de um mesmo login (uma "sessão").
 * `TScope` carrega o que é específico do domínio (ex.: o app da equipe).
 */
export type RefreshTokenRecord<TScope extends object> = {
  id: string;
  subjectId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
} & TScope;

export type NewRefreshToken<TScope extends object> = {
  subjectId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent: string | null;
  ip: string | null;
} & TScope;

export interface RefreshTokenStore<TScope extends object> {
  create(token: NewRefreshToken<TScope>): Promise<void>;
  findByHash(tokenHash: string): Promise<RefreshTokenRecord<TScope> | null>;
  /**
   * Revoga `currentId` e cria `next`, na mesma transação. Devolve `false` sem criar nada
   * se `currentId` já estava revogado (outra requisição trocou o token antes).
   */
  rotate(
    currentId: string,
    revokedAt: Date,
    next: NewRefreshToken<TScope>,
  ): Promise<boolean>;
  /** Revoga todos os tokens ainda ativos da família (encerra a sessão). */
  revokeFamily(familyId: string, at: Date): Promise<void>;
  /**
   * A sessão ainda tem algum token não revogado? Distingue "trocado agora por outra
   * requisição" (sim) de "sessão encerrada por logout ou reuso" (não).
   */
  hasActiveInFamily(familyId: string): Promise<boolean>;
}

/** A sessão da equipe vale para um único app: o refresh só renova tokens dele. */
export type StaffTokenScope = { app: StaffApp };
export type ClientTokenScope = Record<never, never>;

export const STAFF_REFRESH_TOKENS = Symbol('STAFF_REFRESH_TOKENS');
export const CLIENT_REFRESH_TOKENS = Symbol('CLIENT_REFRESH_TOKENS');

/** 256 bits aleatórios, em base64url (43 caracteres). */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
