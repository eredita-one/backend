import type { AccountStatus } from '../accounts.js';
import type { StaffApp } from '../apps.js';
import { isPermissionOf, type Permission } from '../permissions.js';
import { AccessErrors } from './access-errors.js';
import {
  type AccessEvent,
  AccessEventType,
  type AuditSubjectType,
} from './access-events.js';
import {
  type AccessProfile,
  GENERAL_ADMIN_PROFILE_ID,
} from './access-profile.js';
import {
  hasProfile,
  isUsableGeneralAdmin,
  type StaffUser,
} from './staff-user.js';

/**
 * Regras da gestão de acessos, como funções puras: recebem o estado atual, lançam
 * `AppException` quando a mudança é proibida e devolvem os eventos a registrar.
 *
 * Princípios:
 *  1. Autoridade: para mexer num perfil do admin, quem age precisa da permissão de gestão
 *     e de TODAS as permissões do perfil. Ninguém concede, revoga ou cria o que não tem.
 *     Perfis dos outros apps (consultor, contábil) pedem só a permissão de gestão daquele
 *     app, delegada pelo admin.
 *  2. Ninguém altera o próprio acesso (perfis ou status).
 *  3. Ninguém age sobre quem tem mais poder: ativar ou desativar uma pessoa exige
 *     autoridade sobre cada perfil dela.
 *  4. Sempre resta ao menos um Administrador geral que consegue entrar.
 *  5. Perfis do sistema não são editados nem apagados.
 */

/** Quem age, com as permissões somadas de todos os seus perfis (de todos os apps). */
export type AccessActor = { id: string; permissions: ReadonlySet<string> };

type Action = 'define' | 'assign';

/** Permissão de gestão exigida para definir um perfil (`define`) ou atribuí-lo (`assign`). */
const MANAGE_PERMISSION: Record<StaffApp, Record<Action, Permission>> = {
  ADMIN: {
    define: 'admin.access.profiles.manage',
    assign: 'admin.access.users.manage',
  },
  CONSULTOR: {
    define: 'admin.access.consultor.manage',
    assign: 'admin.access.consultor.manage',
  },
  CONTABIL: {
    define: 'admin.access.contabil.manage',
    assign: 'admin.access.contabil.manage',
  },
};

const USERS_MANAGE: Permission = 'admin.access.users.manage';

export function missingAuthority(
  actor: AccessActor,
  action: Action,
  profile: Pick<AccessProfile, 'app' | 'permissions'>,
): Permission[] {
  const required: Permission[] = [
    MANAGE_PERMISSION[profile.app][action],
    ...(profile.app === 'ADMIN' ? profile.permissions : []),
  ];
  return [...new Set(required)].filter((p) => !actor.permissions.has(p));
}

function assertAuthority(
  actor: AccessActor,
  action: Action,
  ...profiles: Pick<AccessProfile, 'app' | 'permissions'>[]
) {
  const missing = new Set(
    profiles.flatMap((profile) => missingAuthority(actor, action, profile)),
  );
  if (missing.size > 0)
    throw AccessErrors.escalationDenied([...missing].sort());
}

function assertHolds(actor: AccessActor, permission: Permission) {
  if (!actor.permissions.has(permission)) {
    throw AccessErrors.escalationDenied([permission]);
  }
}

function assertNotSelf(actor: AccessActor, user: StaffUser) {
  if (actor.id === user.id) throw AccessErrors.selfChangeDenied();
}

/** Valida contra o catálogo do app, remove repetidas e ordena. */
export function normalizePermissions(
  app: StaffApp,
  permissions: readonly string[],
): Permission[] {
  const unknown = permissions.filter((p) => !isPermissionOf(app, p));
  if (unknown.length > 0) {
    throw AccessErrors.unknownPermissions(app, [...new Set(unknown)]);
  }
  return [...new Set(permissions as Permission[])].sort();
}

function event(
  type: AccessEvent['type'],
  actor: AccessActor | null,
  subjectType: AuditSubjectType,
  subjectId: string,
  data: Record<string, unknown>,
  now: Date,
): AccessEvent {
  return {
    type,
    actorId: actor?.id ?? null,
    subjectType,
    subjectId,
    data,
    occurredAt: now,
  };
}

const profileData = (profile: AccessProfile) => ({
  profileId: profile.id,
  profileName: profile.name,
  app: profile.app,
});

// ─── Perfis ───────────────────────────────────────────────────────────────────

export type ProfileDraft = {
  id: string;
  app: StaffApp;
  name: string;
  description: string | null;
  permissions: readonly string[];
};

export function planProfileCreation(
  actor: AccessActor,
  draft: ProfileDraft,
  now: Date,
) {
  const profile: AccessProfile = {
    id: draft.id,
    app: draft.app,
    name: draft.name,
    description: draft.description,
    isSystem: false,
    permissions: normalizePermissions(draft.app, draft.permissions),
  };
  assertAuthority(actor, 'define', profile);

  const events = [
    event(
      AccessEventType.ACCESS_PROFILE_CREATED,
      actor,
      'access_profile',
      profile.id,
      {
        app: profile.app,
        name: profile.name,
        permissions: profile.permissions,
      },
      now,
    ),
  ];
  return { profile, events };
}

