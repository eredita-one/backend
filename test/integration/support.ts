import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import type { StaffApp } from '../../src/generated/prisma/client.js';
import { CLOCK } from '../../src/modules/accounts/domain/clock.js';
import { hashPassword } from '../../src/modules/accounts/domain/password-hashing.js';
import { FakeClock } from '../support/in-memory-stores.js';
import { assertTestDatabase } from './database.js';

export const PASSWORD = 'Senha-Forte-Integracao-2026';

const TABLES = [
  'access_audit_log',
  'user_refresh_tokens',
  'client_refresh_tokens',
  'user_access_profiles',
  'access_profile_permissions',
  'access_profiles',
  'client_accounts',
  'users',
];

let passwordHash: Promise<string> | undefined;

/**
 * Sobe o AppModule inteiro com a persistência REAL (Prisma + Postgres de teste).
 * Só o relógio é trocado, para testar expiração e tolerância sem esperar.
 * `reset: false` sobe de novo sobre os dados existentes (simula um novo deploy).
 */
export async function createIntegrationApp({ reset = true } = {}) {
  assertTestDatabase(process.env.DATABASE_URL!);
  const clock = new FakeClock();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CLOCK)
    .useValue(clock)
    .compile();
  const app: INestApplication<App> = moduleRef.createNestApplication({
    logger: false,
  });
  const prisma = app.get(PrismaService);

  if (reset) {
    await prisma.$executeRawUnsafe(
      `TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} CASCADE`,
    );
  }
  // init dispara a sincronização do Administrador geral, como num deploy.
  await app.init();

  const http = () => request(app.getHttpServer());

  return {
    app,
    prisma,
    clock,
    http,

    async createProfile(app: StaffApp, name: string, permissions: string[]) {
      return prisma.accessProfile.create({
        data: {
          app,
          name,
          permissions: {
            create: permissions.map((permission) => ({ permission })),
          },
        },
      });
    },

    async createStaff(email: string, profileIds: string[]) {
      passwordHash ??= hashPassword(PASSWORD);
      return prisma.user.create({
        data: {
          email,
          name: email.split('@')[0]!,
          passwordHash: await passwordHash,
          accessProfiles: {
            create: profileIds.map((profileId) => ({ profileId })),
          },
        },
      });
    },

    async login(email: string, app: StaffApp) {
      const res = await http()
        .post('/auth/staff/login')
        .send({ email, password: PASSWORD, app })
        .expect(200);
      return res.body as { accessToken: string; refreshToken: string };
    },
  };
}

export type IntegrationApp = Awaited<ReturnType<typeof createIntegrationApp>>;
