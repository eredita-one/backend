import { randomUUID } from 'node:crypto';
import {
  type AccessProfile,
  GENERAL_ADMIN_PROFILE_ID,
} from '../../src/modules/accounts/domain/access/access-profile.js';
import type { ClientAccount } from '../../src/modules/accounts/domain/accounts.js';
import { hashPassword } from '../../src/modules/accounts/domain/password-hashing.js';
import type { StaffRow } from './in-memory-stores.js';
import type { TestApp } from './test-app.js';

export const PASSWORD = 'Senha-Forte-2026!';
export const CLIENT_PASSWORD = 'Outra-Senha-do-Cliente!';

let passwordHash: Promise<string> | undefined;
let clientPasswordHash: Promise<string> | undefined;

/** Hash calculado uma vez só: argon2 é lento de propósito. */
const hashes = async () => {
  passwordHash ??= hashPassword(PASSWORD);
  clientPasswordHash ??= hashPassword(CLIENT_PASSWORD);
  return { staff: await passwordHash, client: await clientPasswordHash };
};

export async function addStaff(
  t: TestApp,
  email: string,
  profiles: AccessProfile[],
  overrides: Partial<StaffRow> = {},
): Promise<StaffRow> {
  return t.staff.addUser(
    {
      id: randomUUID(),
      email,
      name: email.split('@')[0]!,
      passwordHash: (await hashes()).staff,
      status: 'ACTIVE',
      ...overrides,
    },
    profiles,
  );
}

async function addClient(
  t: TestApp,
  email: string,
  overrides: Partial<ClientAccount> = {},
): Promise<ClientAccount> {
  return t.clientAccounts.add({
    id: randomUUID(),
    email,
    name: email.split('@')[0]!,
    passwordHash: (await hashes()).client,
    status: 'ACTIVE',
    failedLoginCount: 0,
    lockedUntil: null,
    ...overrides,
  });
}

/**
 * Cenário padrão. O perfil "Administrador geral" já existe: a aplicação o cria ao subir
 * (SystemProfileSync), como em produção.
 */
export async function seedAccounts(t: TestApp) {
  const generalAdmin = t.staff.profiles.get(GENERAL_ADMIN_PROFILE_ID)!;
  const consultor = t.staff.addProfile({
    app: 'CONSULTOR',
    name: 'Consultor',
    permissions: ['consultor.portfolio.view', 'consultor.earnings.view'],
  });
  const operations = t.staff.addProfile({
    app: 'ADMIN',
    name: 'Operações',
    permissions: [
      'admin.clients.view',
      'admin.requests.view',
      'admin.requests.handle',
    ],
  });

  return {
    profiles: { generalAdmin, consultor, operations },
    admin: await addStaff(t, 'admin@eredita.test', [generalAdmin]),
    consultor: await addStaff(t, 'consultor@eredita.test', [consultor]),
    /** Admin restrita (Operações) e consultora. */
    adminConsultor: await addStaff(t, 'gestora@eredita.test', [
      operations,
      consultor,
    ]),
    pendingInvite: await addStaff(t, 'convidado@eredita.test', [consultor], {
      passwordHash: null,
    }),
    disabled: await addStaff(t, 'desligado@eredita.test', [operations], {
      status: 'DISABLED',
    }),
    cliente: await addClient(t, 'cliente@exemplo.test'),
    /** Mesmo e-mail nos dois domínios, com senhas diferentes. */
    dualStaff: await addStaff(t, 'duplo@exemplo.test', [consultor]),
    dualClient: await addClient(t, 'duplo@exemplo.test'),
  };
}

export type Accounts = Awaited<ReturnType<typeof seedAccounts>>;

/** Faz login na equipe e devolve o access token. */
export async function staffToken(t: TestApp, email: string, app: string) {
  const res = await t
    .http()
    .post('/auth/staff/login')
    .send({ email, password: PASSWORD, app })
    .expect(200);
  return res.body.accessToken as string;
}
