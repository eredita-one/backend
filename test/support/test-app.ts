import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { AUDIT_TRAIL } from '../../src/modules/accounts/domain/access/access-events.js';
import { ACCESS_UNIT_OF_WORK } from '../../src/modules/accounts/domain/access/access-repository.js';
import {
  CLIENT_ACCOUNTS,
  type ClientAccount,
  STAFF_ACCOUNTS,
} from '../../src/modules/accounts/domain/accounts.js';
import { CLOCK } from '../../src/modules/accounts/domain/clock.js';
import {
  CLIENT_REFRESH_TOKENS,
  type ClientTokenScope,
  STAFF_REFRESH_TOKENS,
  type StaffTokenScope,
} from '../../src/modules/accounts/domain/refresh-tokens.js';
import {
  FakeClock,
  InMemoryAccountStore,
  InMemoryRefreshTokenStore,
  InMemoryStaffDirectory,
} from './in-memory-stores.js';
import { ProbeController } from './probe.controller.js';

/**
 * Sobe o AppModule de verdade (guards, pipes, filtro, JWT, sincronização do perfil do
 * sistema), trocando só a persistência por memória e o relógio por um controlável.
 */
export async function createTestApp() {
  const staff = new InMemoryStaffDirectory();
  const clientAccounts = new InMemoryAccountStore<ClientAccount>();
  const staffTokens = new InMemoryRefreshTokenStore<StaffTokenScope>();
  const clientTokens = new InMemoryRefreshTokenStore<ClientTokenScope>();
  const clock = new FakeClock();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [ProbeController],
  })
    .overrideProvider(PrismaService)
    .useValue({})
    .overrideProvider(STAFF_ACCOUNTS)
    .useValue(staff)
    .overrideProvider(ACCESS_UNIT_OF_WORK)
    .useValue(staff)
    .overrideProvider(AUDIT_TRAIL)
    .useValue(staff)
    .overrideProvider(CLIENT_ACCOUNTS)
    .useValue(clientAccounts)
    .overrideProvider(STAFF_REFRESH_TOKENS)
    .useValue(staffTokens)
    .overrideProvider(CLIENT_REFRESH_TOKENS)
    .useValue(clientTokens)
    .overrideProvider(CLOCK)
    .useValue(clock)
    .compile();

  const app: INestApplication<App> = moduleRef.createNestApplication({
    logger: false,
  });
  await app.init();

  return {
    app,
    http: () => request(app.getHttpServer()),
    staff,
    clientAccounts,
    staffTokens,
    clientTokens,
    clock,
  };
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;
