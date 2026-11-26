/**
 * Seed (idempotente: pode rodar várias vezes).
 *  - Garante o perfil do sistema "Administrador geral" e os perfis padrão dos apps
 *    Consultor e Contábil (sem eles, ninguém consegue entrar nesses apps).
 *  - Cria o primeiro administrador a partir do ambiente, com o Administrador geral e os
 *    perfis de SEED_ADMIN_EXTRA_PROFILES (ex.: "Consultor, Commercialista"), para que ele
 *    também entre nos outros apps da equipe. Ninguém altera o próprio acesso pela API,
 *    então este é o único momento em que o primeiro admin recebe esses perfis sozinho.
 *  - Com SEED_DEMO_ACCOUNTS=true (nunca em produção), cria contas de demonstração.
 *
 * Perfis só são atribuídos na CRIAÇÃO da conta. Se a conta já existe, o seed não mexe
 * nos perfis dela: senão, um acesso revogado pelo admin voltaria a cada `db:seed`, por
 * fora das regras e da auditoria. Tudo o que o seed cria vai para a auditoria com ator
 * nulo (sistema).
 *
 *   pnpm db:seed
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { type Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { generalAdminProfile } from '../src/modules/accounts/domain/access/access-profile.js';
import type { StaffApp } from '../src/modules/accounts/domain/apps.js';
import { hashPassword } from '../src/modules/accounts/domain/password-hashing.js';
import type { Permission } from '../src/modules/accounts/domain/permissions.js';
import { parseProfileRefs, resolveProfileRefs } from './seed-support.js';

const MIN_PASSWORD_LENGTH = 12;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Defina ${name} no .env para rodar o seed.`);
  return value;
}

function password(name: string): string {
  const value = required(name);
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `${name} precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`,
    );
  }
  return value;
}

const prisma = new PrismaClient({
  adapter: new PrismaPg(required('DATABASE_URL')),
});

async function audit(
  type: string,
  subjectType: string,
  subjectId: string,
  data: Prisma.InputJsonObject,
) {
  await prisma.accessAuditLog.create({
    data: {
      type,
      actorId: null,
      subjectType,
      subjectId,
      data,
      occurredAt: new Date(),
    },
  });
}

/** Cria o perfil se não existir (por app + nome). Não altera perfis existentes. */
async function ensureProfile(
  app: StaffApp,
  name: string,
  description: string,
  permissions: Permission[],
  id?: string,
  isSystem = false,
): Promise<string> {
  const existing = await prisma.accessProfile.findUnique({
    where: { app_name: { app, name } },
    select: { id: true },
  });
  if (existing) return existing.id;

  const profile = await prisma.accessProfile.create({
    data: {
      id,
      app,
      name,
      description,
      isSystem,
      permissions: {
        create: permissions.map((permission) => ({ permission })),
      },
    },
  });
  await audit('AccessProfileCreated', 'access_profile', profile.id, {
    app,
    name,
    permissions,
  });
  console.log(`  perfil  ${app} · ${name}`);
  return profile.id;
}

/**
 * Cria o usuário com os perfis iniciais. Se já existir, não muda nada (nem senha, nem
 * perfis) e devolve `false`.
 */
async function createStaffIfMissing(
  email: string,
  name: string,
  plainPassword: string,
  profileIds: string[],
): Promise<boolean> {
  const normalized = email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email: normalized } })) {
    console.log(`  equipe  ${normalized} (já existe: perfis não alterados)`);
    return false;
  }

  const user = await prisma.user.create({
    data: {
      email: normalized,
      name,
      passwordHash: await hashPassword(plainPassword),
    },
  });
  await audit('StaffUserCreated', 'staff_user', user.id, {
    email: normalized,
    name,
  });

  const profiles = await prisma.accessProfile.findMany({
    where: { id: { in: profileIds } },
  });
  for (const profile of profiles) {
    await prisma.userAccessProfile.create({
      data: { userId: user.id, profileId: profile.id, grantedBy: null },
    });
    await audit('AccessProfileGranted', 'staff_user', user.id, {
      profileId: profile.id,
      profileName: profile.name,
      app: profile.app,
    });
  }
  console.log(
    `  equipe  ${normalized} → ${profiles.map((p) => `${p.app}:${p.name}`).join(', ')}`,
  );
  return true;
}

