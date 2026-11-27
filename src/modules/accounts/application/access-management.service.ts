import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AccessErrors } from '../domain/access/access-errors.js';
import {
  AUDIT_TRAIL,
  type AuditQuery,
  type AuditTrail,
} from '../domain/access/access-events.js';
import {
  type AccessActor,
  planGrant,
  planProfileCreation,
  planProfileDeletion,
  planProfileUpdate,
  planRevoke,
  planStatusChange,
  planUserCreation,
  planUserUpdate,
  type ProfileChanges,
} from '../domain/access/access-policy.js';
import {
  type AccessProfile,
  GENERAL_ADMIN_PROFILE_ID,
} from '../domain/access/access-profile.js';
import {
  ACCESS_UNIT_OF_WORK,
  type AccessRepository,
  type AccessUnitOfWork,
} from '../domain/access/access-repository.js';
import type { StaffUser } from '../domain/access/staff-user.js';
import type { AccountStatus } from '../domain/accounts.js';
import type { StaffApp } from '../domain/apps.js';
import { CLOCK, type Clock } from '../domain/clock.js';
import { normalizeEmail } from '../domain/password-authenticator.js';
import { PasswordHasher } from '../domain/password-hasher.js';
import { assertPasswordPolicy } from '../domain/password-policy.js';
import { PERMISSION_CATALOG } from '../domain/permissions.js';

export type PermissionInfo = {
  key: string;
  app: StaffApp;
  description: string;
};

/**
 * Casos de uso da gestão de acessos. Cada mudança: carrega o estado numa transação,
 * pede à política do domínio que valide e diga os eventos, grava a mudança e os eventos
 * juntos (a auditoria nunca fica para trás da mudança).
 */
@Injectable()
export class AccessManagementService {
  constructor(
    @Inject(ACCESS_UNIT_OF_WORK) private readonly uow: AccessUnitOfWork,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly hasher: PasswordHasher,
  ) {}

  permissionCatalog(): PermissionInfo[] {
    return (Object.keys(PERMISSION_CATALOG) as StaffApp[]).flatMap((app) =>
      PERMISSION_CATALOG[app].map(({ key, description }) => ({
        key,
        app,
        description,
      })),
    );
  }

  // ─── Perfis ─────────────────────────────────────────────────────────────────

  listProfiles() {
    return this.uow.read((repo) => repo.listProfiles());
  }

  createProfile(
    actorId: string,
    input: {
      app: StaffApp;
      name: string;
      description?: string | null;
      permissions: string[];
    },
  ) {
    return this.uow.transaction(async (repo) => {
      const { profile, events } = planProfileCreation(
        await actorOf(repo, actorId),
        {
          id: randomUUID(),
          app: input.app,
          name: input.name,
          description: input.description || null,
          permissions: input.permissions,
        },
        this.clock.now(),
      );
      if (await repo.isProfileNameTaken(profile.app, profile.name)) {
        throw AccessErrors.profileNameTaken();
      }
      await repo.insertProfile(profile);
      await repo.appendEvents(events);
      return { ...profile, userCount: 0 };
    });
  }

  updateProfile(actorId: string, profileId: string, changes: ProfileChanges) {
    return this.uow.transaction(async (repo) => {
      const current = await requireProfile(repo, profileId);
      const { profile, events } = planProfileUpdate(
        await actorOf(repo, actorId),
        current,
        changes,
        this.clock.now(),
      );
      if (
        profile.name !== current.name &&
        (await repo.isProfileNameTaken(profile.app, profile.name, profile.id))
      ) {
        throw AccessErrors.profileNameTaken();
      }
      if (events.length > 0) {
        await repo.updateProfile(profile);
        await repo.appendEvents(events);
      }
      return { ...profile, userCount: await repo.countHolders(profile.id) };
    });
  }

  deleteProfile(actorId: string, profileId: string) {
    return this.uow.transaction(async (repo) => {
      const profile = await requireProfile(repo, profileId);
      const events = planProfileDeletion(
        await actorOf(repo, actorId),
        profile,
        await repo.countHolders(profile.id),
        this.clock.now(),
      );
      await repo.deleteProfile(profile.id);
      await repo.appendEvents(events);
    });
  }

  // ─── Usuários ───────────────────────────────────────────────────────────────

  listUsers() {
    return this.uow.read((repo) => repo.listUsers());
  }

  getUser(userId: string) {
    return this.uow.read((repo) => requireUser(repo, userId));
  }

