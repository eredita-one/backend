import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/prisma/prisma.service.js';
import type { Prisma } from '../../../../generated/prisma/client.js';
import type {
  AccountStore,
  PasswordChange,
  StaffAccess,
  StaffAccount,
} from '../../domain/accounts.js';
import type { StaffApp } from '../../domain/apps.js';
import { isPermissionOf, type Permission } from '../../domain/permissions.js';
import type {
  NewRefreshToken,
  RefreshTokenRecord,
  RefreshTokenStore,
  StaffTokenScope,
} from '../../domain/refresh-tokens.js';
import { toAuditRow } from './access.repository.js';

const accountSelect = {
  id: true,
  email: true,
  name: true,
  passwordHash: true,
  status: true,
  failedLoginCount: true,
  lockedUntil: true,
  accessProfiles: {
    select: {
      profile: {
        select: { app: true, permissions: { select: { permission: true } } },
      },
    },
  },
} satisfies Prisma.UserSelect;

type AccountRow = Prisma.UserGetPayload<{ select: typeof accountSelect }>;

/** Soma as permissões dos perfis por app. Chaves fora do catálogo atual são ignoradas. */
function toAccount({ accessProfiles, ...row }: AccountRow): StaffAccount {
  const byApp = new Map<StaffApp, Set<Permission>>();
  for (const { profile } of accessProfiles) {
    const granted = byApp.get(profile.app) ?? new Set<Permission>();
    for (const { permission } of profile.permissions) {
      if (isPermissionOf(profile.app, permission)) granted.add(permission);
    }
    byApp.set(profile.app, granted);
  }

  const access: StaffAccess = {};
  for (const [app, permissions] of byApp) access[app] = [...permissions].sort();
  return { ...row, access };
}

/** Contas da equipe interna (`users`), com o acesso calculado a partir dos perfis. */
@Injectable()
export class PrismaStaffAccountStore implements AccountStore<StaffAccount> {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<StaffAccount | null> {
    const row = await this.prisma.user.findUnique({
      where: { email },
      select: accountSelect,
    });
    return row && toAccount(row);
  }

  async findById(id: string): Promise<StaffAccount | null> {
    const row = await this.prisma.user.findUnique({
      where: { id },
      select: accountSelect,
    });
    return row && toAccount(row);
  }

  async incrementFailedLogins(id: string): Promise<number> {
    const { failedLoginCount } = await this.prisma.user.update({
      where: { id },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    return failedLoginCount;
  }

  async lock(id: string, until: Date): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { lockedUntil: until, failedLoginCount: 0 },
    });
  }

  async recordSuccessfulLogin(id: string, at: Date): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: at },
    });
  }

  async changePassword({
    accountId,
    passwordHash,
    at,
    keepSessionId,
    event,
  }: PasswordChange): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: accountId },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
      }),
      this.prisma.userRefreshToken.updateMany({
        where: {
          userId: accountId,
          revokedAt: null,
          ...(keepSessionId ? { NOT: { familyId: keepSessionId } } : {}),
        },
        data: { revokedAt: at },
      }),
      this.prisma.accessAuditLog.create({ data: toAuditRow(event) }),
    ]);
  }
}

const toTokenData = (token: NewRefreshToken<StaffTokenScope>) => ({
  userId: token.subjectId,
  app: token.app,
  familyId: token.familyId,
  tokenHash: token.tokenHash,
  expiresAt: token.expiresAt,
  userAgent: token.userAgent,
  ip: token.ip,
});

/** Refresh tokens da equipe interna (`user_refresh_tokens`). */
@Injectable()
export class PrismaStaffRefreshTokenStore implements RefreshTokenStore<StaffTokenScope> {
  constructor(private readonly prisma: PrismaService) {}

  async create(token: NewRefreshToken<StaffTokenScope>): Promise<void> {
    await this.prisma.userRefreshToken.create({ data: toTokenData(token) });
  }

  async findByHash(
    tokenHash: string,
  ): Promise<RefreshTokenRecord<StaffTokenScope> | null> {
    const row = await this.prisma.userRefreshToken.findUnique({
      where: { tokenHash },
    });
    if (!row) return null;
    return {
      id: row.id,
      subjectId: row.userId,
      familyId: row.familyId,
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      app: row.app,
    };
  }

  rotate(
    currentId: string,
    revokedAt: Date,
    next: NewRefreshToken<StaffTokenScope>,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // Só revoga se ainda estiver ativo: quem perder a corrida recebe `false`.
      const { count } = await tx.userRefreshToken.updateMany({
        where: { id: currentId, revokedAt: null },
        data: { revokedAt },
      });
      if (count === 0) return false;
      await tx.userRefreshToken.create({ data: toTokenData(next) });
      return true;
    });
  }

  async revokeFamily(familyId: string, at: Date): Promise<void> {
    await this.prisma.userRefreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: at },
    });
  }

  async hasActiveInFamily(familyId: string): Promise<boolean> {
    const active = await this.prisma.userRefreshToken.findFirst({
      where: { familyId, revokedAt: null },
      select: { id: true },
    });
    return active !== null;
  }
}