export type ProfileChanges = {
  name?: string;
  /** `null` limpa a descrição; ausente mantém. */
  description?: string | null;
  permissions?: readonly string[];
};

export function planProfileUpdate(
  actor: AccessActor,
  current: AccessProfile,
  changes: ProfileChanges,
  now: Date,
) {
  if (current.isSystem) throw AccessErrors.systemProfileReadonly();

  const permissions = changes.permissions
    ? normalizePermissions(current.app, changes.permissions)
    : current.permissions;
  const updated: AccessProfile = {
    ...current,
    name: changes.name ?? current.name,
    description:
      changes.description === undefined
        ? current.description
        : changes.description,
    permissions,
  };
  // Autoridade sobre o perfil como ele é e como vai ficar: não dá para tirar de alguém
  // uma permissão que você não tem, nem acrescentar uma que você não tem.
  assertAuthority(actor, 'define', current, updated);

  const added = permissions.filter((p) => !current.permissions.includes(p));
  const removed = current.permissions.filter((p) => !permissions.includes(p));
  const data: Record<string, unknown> = {};
  if (updated.name !== current.name)
    data.name = { from: current.name, to: updated.name };
  if (updated.description !== current.description) {
    data.description = { from: current.description, to: updated.description };
  }
  if (added.length > 0) data.added = added;
  if (removed.length > 0) data.removed = removed;

  const events =
    Object.keys(data).length > 0
      ? [
          event(
            AccessEventType.ACCESS_PROFILE_UPDATED,
            actor,
            'access_profile',
            current.id,
            data,
            now,
          ),
        ]
      : [];
  return { profile: updated, events };
}

export function planProfileDeletion(
  actor: AccessActor,
  profile: AccessProfile,
  holders: number,
  now: Date,
): AccessEvent[] {
  if (profile.isSystem) throw AccessErrors.systemProfileReadonly();
  assertAuthority(actor, 'define', profile);
  if (holders > 0) throw AccessErrors.profileInUse(holders);

  return [
    event(
      AccessEventType.ACCESS_PROFILE_DELETED,
      actor,
      'access_profile',
      profile.id,
      {
        app: profile.app,
        name: profile.name,
        permissions: profile.permissions,
      },
      now,
    ),
  ];
}

// ─── Usuários ─────────────────────────────────────────────────────────────────

export function planUserCreation(
  actor: AccessActor,
  user: { id: string; email: string; name: string },
  profiles: AccessProfile[],
  now: Date,
): AccessEvent[] {
  assertHolds(actor, USERS_MANAGE);
  assertAuthority(actor, 'assign', ...profiles);

  return [
    event(
      AccessEventType.STAFF_USER_CREATED,
      actor,
      'staff_user',
      user.id,
      { email: user.email, name: user.name },
      now,
    ),
    ...profiles.map((profile) =>
      event(
        AccessEventType.ACCESS_PROFILE_GRANTED,
        actor,
        'staff_user',
        user.id,
        profileData(profile),
        now,
      ),
    ),
  ];
}

/** Sem eventos quando o usuário já tem o perfil (operação idempotente). */
export function planGrant(
  actor: AccessActor,
  user: StaffUser,
  profile: AccessProfile,
  now: Date,
): AccessEvent[] {
  assertNotSelf(actor, user);
  assertAuthority(actor, 'assign', profile);
  if (hasProfile(user, profile.id)) return [];

  return [
    event(
      AccessEventType.ACCESS_PROFILE_GRANTED,
      actor,
      'staff_user',
      user.id,
      profileData(profile),
      now,
    ),
  ];
}

/** Sem eventos quando o usuário não tem o perfil (operação idempotente). */
export function planRevoke(
  actor: AccessActor,
  user: StaffUser,
  profile: AccessProfile,
  usableGeneralAdmins: number,
  now: Date,
): AccessEvent[] {
  assertNotSelf(actor, user);
  assertAuthority(actor, 'assign', profile);
  if (!hasProfile(user, profile.id)) return [];

  if (
    profile.id === GENERAL_ADMIN_PROFILE_ID &&
    isUsableGeneralAdmin(user) &&
    usableGeneralAdmins <= 1
  ) {
    throw AccessErrors.lastGeneralAdmin();
  }

  return [
    event(
      AccessEventType.ACCESS_PROFILE_REVOKED,
      actor,
      'staff_user',
      user.id,
      profileData(profile),
      now,
    ),
  ];
}

/** Sem eventos quando o status já é o pedido (operação idempotente). */
export function planStatusChange(
  actor: AccessActor,
  user: StaffUser,
  userProfiles: AccessProfile[],
  status: AccountStatus,
  usableGeneralAdmins: number,
  now: Date,
): AccessEvent[] {
  assertNotSelf(actor, user);
  assertHolds(actor, USERS_MANAGE);
  assertAuthority(actor, 'assign', ...userProfiles);
  if (user.status === status) return [];

  if (
    status === 'DISABLED' &&
    isUsableGeneralAdmin(user) &&
    usableGeneralAdmins <= 1
  ) {
    throw AccessErrors.lastGeneralAdmin();
  }

  const type =
    status === 'DISABLED'
      ? AccessEventType.STAFF_USER_DISABLED
      : AccessEventType.STAFF_USER_ENABLED;
  return [event(type, actor, 'staff_user', user.id, {}, now)];
}
