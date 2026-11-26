import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../../config/env.js';
import { AccessManagementService } from './application/access-management.service.js';
import { ClientAuthService } from './application/client-auth.service.js';
import { SessionService } from './application/session.service.js';
import { StaffAuthService } from './application/staff-auth.service.js';
import { SystemProfileSync } from './application/system-profile.sync.js';
import { AUDIT_TRAIL } from './domain/access/access-events.js';
import { ACCESS_UNIT_OF_WORK } from './domain/access/access-repository.js';
import { CLIENT_ACCOUNTS, STAFF_ACCOUNTS } from './domain/accounts.js';
import { AUTH_CONFIG, type AuthConfig } from './domain/auth-config.js';
import { CLOCK, systemClock } from './domain/clock.js';
import { PasswordAuthenticator } from './domain/password-authenticator.js';
import { PasswordHasher } from './domain/password-hasher.js';
import {
  CLIENT_REFRESH_TOKENS,
  STAFF_REFRESH_TOKENS,
} from './domain/refresh-tokens.js';
import { AccessGuard } from './http/access.guard.js';
import {
  AdminAccessAuditController,
  AdminAccessProfilesController,
  AdminStaffUsersController,
} from './http/admin-access.controllers.js';
import { ClientAuthController } from './http/client-auth.controller.js';
import { StaffAuthController } from './http/staff-auth.controller.js';
import {
  PrismaAccessUnitOfWork,
  PrismaAuditTrail,
} from './infrastructure/prisma/access.repository.js';
import {
  PrismaClientAccountStore,
  PrismaClientRefreshTokenStore,
} from './infrastructure/prisma/client-account.stores.js';
import {
  PrismaStaffAccountStore,
  PrismaStaffRefreshTokenStore,
} from './infrastructure/prisma/staff-account.stores.js';
import { AccessTokenService } from './infrastructure/jwt-access-tokens.js';

const HOUR_MS = 60 * 60 * 1000;

export function authConfigFromEnv(
  config: ConfigService<Env, true>,
): AuthConfig {
  const get = <K extends keyof Env>(key: K) => config.get(key, { infer: true });
  return {
    issuer: get('JWT_ISSUER'),
    secrets: {
      staff: get('JWT_STAFF_SECRET'),
      client: get('JWT_CLIENT_SECRET'),
    },
    accessTokenTtlSeconds: get('ACCESS_TOKEN_TTL_SECONDS'),
    refreshTokenTtlMs: get('REFRESH_TOKEN_TTL_HOURS') * HOUR_MS,
    refreshTokenRememberTtlMs:
      get('REFRESH_TOKEN_REMEMBER_DAYS') * 24 * HOUR_MS,
    refreshReuseGraceMs: get('REFRESH_TOKEN_REUSE_GRACE_SECONDS') * 1000,
    maxFailedLogins: get('LOGIN_MAX_ATTEMPTS'),
    lockDurationMs: get('LOGIN_LOCK_MINUTES') * 60 * 1000,
  };
}

/**
 * Contexto Contas (identidade e acesso): login dos dois domínios, perfis de acesso,
 * permissões e auditoria. O `AccessGuard` é global: toda rota da API passa por ele.
 *
 * Outros módulos importam só de `./index.ts`.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [
    StaffAuthController,
    ClientAuthController,
    AdminAccessProfilesController,
    AdminStaffUsersController,
    AdminAccessAuditController,
  ],
  providers: [
    {
      provide: AUTH_CONFIG,
      inject: [ConfigService],
      useFactory: authConfigFromEnv,
    },
    { provide: CLOCK, useValue: systemClock },
    PasswordHasher,
    PasswordAuthenticator,
    AccessTokenService,
    SessionService,
    StaffAuthService,
    ClientAuthService,
    AccessManagementService,
    SystemProfileSync,
    { provide: STAFF_ACCOUNTS, useClass: PrismaStaffAccountStore },
    { provide: STAFF_REFRESH_TOKENS, useClass: PrismaStaffRefreshTokenStore },
    { provide: CLIENT_ACCOUNTS, useClass: PrismaClientAccountStore },
    { provide: CLIENT_REFRESH_TOKENS, useClass: PrismaClientRefreshTokenStore },
    { provide: ACCESS_UNIT_OF_WORK, useClass: PrismaAccessUnitOfWork },
    { provide: AUDIT_TRAIL, useClass: PrismaAuditTrail },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
})
export class AccountsModule {}