  /** A conta nasce sem senha: fica com convite pendente até o convite ser aceito. */
  createUser(
    actorId: string,
    input: { email: string; name: string; profileIds: string[] },
  ) {
    return this.uow.transaction(async (repo) => {
      const user = {
        id: randomUUID(),
        email: normalizeEmail(input.email),
        name: input.name,
      };
      const profiles = await requireProfiles(repo, input.profileIds);
      const events = planUserCreation(
        await actorOf(repo, actorId),
        user,
        profiles,
        this.clock.now(),
      );
      if (await repo.isEmailTaken(user.email)) throw AccessErrors.emailTaken();

      await repo.insertUser(user);
      for (const profile of profiles) {
        await repo.grantProfile(user.id, profile.id, actorId);
      }
      await repo.appendEvents(events);
      return requireUser(repo, user.id);
    });
  }

  grantProfile(actorId: string, userId: string, profileId: string) {
    return this.uow.transaction(async (repo) => {
      const user = await requireUser(repo, userId);
      const profile = await requireProfile(repo, profileId);
      const events = planGrant(
        await actorOf(repo, actorId),
        user,
        profile,
        this.clock.now(),
      );
      if (events.length > 0) {
        await repo.grantProfile(user.id, profile.id, actorId);
        await repo.appendEvents(events);
      }
      return requireUser(repo, user.id);
    });
  }

  revokeProfile(actorId: string, userId: string, profileId: string) {
    return this.uow.transaction(async (repo) => {
      const user = await requireUser(repo, userId);
      const profile = await requireProfile(repo, profileId);
      const events = planRevoke(
        await actorOf(repo, actorId),
        user,
        profile,
        await repo.countUsableHolders(GENERAL_ADMIN_PROFILE_ID),
        this.clock.now(),
      );
      if (events.length > 0) {
        await repo.revokeProfile(user.id, profile.id);
        await repo.appendEvents(events);
      }
      return requireUser(repo, user.id);
    });
  }

  /**
   * Nome, e-mail e/ou senha de outra pessoa da equipe. Senha nova encerra todas as sessões
   * dela; se o convite estava pendente, a conta passa a conseguir entrar.
   */
  async updateUser(
    actorId: string,
    userId: string,
    input: { name?: string; email?: string; password?: string },
  ) {
    if (input.password !== undefined) assertPasswordPolicy(input.password);
    // argon2 é lento de propósito: calcula antes de pegar a trava da gestão de acessos.
    const passwordHash =
      input.password !== undefined
        ? await this.hasher.hash(input.password)
        : undefined;

    return this.uow.transaction(async (repo) => {
      const user = await requireUser(repo, userId);
      const now = this.clock.now();
      const { name, email, events } = planUserUpdate(
        await actorOf(repo, actorId),
        user,
        await repo.findProfiles(user.profiles.map(({ id }) => id)),
        {
          name: input.name,
          email:
            input.email === undefined ? undefined : normalizeEmail(input.email),
          passwordReset: passwordHash !== undefined,
        },
        now,
      );
      if (email !== undefined && (await repo.isEmailTaken(email, user.id))) {
        throw AccessErrors.emailTaken();
      }

      if (name !== undefined || email !== undefined) {
        await repo.updateUserData(user.id, { name, email });
      }
      if (passwordHash !== undefined) {
        await repo.resetUserPassword(user.id, passwordHash, now);
      }
      await repo.appendEvents(events);
      return requireUser(repo, user.id);
    });
  }

  setUserStatus(actorId: string, userId: string, status: AccountStatus) {
    return this.uow.transaction(async (repo) => {
      const user = await requireUser(repo, userId);
      const events = planStatusChange(
        await actorOf(repo, actorId),
        user,
        await repo.findProfiles(user.profiles.map(({ id }) => id)),
        status,
        await repo.countUsableHolders(GENERAL_ADMIN_PROFILE_ID),
        this.clock.now(),
      );
      if (events.length > 0) {
        await repo.setUserStatus(user.id, status);
        await repo.appendEvents(events);
      }
      return requireUser(repo, user.id);
    });
  }

  // ─── Auditoria ──────────────────────────────────────────────────────────────

  auditLog(query: AuditQuery) {
    return this.audit.list(query);
  }
}

async function actorOf(
  repo: AccessRepository,
  actorId: string,
): Promise<AccessActor> {
  return {
    id: actorId,
    permissions: new Set(await repo.permissionsOf(actorId)),
  };
}

async function requireProfile(
  repo: AccessRepository,
  id: string,
): Promise<AccessProfile> {
  const profile = await repo.findProfile(id);
  if (!profile) throw AccessErrors.profileNotFound([id]);
  return profile;
}

async function requireProfiles(
  repo: AccessRepository,
  ids: readonly string[],
): Promise<AccessProfile[]> {
  const unique = [...new Set(ids)];
  const profiles = await repo.findProfiles(unique);
  const missing = unique.filter((id) => !profiles.some((p) => p.id === id));
  if (missing.length > 0) throw AccessErrors.profileNotFound(missing);
  return profiles;
}

async function requireUser(
  repo: AccessRepository,
  id: string,
): Promise<StaffUser> {
  const user = await repo.findUser(id);
  if (!user) throw AccessErrors.userNotFound();
  return user;
}
