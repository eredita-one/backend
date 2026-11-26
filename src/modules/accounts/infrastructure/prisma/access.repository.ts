import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/prisma/prisma.service.js';
import type { Prisma } from '../../../../generated/prisma/client.js';
import type {
  AccessEvent,
  AuditQuery,
  AuditTrail,
  RecordedAccessEvent,
} from '../../domain/access/access-events.js';
import type { AccessProfile } from '../../domain/access/access-profile.js';
import type {
  AccessProfileSummary,
  AccessRepository,
  AccessUnitOfWork,
} from '../../domain/access/access-repository.js';
import type { StaffUser } from '../../domain/access/staff-user.js';
import type { AccountStatus } from '../../domain/accounts.js';
import type { StaffApp } from '../../domain/apps.js';
import { isPermissionOf } from '../../domain/permissions.js';

type Db = PrismaService | Prisma.TransactionClient;

const profileInclude = {
  permissions: { select: { permission: true } },
} satisfies Prisma.AccessProfileInclude;

type ProfileRow = Prisma.AccessProfileGetPayload<{
  include: typeof profileInclude;
}>;

/** Chaves gravadas que saíram do catálogo do código são ignoradas (e somem na próxima edição). */
const toProfile = ({
  permissions,
  createdAt: _c,
  updatedAt: _u,
  ...row
}: ProfileRow): AccessProfile => ({
  ...row,
  permissions: permissions
    .map(({ permission }) => permission)
    .filter((permission) => isPermissionOf(row.app, permission))
    .sort(),
});

