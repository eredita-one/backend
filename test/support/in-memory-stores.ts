import { randomUUID } from 'node:crypto';
import type {
  AccessEvent,
  AuditQuery,
  AuditTrail,
  RecordedAccessEvent,
} from '../../src/modules/accounts/domain/access/access-events.js';
import type { AccessProfile } from '../../src/modules/accounts/domain/access/access-profile.js';
import type {
  AccessProfileSummary,
  AccessRepository,
  AccessUnitOfWork,
} from '../../src/modules/accounts/domain/access/access-repository.js';
import type { StaffUser } from '../../src/modules/accounts/domain/access/staff-user.js';
import type {
  Account,
  AccountStatus,
  AccountStore,
  PasswordChange,
  StaffAccess,
  StaffAccount,
} from '../../src/modules/accounts/domain/accounts.js';
import type { StaffApp } from '../../src/modules/accounts/domain/apps.js';
import type { Clock } from '../../src/modules/accounts/domain/clock.js';
import {
  isPermissionOf,
  type Permission,
} from '../../src/modules/accounts/domain/permissions.js';
import type {
  NewRefreshToken,
  RefreshTokenRecord,
  RefreshTokenStore,
  StaffTokenScope,
} from '../../src/modules/accounts/domain/refresh-tokens.js';

/** Contas de cliente em memória. Devolve cópias, como um banco faria. */
export class InMemoryAccountStore<
  T extends Account,
> implements AccountStore<T> {
  private readonly accounts = new Map<string, T>();
  readonly lastLoginAt = new Map<string, Date>();

  /** Sessões e auditoria que a troca de senha atualiza junto, como a transação do banco. */
  constructor(
    private readonly deps: {
      tokens?: InMemoryRefreshTokenStore<object>;
      audit?: AuditTrail;
    } = {},
  ) {}

  add(account: T): T {
    this.accounts.set(account.id, structuredClone(account));
    return account;
  }

  /** Altera a conta direto "no banco" (ex.: desativar). */
  update(id: string, changes: Partial<T>) {
    Object.assign(this.require(id), changes);
  }

  async findByEmail(email: string) {
    const found = [...this.accounts.values()].find((a) => a.email === email);
    return found ? structuredClone(found) : null;
  }

  async findById(id: string) {
    const found = this.accounts.get(id);
    return found ? structuredClone(found) : null;
  }

  async incrementFailedLogins(id: string) {
    const account = this.require(id);
    account.failedLoginCount += 1;
    return account.failedLoginCount;
  }

  async lock(id: string, until: Date) {
    Object.assign(this.require(id), {
      lockedUntil: until,
      failedLoginCount: 0,
    });
  }

  async recordSuccessfulLogin(id: string, at: Date) {
    Object.assign(this.require(id), { failedLoginCount: 0, lockedUntil: null });
    this.lastLoginAt.set(id, at);
  }

  async changePassword(change: PasswordChange) {
    Object.assign(this.require(change.accountId), {
      passwordHash: change.passwordHash,
      failedLoginCount: 0,
      lockedUntil: null,
    });
    this.deps.tokens?.revokeSubject(
      change.accountId,
      change.at,
      change.keepSessionId,
    );
    await this.deps.audit?.append([change.event]);
  }

  private require(id: string): T {
    const account = this.accounts.get(id);
    if (!account) throw new Error(`conta ${id} não existe`);
    return account;
  }
}

export type StaffRow = {
  id: string;
  email: string;
  name: string;
  passwordHash: string | null;
  status: AccountStatus;
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
};

type Assignment = {
  userId: string;
  profileId: string;
  grantedBy: string | null;
};

/**
 * Equipe interna em memória: contas, perfis, atribuições e auditoria. Implementa as mesmas
 * portas que os adapters Prisma (login, unidade de trabalho e trilha de auditoria), com
 * as transações executadas uma de cada vez, como a trava no banco faz.
 */
