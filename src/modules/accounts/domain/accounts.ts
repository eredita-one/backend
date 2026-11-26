import { STAFF_APPS, type StaffApp } from './apps.js';
import type { Permission } from './permissions.js';

export type AccountStatus = 'ACTIVE' | 'DISABLED';

/** O que o login precisa saber de uma conta, seja da equipe ou de cliente. */
export interface Account {
  id: string;
  email: string;
  name: string;
  /** Nulo enquanto o convite não foi aceito. */
  passwordHash: string | null;
  status: AccountStatus;
  failedLoginCount: number;
  lockedUntil: Date | null;
}

/**
 * Apps que a conta acessa e, em cada um, as permissões somadas dos seus perfis.
 * Um app ausente significa "sem acesso"; presente com lista vazia significa "entra, mas
 * sem nenhuma permissão específica".
 */
export type StaffAccess = Partial<Record<StaffApp, Permission[]>>;

export interface StaffAccount extends Account {
  access: StaffAccess;
}

export type ClientAccount = Account;

export function appsOf(access: StaffAccess): StaffApp[] {
  return STAFF_APPS.filter((app) => access[app] !== undefined);
}

/** Porta de persistência das contas, do ponto de vista do login. Uma por domínio. */
export interface AccountStore<T extends Account> {
  /** `email` já chega normalizado (minúsculas, sem espaços). */
  findByEmail(email: string): Promise<T | null>;
  findById(id: string): Promise<T | null>;
  /** Soma uma falha de login e devolve o total atual (incremento atômico no banco). */
  incrementFailedLogins(id: string): Promise<number>;
  /** Bloqueia a conta até `until` e zera o contador de falhas. */
  lock(id: string, until: Date): Promise<void>;
  /** Zera as falhas, remove o bloqueio e grava a data do login. */
  recordSuccessfulLogin(id: string, at: Date): Promise<void>;
}

export const STAFF_ACCOUNTS = Symbol('STAFF_ACCOUNTS');
export const CLIENT_ACCOUNTS = Symbol('CLIENT_ACCOUNTS');