const userSelect = {
  id: true,
  email: true,
  name: true,
  status: true,
  // Só para saber se o convite está pendente; o hash nunca sai deste arquivo.
  passwordHash: true,
  lastLoginAt: true,
  createdAt: true,
  accessProfiles: {
    select: { profile: { select: { id: true, app: true, name: true } } },
    orderBy: { grantedAt: 'asc' },
  },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

const toUser = ({
  passwordHash,
  accessProfiles,
  ...row
}: UserRow): StaffUser => ({
  ...row,
  invitePending: passwordHash === null,
  profiles: accessProfiles.map(({ profile }) => profile),
});

const toAuditRow = (event: AccessEvent) => ({
  type: event.type,
  actorId: event.actorId,
  subjectType: event.subjectType,
  subjectId: event.subjectId,
  data: event.data as Prisma.InputJsonObject,
  occurredAt: event.occurredAt,
});

export class PrismaAccessRepository implements AccessRepository {
  constructor(private readonly db: Db) {}

  async findProfile(id: string) {
    const row = await this.db.accessProfile.findUnique({
      where: { id },
      include: profileInclude,
    });
    return row && toProfile(row);
  }

  async findProfiles(ids: readonly string[]) {
    if (ids.length === 0) return [];
    const rows = await this.db.accessProfile.findMany({
      where: { id: { in: [...ids] } },
      include: profileInclude,
    });
    return rows.map(toProfile);
  }

  async listProfiles(): Promise<AccessProfileSummary[]> {
    const rows = await this.db.accessProfile.findMany({
      include: { ...profileInclude, _count: { select: { users: true } } },
      orderBy: [{ app: 'asc' }, { name: 'asc' }],
    });
    return rows.map(({ _count, ...row }) => ({
      ...toProfile(row),
      userCount: _count.users,
    }));
  }

  /** Sem diferenciar maiúsculas: "Operações" e "operações" seriam o mesmo perfil na tela. */
  async isProfileNameTaken(app: StaffApp, name: string, exceptId?: string) {
    const found = await this.db.accessProfile.findFirst({
      where: {
        app,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true },
    });
    return found !== null;
  }

  async insertProfile(profile: AccessProfile) {
    await this.db.accessProfile.create({
      data: {
        id: profile.id,
        app: profile.app,
        name: profile.name,
        description: profile.description,
        isSystem: profile.isSystem,
        permissions: {
          create: profile.permissions.map((permission) => ({ permission })),
        },
      },
    });
  }

  async updateProfile(profile: AccessProfile) {
    await this.db.accessProfile.update({
      where: { id: profile.id },
      data: {
        name: profile.name,
        description: profile.description,
        permissions: {
          deleteMany: {},
          create: profile.permissions.map((permission) => ({ permission })),
        },
      },
    });
  }

  async deleteProfile(id: string) {
    await this.db.accessProfile.delete({ where: { id } });
  }

  countHolders(profileId: string) {
    return this.db.userAccessProfile.count({ where: { profileId } });
  }

  countUsableHolders(profileId: string) {
    return this.db.userAccessProfile.count({
      where: {
        profileId,
        user: { status: 'ACTIVE', passwordHash: { not: null } },
      },
    });
  }

  async findUser(id: string) {
    const row = await this.db.user.findUnique({
      where: { id },
      select: userSelect,
    });
    return row && toUser(row);
  }

  async listUsers() {
    const rows = await this.db.user.findMany({
      select: userSelect,
      orderBy: { name: 'asc' },
    });
    return rows.map(toUser);
  }

  async isEmailTaken(email: string) {
    const found = await this.db.user.findUnique({
      where: { email },
      select: { id: true },
    });
    return found !== null;
  }

  async insertUser(user: { id: string; email: string; name: string }) {
    await this.db.user.create({ data: { ...user, passwordHash: null } });
  }

  async grantProfile(
    userId: string,
    profileId: string,
    grantedBy: string | null,
  ) {
    await this.db.userAccessProfile.createMany({
      data: [{ userId, profileId, grantedBy }],
      skipDuplicates: true,
    });
  }

  async revokeProfile(userId: string, profileId: string) {
    await this.db.userAccessProfile.deleteMany({
      where: { userId, profileId },
    });
  }

  async setUserStatus(userId: string, status: AccountStatus) {
    await this.db.user.update({ where: { id: userId }, data: { status } });
  }

  async permissionsOf(userId: string) {
    const rows = await this.db.accessProfilePermission.findMany({
      where: { profile: { users: { some: { userId } } } },
      select: { permission: true },
    });
    return [...new Set(rows.map(({ permission }) => permission))];
  }

  async appendEvents(events: readonly AccessEvent[]) {
    if (events.length === 0) return;
    await this.db.accessAuditLog.createMany({ data: events.map(toAuditRow) });
  }
}

/** Chave do advisory lock da gestão de acessos (qualquer número fixo, único na aplicação). */
const ACCESS_MANAGEMENT_LOCK = 7_242_100_11;

/**
 * Transações da gestão de acessos. Toda mudança pega um advisory lock do Postgres antes
 * de ler qualquer coisa: as mudanças de acesso acontecem uma de cada vez, então duas
 * pessoas não conseguem, ao mesmo tempo, remover os dois últimos administradores. O lock
 * é solto sozinho no fim da transação (commit ou rollback).
 */
@Injectable()
export class PrismaAccessUnitOfWork implements AccessUnitOfWork {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(work: (repo: AccessRepository) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      // $executeRaw: a função devolve `void`, que não precisa ser lido.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ACCESS_MANAGEMENT_LOCK}::bigint)`;
      return work(new PrismaAccessRepository(tx));
    });
  }

  read<T>(work: (repo: AccessRepository) => Promise<T>): Promise<T> {
    return work(new PrismaAccessRepository(this.prisma));
  }
}

/** Auditoria fora das transações de gestão (bloqueio de conta, reuso de sessão) e consulta. */
@Injectable()
export class PrismaAuditTrail implements AuditTrail {
  constructor(private readonly prisma: PrismaService) {}

  async append(events: readonly AccessEvent[]) {
    if (events.length === 0) return;
    await this.prisma.accessAuditLog.createMany({
      data: events.map(toAuditRow),
    });
  }

  async list({ limit, subjectId }: AuditQuery): Promise<RecordedAccessEvent[]> {
    const rows = await this.prisma.accessAuditLog.findMany({
      where: subjectId ? { subjectId } : {},
      orderBy: { occurredAt: 'desc' },
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      type: row.type as RecordedAccessEvent['type'],
      actorId: row.actorId,
      subjectType: row.subjectType as RecordedAccessEvent['subjectType'],
      subjectId: row.subjectId,
      data: row.data as Record<string, unknown>,
      occurredAt: row.occurredAt,
    }));
  }
}