export class InMemoryStaffDirectory
  implements AccountStore<StaffAccount>, AccessUnitOfWork, AuditTrail
{
  readonly users = new Map<string, StaffRow>();
  readonly profiles = new Map<string, AccessProfile>();
  readonly assignments: Assignment[] = [];
  readonly events: RecordedAccessEvent[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  /** `tokens`: sessões que a troca de senha encerra, como a transação do banco. */
  constructor(
    private readonly tokens?: InMemoryRefreshTokenStore<StaffTokenScope>,
  ) {}

  // ─── Atalhos para montar cenários ────────────────────────────────────────────

  addProfile(input: {
    app: StaffApp;
    name: string;
    permissions: Permission[];
  }): AccessProfile {
    const profile: AccessProfile = {
      id: randomUUID(),
      description: null,
      isSystem: false,
      ...input,
      permissions: [...input.permissions].sort(),
    };
    this.profiles.set(profile.id, profile);
    return structuredClone(profile);
  }

  addUser(
    row: Omit<
      StaffRow,
      'failedLoginCount' | 'lockedUntil' | 'lastLoginAt' | 'createdAt'
    > &
      Partial<StaffRow>,
    profiles: AccessProfile[],
  ): StaffRow {
    const user: StaffRow = {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: null,
      createdAt: new Date(),
      ...row,
    };
    this.users.set(user.id, user);
    for (const profile of profiles) {
      this.assignments.push({
        userId: user.id,
        profileId: profile.id,
        grantedBy: null,
      });
    }
    return structuredClone(user);
  }

  /** Altera a conta direto "no banco". */
  update(id: string, changes: Partial<StaffRow>) {
    Object.assign(this.requireUser(id), changes);
  }

  /** Tira um perfil direto "no banco", sem passar pelas regras. */
  unassign(userId: string, profileId: string) {
    const index = this.assignments.findIndex(
      (a) => a.userId === userId && a.profileId === profileId,
    );
    if (index >= 0) this.assignments.splice(index, 1);
  }

  profileIdsOf(userId: string) {
    return this.assignments
      .filter((a) => a.userId === userId)
      .map((a) => a.profileId);
  }

  // ─── Login (AccountStore) ────────────────────────────────────────────────────

  async findByEmail(email: string) {
    const row = [...this.users.values()].find((u) => u.email === email);
    return row ? this.toAccount(row) : null;
  }

  async findById(id: string) {
    const row = this.users.get(id);
    return row ? this.toAccount(row) : null;
  }

  async incrementFailedLogins(id: string) {
    const user = this.requireUser(id);
    user.failedLoginCount += 1;
    return user.failedLoginCount;
  }

  async lock(id: string, until: Date) {
    Object.assign(this.requireUser(id), {
      lockedUntil: until,
      failedLoginCount: 0,
    });
  }

  async recordSuccessfulLogin(id: string, at: Date) {
    Object.assign(this.requireUser(id), {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: at,
    });
  }

  async changePassword(change: PasswordChange) {
    Object.assign(this.requireUser(change.accountId), {
      passwordHash: change.passwordHash,
      failedLoginCount: 0,
      lockedUntil: null,
    });
    this.tokens?.revokeSubject(
      change.accountId,
      change.at,
      change.keepSessionId,
    );
    await this.append([change.event]);
  }

  private toAccount(row: StaffRow): StaffAccount {
    const byApp = new Map<StaffApp, Set<Permission>>();
    for (const profileId of this.profileIdsOf(row.id)) {
      const profile = this.profiles.get(profileId)!;
      const granted = byApp.get(profile.app) ?? new Set<Permission>();
      for (const p of profile.permissions) {
        if (isPermissionOf(profile.app, p)) granted.add(p);
      }
      byApp.set(profile.app, granted);
    }
    const access: StaffAccess = {};
    for (const [app, permissions] of byApp)
      access[app] = [...permissions].sort();

    return {
      id: row.id,
      email: row.email,
      name: row.name,
      passwordHash: row.passwordHash,
      status: row.status,
      failedLoginCount: row.failedLoginCount,
      lockedUntil: row.lockedUntil,
      access,
    };
  }

  // ─── Gestão de acessos (AccessUnitOfWork) ────────────────────────────────────

  transaction<T>(work: (repo: AccessRepository) => Promise<T>): Promise<T> {
    const run = this.queue.then(() => work(this.repo));
    this.queue = run.catch(() => undefined);
    return run;
  }

  read<T>(work: (repo: AccessRepository) => Promise<T>): Promise<T> {
    return work(this.repo);
  }

  private toStaffUser(row: StaffRow): StaffUser {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      status: row.status,
      invitePending: row.passwordHash === null,
      lastLoginAt: row.lastLoginAt,
      createdAt: row.createdAt,
      profiles: this.profileIdsOf(row.id).map((id) => {
        const { app, name } = this.profiles.get(id)!;
        return { id, app, name };
      }),
    };
  }

  private readonly repo: AccessRepository = {
    findProfile: async (id) => structuredClone(this.profiles.get(id) ?? null),
    findProfiles: async (ids) =>
      ids.flatMap((id) =>
        this.profiles.has(id) ? [structuredClone(this.profiles.get(id)!)] : [],
      ),
    listProfiles: async (): Promise<AccessProfileSummary[]> =>
      [...this.profiles.values()].map((p) => ({
        ...structuredClone(p),
        userCount: this.assignments.filter((a) => a.profileId === p.id).length,
      })),
    isProfileNameTaken: async (app, name, exceptId) =>
      [...this.profiles.values()].some(
        (p) => p.app === app && p.name === name && p.id !== exceptId,
      ),
    insertProfile: async (profile) => {
      this.profiles.set(profile.id, structuredClone(profile));
    },
    updateProfile: async (profile) => {
      this.profiles.set(profile.id, structuredClone(profile));
    },
    deleteProfile: async (id) => {
      if (this.assignments.some((a) => a.profileId === id)) {
        throw new Error('FK restrict: perfil em uso');
      }
      this.profiles.delete(id);
    },
    countHolders: async (profileId) =>
      this.assignments.filter((a) => a.profileId === profileId).length,
    countUsableHolders: async (profileId) =>
      this.assignments.filter((a) => {
        const user = this.users.get(a.userId)!;
        return (
          a.profileId === profileId &&
          user.status === 'ACTIVE' &&
          user.passwordHash !== null
        );
      }).length,
    findUser: async (id) => {
      const row = this.users.get(id);
      return row ? this.toStaffUser(row) : null;
    },
    listUsers: async () =>
      [...this.users.values()].map((row) => this.toStaffUser(row)),
    isEmailTaken: async (email, exceptId) =>
      [...this.users.values()].some(
        (u) => u.email === email && u.id !== exceptId,
      ),
    insertUser: async ({ id, email, name }) => {
      this.addUser(
        { id, email, name, passwordHash: null, status: 'ACTIVE' },
        [],
      );
    },
    updateUserData: async (userId, { name, email }) =>
      this.update(userId, {
        ...(name === undefined ? {} : { name }),
        ...(email === undefined ? {} : { email }),
      }),
    resetUserPassword: async (userId, passwordHash, at) => {
      this.update(userId, {
        passwordHash,
        failedLoginCount: 0,
        lockedUntil: null,
      });
      this.tokens?.revokeSubject(userId, at);
    },
    grantProfile: async (userId, profileId, grantedBy) => {
      if (!this.profileIdsOf(userId).includes(profileId)) {
        this.assignments.push({ userId, profileId, grantedBy });
      }
    },
    revokeProfile: async (userId, profileId) =>
      this.unassign(userId, profileId),
    setUserStatus: async (userId, status) => this.update(userId, { status }),
    permissionsOf: async (userId) => [
      ...new Set(
        this.profileIdsOf(userId).flatMap(
          (id) => this.profiles.get(id)!.permissions,
        ),
      ),
    ],
    appendEvents: async (events) => this.append(events),
  };

  // ─── Auditoria (AuditTrail) ──────────────────────────────────────────────────

  async append(events: readonly AccessEvent[]) {
    this.events.push(
      ...events.map((e) => ({ ...structuredClone(e), id: randomUUID() })),
    );
  }

  /** Mesmas regras do adapter Prisma (a busca aqui só conhece a equipe e os perfis). */
  async list(query: AuditQuery) {
    const term = query.search?.toLowerCase();
    const searchIds = term
      ? new Set([
          ...[...this.users.values()]
            .filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(term))
            .map((u) => u.id),
          ...[...this.profiles.values()]
            .filter((p) => p.name.toLowerCase().includes(term))
            .map((p) => p.id),
        ])
      : null;
    const found = this.events.filter(
      (e) =>
        (!query.subjectId || e.subjectId === query.subjectId) &&
        (!query.personId ||
          e.actorId === query.personId ||
          e.subjectId === query.personId) &&
        (!query.type || e.type === query.type) &&
        (!query.from || e.occurredAt >= query.from) &&
        (!query.until || e.occurredAt < query.until) &&
        (!searchIds ||
          searchIds.has(e.subjectId) ||
          (e.actorId !== null && searchIds.has(e.actorId))),
    );
    // Gravados em ordem: a lista já está do mais antigo para o mais novo.
    const ordered = query.order === 'desc' ? found.toReversed() : found;
    const start = (query.page - 1) * query.pageSize;
    return {
      items: ordered.slice(start, start + query.pageSize),
      total: found.length,
    };
  }

  eventsOf(type: string) {
    return this.events.filter((e) => e.type === type);
  }

  private requireUser(id: string): StaffRow {
    const user = this.users.get(id);
    if (!user) throw new Error(`usuário ${id} não existe`);
    return user;
  }
}

