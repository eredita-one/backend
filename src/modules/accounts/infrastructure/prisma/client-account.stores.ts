import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/prisma/prisma.service.js';
import type { Prisma } from '../../../../generated/prisma/client.js';
import type {
  AccountStore,
  ClientAccount,
  PasswordChange,
} from '../../domain/accounts.js';
import type {
  ClientTokenScope,
  NewRefreshToken,
  RefreshTokenRecord,
  RefreshTokenStore,
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
} satisfies Prisma.ClientAccountSelect;

/** Contas do portal do cliente (`client_accounts`). Não toca nas tabelas da equipe. */
@Injectable()
export class PrismaClientAccountStore implements AccountStore<ClientAccount> {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<ClientAccount | null> {
    return this.prisma.clientAccount.findUnique({
      where: { email },
      select: accountSelect,
    });
  }

  findById(id: string): Promise<ClientAccount | null> {
    return this.prisma.clientAccount.findUnique({
      where: { id },
      select: accountSelect,
    });
  }

  async incrementFailedLogins(id: string): Promise<number> {
    const { failedLoginCount } = await this.prisma.clientAccount.update({
      where: { id },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    return failedLoginCount;
  }

  async lock(id: string, until: Date): Promise<void> {
    await this.prisma.clientAccount.update({
      where: { id },
      data: { lockedUntil: until, failedLoginCount: 0 },
    });
  }

  async recordSuccessfulLogin(id: string, at: Date): Promise<void> {
    await this.prisma.clientAccount.update({
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
      this.prisma.clientAccount.update({
        where: { id: accountId },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
      }),
      this.prisma.clientRefreshToken.updateMany({
        where: {
          clientAccountId: accountId,
          revokedAt: null,
          ...(keepSessionId ? { NOT: { familyId: keepSessionId } } : {}),
        },
        data: { revokedAt: at },
      }),
      this.prisma.accessAuditLog.create({ data: toAuditRow(event) }),
    ]);
  }
}

const toTokenData = (token: NewRefreshToken<ClientTokenScope>) => ({
  clientAccountId: token.subjectId,
  familyId: token.familyId,
  tokenHash: token.tokenHash,
  expiresAt: token.expiresAt,
  userAgent: token.userAgent,
  ip: token.ip,
});

/** Refresh tokens do portal do cliente (`client_refresh_tokens`). */
@Injectable()
export class PrismaClientRefreshTokenStore implements RefreshTokenStore<ClientTokenScope> {
  constructor(private readonly prisma: PrismaService) {}

  async create(token: NewRefreshToken<ClientTokenScope>): Promise<void> {
    await this.prisma.clientRefreshToken.create({ data: toTokenData(token) });
  }

  async findByHash(
    tokenHash: string,
  ): Promise<RefreshTokenRecord<ClientTokenScope> | null> {
    const row = await this.prisma.clientRefreshToken.findUnique({
      where: { tokenHash },
    });
    if (!row) return null;
    return {
      id: row.id,
      subjectId: row.clientAccountId,
      familyId: row.familyId,
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
    };
  }

  rotate(
    currentId: string,
    revokedAt: Date,
    next: NewRefreshToken<ClientTokenScope>,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.clientRefreshToken.updateMany({
        where: { id: currentId, revokedAt: null },
        data: { revokedAt },
      });
      if (count === 0) return false;
      await tx.clientRefreshToken.create({ data: toTokenData(next) });
      return true;
    });
  }

  async revokeFamily(familyId: string, at: Date): Promise<void> {
    await this.prisma.clientRefreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: at },
    });
  }

  async hasActiveInFamily(familyId: string): Promise<boolean> {
    const active = await this.prisma.clientRefreshToken.findFirst({
      where: { familyId, revokedAt: null },
      select: { id: true },
    });
    return active !== null;
  }
}