async function ensureClient(
  email: string,
  name: string,
  plainPassword: string,
) {
  const normalized = email.toLowerCase();
  await prisma.clientAccount.upsert({
    where: { email: normalized },
    update: {},
    create: {
      email: normalized,
      name,
      passwordHash: await hashPassword(plainPassword),
    },
  });
  console.log(`  cliente ${normalized}`);
}

async function main() {
  console.log('Seed:');

  const admin = generalAdminProfile();
  const generalAdmin = await ensureProfile(
    admin.app,
    admin.name,
    admin.description!,
    admin.permissions,
    admin.id,
    true,
  );
  const consultor = await ensureProfile(
    'CONSULTOR',
    'Consultor',
    'Carteira, ganhos e equipe',
    [
      'consultor.portfolio.view',
      'consultor.earnings.view',
      'consultor.team.view',
    ],
  );
  const leader = await ensureProfile(
    'CONSULTOR',
    'Líder de rede',
    'Consultor que pode propor integrantes para a própria equipe',
    [
      'consultor.portfolio.view',
      'consultor.earnings.view',
      'consultor.team.view',
      'consultor.team.propose',
    ],
  );
  const commercialista = await ensureProfile(
    'CONTABIL',
    'Commercialista',
    'Acesso completo ao app contábil',
    [
      'contabil.taxpayers.view',
      'contabil.taxpayers.bank.edit',
      'contabil.cadastre.edit',
      'contabil.obligations.view',
      'contabil.obligations.edit',
      'contabil.documents.view',
      'contabil.documents.attach',
      'contabil.documents.remove',
      'contabil.reports.export',
    ],
  );

  const withDemo = process.env.SEED_DEMO_ACCOUNTS === 'true';
  if (withDemo && process.env.NODE_ENV === 'production') {
    throw new Error('SEED_DEMO_ACCOUNTS não pode ser usado em produção.');
  }
  const operations = withDemo
    ? await ensureProfile(
        'ADMIN',
        'Operações (demo)',
        'Exemplo de perfil restrito: atendimento e cadastro, sem comissões nem documentos',
        [
          'admin.clients.view',
          'admin.clients.edit',
          'admin.properties.view',
          'admin.relocation.view',
          'admin.relocation.edit',
          'admin.requests.view',
          'admin.requests.handle',
          'admin.services.view',
        ],
      )
    : null;

  // Valida os perfis extras ANTES de criar o admin: nome errado não deixa conta pela metade.
  const extraProfiles = resolveProfileRefs(
    parseProfileRefs(process.env.SEED_ADMIN_EXTRA_PROFILES),
    await prisma.accessProfile.findMany({
      select: { id: true, app: true, name: true },
    }),
  );
  const adminCreated = await createStaffIfMissing(
    required('SEED_ADMIN_EMAIL'),
    process.env.SEED_ADMIN_NAME?.trim() || 'Administrador',
    password('SEED_ADMIN_PASSWORD'),
    [generalAdmin, ...extraProfiles],
  );
  if (!adminCreated && extraProfiles.length > 0) {
    console.log(
      '  aviso   SEED_ADMIN_EXTRA_PROFILES ignorado: o admin já existe. ' +
        'Peça a outro administrador para conceder os perfis pela API.',
    );
  }

  if (withDemo && operations) {
    const demo = password('SEED_DEMO_PASSWORD');
    await createStaffIfMissing('consultor@demo.local', 'Consultor Demo', demo, [
      consultor,
    ]);
    await createStaffIfMissing('contabil@demo.local', 'Contábil Demo', demo, [
      commercialista,
    ]);
    await createStaffIfMissing('gestora@demo.local', 'Gestora Demo', demo, [
      operations,
      leader,
    ]);
    await ensureClient('cliente@demo.local', 'Cliente Demo', demo);
  }
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