/** Refresh tokens em memória, com a mesma regra de rotação do adapter Prisma. */
export class InMemoryRefreshTokenStore<
  TScope extends object,
> implements RefreshTokenStore<TScope> {
  readonly tokens: RefreshTokenRecord<TScope>[] = [];

  async create(token: NewRefreshToken<TScope>) {
    const { userAgent: _userAgent, ip: _ip, ...record } = token;
    this.tokens.push({
      ...record,
      id: randomUUID(),
      revokedAt: null,
    } as RefreshTokenRecord<TScope>);
  }

  async findByHash(tokenHash: string) {
    const found = this.tokens.find((t) => t.tokenHash === tokenHash);
    return found ? { ...found } : null;
  }

  async rotate(
    currentId: string,
    revokedAt: Date,
    next: NewRefreshToken<TScope>,
  ) {
    const current = this.tokens.find((t) => t.id === currentId);
    if (!current || current.revokedAt) return false;
    current.revokedAt = revokedAt;
    await this.create(next);
    return true;
  }

  async revokeFamily(familyId: string, at: Date) {
    for (const token of this.tokens) {
      if (token.familyId === familyId && !token.revokedAt) token.revokedAt = at;
    }
  }

  async hasActiveInFamily(familyId: string) {
    return this.activeInFamily(familyId).length > 0;
  }

  activeInFamily(familyId: string) {
    return this.tokens.filter((t) => t.familyId === familyId && !t.revokedAt);
  }

  /** Revoga as sessões ativas da conta, menos a família `exceptFamilyId`. */
  revokeSubject(subjectId: string, at: Date, exceptFamilyId?: string | null) {
    for (const token of this.tokens) {
      if (
        token.subjectId === subjectId &&
        !token.revokedAt &&
        token.familyId !== exceptFamilyId
      ) {
        token.revokedAt = at;
      }
    }
  }

  activeOf(subjectId: string) {
    return this.tokens.filter((t) => t.subjectId === subjectId && !t.revokedAt);
  }
}

/** Relógio controlado pelo teste. */
export class FakeClock implements Clock {
  private current = new Date();

  now() {
    return new Date(this.current);
  }

  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}
