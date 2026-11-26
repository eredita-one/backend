import type { AccountStatus } from '../accounts.js';
import type { StaffApp } from '../apps.js';
import type { AccessEvent } from './access-events.js';
import type { AccessProfile } from './access-profile.js';
import type { StaffUser } from './staff-user.js';

export type AccessProfileSummary = AccessProfile & { userCount: number };

/** Persistência da gestão de acessos (perfis e atribuições da equipe). */
export interface AccessRepository {
  findProfile(id: string): Promise<AccessProfile | null>;
  findProfiles(ids: readonly string[]): Promise<AccessProfile[]>;
  listProfiles(): Promise<AccessProfileSummary[]>;
  isProfileNameTaken(
    app: StaffApp,
    name: string,
    exceptId?: string,
  ): Promise<boolean>;
  insertProfile(profile: AccessProfile): Promise<void>;
  /** Grava nome, descrição e o conjunto de permissões. */
  updateProfile(profile: AccessProfile): Promise<void>;
  deleteProfile(id: string): Promise<void>;
  countHolders(profileId: string): Promise<number>;
  /** Titulares que conseguem entrar (ativos e com senha definida). */
  countUsableHolders(profileId: string): Promise<number>;

  findUser(id: string): Promise<StaffUser | null>;
  listUsers(): Promise<StaffUser[]>;
  isEmailTaken(email: string): Promise<boolean>;
  /** Cria a conta sem senha: ela fica com convite pendente. */
  insertUser(user: { id: string; email: string; name: string }): Promise<void>;
  grantProfile(
    userId: string,
    profileId: string,
    grantedBy: string | null,
  ): Promise<void>;
  revokeProfile(userId: string, profileId: string): Promise<void>;
  setUserStatus(userId: string, status: AccountStatus): Promise<void>;
  /** Todas as permissões do usuário, somando os perfis de todos os apps. */
  permissionsOf(userId: string): Promise<string[]>;

  appendEvents(events: readonly AccessEvent[]): Promise<void>;
}

export interface AccessUnitOfWork {
  /**
   * Executa a mudança numa transação, uma de cada vez: duas mudanças simultâneas não
   * conseguem, juntas, deixar o sistema sem Administrador geral.
   */
  transaction<T>(work: (repo: AccessRepository) => Promise<T>): Promise<T>;
  /** Leitura, sem transação. */
  read<T>(work: (repo: AccessRepository) => Promise<T>): Promise<T>;
}

export const ACCESS_UNIT_OF_WORK = Symbol('ACCESS_UNIT_OF_WORK');
