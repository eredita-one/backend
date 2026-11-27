import { GENERAL_ADMIN_PROFILE_ID } from '../../src/modules/accounts/domain/access/access-profile.js';
import { hashPassword } from '../../src/modules/accounts/domain/password-hashing.js';
import { permissionsOfApp } from '../../src/modules/accounts/domain/permissions.js';
import {
  createIntegrationApp,
  type IntegrationApp,
  PASSWORD,
} from './support.js';

/**
 * Integração com Postgres real: cobre o que os e2e em memória não alcançam (consultas
 * Prisma, transações, advisory lock, constraints do banco).
 */
describe('Contas com Postgres real', () => {
  let t: IntegrationApp;

  beforeEach(async () => {
    t = await createIntegrationApp();
  });

  afterEach(() => t.app.close());

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const generalAdminHolders = () =>
    t.prisma.userAccessProfile.count({
      where: { profileId: GENERAL_ADMIN_PROFILE_ID },
    });

  it('sincroniza o Administrador geral ao subir, inclusive permissão que faltar', async () => {
    const rows = await t.prisma.accessProfilePermission.findMany({
      where: { profileId: GENERAL_ADMIN_PROFILE_ID },
    });
    expect(rows.map((r) => r.permission).sort()).toEqual(
      [...permissionsOfApp('ADMIN')].sort(),
    );

    // Simula uma permissão nova no código: falta no banco e entra no próximo deploy.
    await t.prisma.accessProfilePermission.delete({
      where: {
        profileId_permission: {
          profileId: GENERAL_ADMIN_PROFILE_ID,
          permission: 'admin.help.publish',
        },
      },
    });
    await t.app.close();
    t = await createIntegrationApp({ reset: false });

    expect(
      await t.prisma.accessProfilePermission.count({
        where: {
          profileId: GENERAL_ADMIN_PROFILE_ID,
          permission: 'admin.help.publish',
        },
      }),
    ).toBe(1);
    const synced = await t.prisma.accessAuditLog.findFirst({
      where: { type: 'SystemProfileSynced' },
    });
    expect(synced?.data).toEqual({
      added: ['admin.help.publish'],
      removed: [],
    });
  });

  it('sessão: rotação, reuso detectado e sessão inteira revogada no banco', async () => {
    const user = await t.createStaff('admin@int.test', [
      GENERAL_ADMIN_PROFILE_ID,
    ]);
    const session = await t.login('admin@int.test', 'ADMIN');

    const rotated = await t
      .http()
      .post('/auth/staff/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(200);

    t.clock.advance(11_000);
    await t
      .http()
      .post('/auth/staff/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(401);
    await t
      .http()
      .post('/auth/staff/refresh')
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(401);

    expect(
      await t.prisma.userRefreshToken.count({
        where: { userId: user.id, revokedAt: null },
      }),
    ).toBe(0);
    expect(
      await t.prisma.accessAuditLog.count({
        where: { type: 'SessionReuseDetected', subjectId: user.id },
      }),
    ).toBe(1);
  });

  it('concessão e auditoria gravadas juntas; tentativa negada não grava nada', async () => {
    const rh = await t.createProfile('ADMIN', 'RH', [
      'admin.access.users.manage',
      'admin.clients.view',
    ]);
    const rhUser = await t.createStaff('rh@int.test', [rh.id]);
    const target = await t.createStaff('alvo@int.test', []);
    const operations = await t.createProfile('ADMIN', 'Operações', [
      'admin.clients.view',
    ]);
    const { accessToken } = await t.login('rh@int.test', 'ADMIN');

    await t
      .http()
      .put(`/admin/staff-users/${target.id}/access-profiles/${operations.id}`)
      .set(bearer(accessToken))
      .expect(200);
    const denied = await t
      .http()
      .put(
        `/admin/staff-users/${target.id}/access-profiles/${GENERAL_ADMIN_PROFILE_ID}`,
      )
      .set(bearer(accessToken))
      .expect(403);
    expect(denied.body.code).toBe('ACCESS_ESCALATION_DENIED');

    const assigned = await t.prisma.userAccessProfile.findMany({
      where: { userId: target.id },
    });
    expect(assigned).toMatchObject([
      { profileId: operations.id, grantedBy: rhUser.id },
    ]);
    const events = await t.prisma.accessAuditLog.findMany({
      where: { subjectId: target.id },
    });
    expect(events).toMatchObject([
      {
        type: 'AccessProfileGranted',
        actorId: rhUser.id,
        data: { profileName: 'Operações', app: 'ADMIN' },
      },
    ]);
  });

  describe('trava das mudanças de acesso (advisory lock)', () => {
    let viceToken: string;

    beforeEach(async () => {
      // Perfil comum com todas as permissões do admin: pode mexer no Administrador geral.
      const vice = await t.createProfile(
        'ADMIN',
        'Vice',
        permissionsOfApp('ADMIN'),
      );
      await t.createStaff('vice@int.test', [vice.id]);
      viceToken = (await t.login('vice@int.test', 'ADMIN')).accessToken;
    });

    /** Cada rodada: exatamente dois Administradores gerais, mexidos ao mesmo tempo. */
    async function race(
      round: number,
      action: (userId: string) => Promise<{ status: number }>,
    ) {
      await t.prisma.userAccessProfile.deleteMany({
        where: { profileId: GENERAL_ADMIN_PROFILE_ID },
      });
      const a = await t.createStaff(`a${round}@int.test`, [
        GENERAL_ADMIN_PROFILE_ID,
      ]);
      const b = await t.createStaff(`b${round}@int.test`, [
        GENERAL_ADMIN_PROFILE_ID,
      ]);
      const results = await Promise.all([action(a.id), action(b.id)]);
      return results.map((r) => r.status).sort((x, y) => x - y);
    }

    it('duas revogações simultâneas: uma passa, a outra recebe 409', async () => {
      for (let round = 0; round < 5; round++) {
        const statuses = await race(round, (userId) =>
          t
            .http()
            .delete(
              `/admin/staff-users/${userId}/access-profiles/${GENERAL_ADMIN_PROFILE_ID}`,
            )
            .set(bearer(viceToken)),
        );
        expect(statuses).toEqual([200, 409]);
        expect(await generalAdminHolders()).toBe(1);
      }
    });

    it('duas desativações simultâneas: uma passa, a outra recebe 409', async () => {
      for (let round = 0; round < 5; round++) {
        const statuses = await race(round, (userId) =>
          t
            .http()
            .post(`/admin/staff-users/${userId}/disable`)
            .set(bearer(viceToken)),
        );
        expect(statuses).toEqual([200, 409]);
        expect(
          await t.prisma.userAccessProfile.count({
            where: {
              profileId: GENERAL_ADMIN_PROFILE_ID,
              user: { status: 'ACTIVE' },
            },
          }),
        ).toBe(1);
      }
    });
  });

  it('auditoria paginada no banco: total, busca, período e páginas sem repetir', async () => {
    const admin = await t.createStaff('admin@int.test', [
      GENERAL_ADMIN_PROFILE_ID,
    ]);
    const { accessToken } = await t.login('admin@int.test', 'ADMIN');
    const client = await t.prisma.clientAccount.create({
      data: { email: 'cliente.busca@int.test', name: 'Cliente Buscável' },
    });
    await t.prisma.accessAuditLog.deleteMany({});

    // 12 eventos no MESMO instante (o desempate pelo id evita repetir/pular entre páginas),
    // mais 1 sobre o cliente, em outro dia.
    const sameInstant = new Date('2026-11-10T12:00:00Z');
    await t.prisma.accessAuditLog.createMany({
      data: [
        ...Array.from({ length: 12 }, (_, i) => ({
          type: 'AccessProfileGranted',
          actorId: admin.id,
          subjectType: 'staff_user',
          subjectId: admin.id,
          data: { n: i },
          occurredAt: sameInstant,
        })),
        {
          type: 'PasswordChanged',
          actorId: client.id,
          subjectType: 'client_account',
          subjectId: client.id,
          data: {},
          occurredAt: new Date('2026-11-20T09:00:00Z'),
        },
      ],
    });
    const get = (query: string) =>
      t
        .http()
        .get(`/admin/access-audit${query}`)
        .set(bearer(accessToken))
        .expect(200)
        .then((res) => res.body as { total: number; items: { id: string }[] });

    const pages = await Promise.all(
      [1, 2, 3].map((page) => get(`?pageSize=5&page=${page}`)),
    );
    const ids = pages.flatMap((p) => p.items.map((item) => item.id));
    expect(pages[0]!.total).toBe(13);
    expect(ids).toHaveLength(13);
    expect(new Set(ids).size).toBe(13);

    // Busca sem diferenciar maiúsculas, inclusive em contas de cliente.
    expect((await get('?search=BUSCÁVEL')).total).toBe(1);
    expect((await get('?search=admin@INT')).total).toBe(12);
    // Período em dias UTC, `to` inclusivo.
    expect((await get('?from=2026-11-20&to=2026-11-20')).total).toBe(1);
    expect((await get('?to=2026-11-10')).total).toBe(12);
  });

  describe('dados e senha', () => {
    const NEW_PASSWORD = 'Senha-Nova-Integracao-2026';

    it('admin edita e define a senha: tudo na mesma transação, sessões revogadas no banco', async () => {
      await t.createStaff('admin@int.test', [GENERAL_ADMIN_PROFILE_ID]);
      const target = await t.createStaff('alvo@int.test', []);
      await t.prisma.user.update({
        where: { id: target.id },
        data: {
          failedLoginCount: 3,
          lockedUntil: new Date(Date.now() + 60_000),
        },
      });
      await t.prisma.userRefreshToken.create({
        data: {
          userId: target.id,
          app: 'ADMIN',
          familyId: '00000000-0000-4000-8000-000000000001',
          tokenHash: 'a'.repeat(64),
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      const { accessToken } = await t.login('admin@int.test', 'ADMIN');

      // E-mail de outra pessoa: recusado antes de gravar qualquer coisa.
      const taken = await t
        .http()
        .patch(`/admin/staff-users/${target.id}`)
        .set(bearer(accessToken))
        .send({ name: 'Não grava', email: 'ADMIN@int.test' })
        .expect(409);
      expect(taken.body.code).toBe('STAFF_USER_EMAIL_TAKEN');
      expect(
        await t.prisma.accessAuditLog.count({
          where: { subjectId: target.id },
        }),
      ).toBe(0);

      await t
        .http()
        .patch(`/admin/staff-users/${target.id}`)
        .set(bearer(accessToken))
        .send({
          name: 'Alvo Novo',
          email: 'Alvo.Novo@int.test',
          password: NEW_PASSWORD,
        })
        .expect(200);

      const row = await t.prisma.user.findUniqueOrThrow({
        where: { id: target.id },
      });
      expect(row).toMatchObject({
        name: 'Alvo Novo',
        email: 'alvo.novo@int.test',
        failedLoginCount: 0,
        lockedUntil: null,
      });
      expect(row.passwordHash).not.toBe(target.passwordHash);
      expect(
        await t.prisma.userRefreshToken.count({
          where: { userId: target.id, revokedAt: null },
        }),
      ).toBe(0);
      const events = await t.prisma.accessAuditLog.findMany({
        where: { subjectId: target.id },
        orderBy: { type: 'asc' },
      });
      expect(events.map((e) => e.type)).toEqual([
        'StaffUserPasswordReset',
        'StaffUserUpdated',
      ]);
      await t
        .http()
        .post('/auth/staff/login')
        .send({
          email: 'alvo.novo@int.test',
          password: NEW_PASSWORD,
          app: 'ADMIN',
        })
        .expect(403); // senha certa; sem perfil do admin, o app é recusado
    });

    it('troca da própria senha: mantém a sessão atual e revoga as outras no banco', async () => {
      const user = await t.createStaff('pessoa@int.test', [
        GENERAL_ADMIN_PROFILE_ID,
      ]);
      const current = await t.login('pessoa@int.test', 'ADMIN');
      const other = await t.login('pessoa@int.test', 'ADMIN');

      await t
        .http()
        .post('/auth/staff/password')
        .set(bearer(current.accessToken))
        .send({
          currentPassword: PASSWORD,
          newPassword: NEW_PASSWORD,
          refreshToken: current.refreshToken,
        })
        .expect(204);

      const active = await t.prisma.userRefreshToken.findMany({
        where: { userId: user.id, revokedAt: null },
      });
      expect(active).toHaveLength(1);
      await t
        .http()
        .post('/auth/staff/refresh')
        .send({ refreshToken: current.refreshToken })
        .expect(200);
      await t
        .http()
        .post('/auth/staff/refresh')
        .send({ refreshToken: other.refreshToken })
        .expect(401);
      expect(
        await t.prisma.accessAuditLog.findFirst({
          where: { type: 'PasswordChanged', subjectId: user.id },
        }),
      ).toMatchObject({ actorId: user.id, subjectType: 'staff_user' });
    });

    it('cliente troca a própria senha nas tabelas do cliente', async () => {
      const client = await t.prisma.clientAccount.create({
        data: {
          email: 'cliente@int.test',
          name: 'Cliente',
          passwordHash: await hashPassword(PASSWORD),
        },
      });
      const login = () =>
        t
          .http()
          .post('/auth/client/login')
          .send({ email: 'cliente@int.test', password: PASSWORD })
          .expect(200);
      const current = (await login()).body;
      await login();

      await t
        .http()
        .post('/auth/client/password')
        .set(bearer(current.accessToken))
        .send({
          currentPassword: PASSWORD,
          newPassword: NEW_PASSWORD,
          refreshToken: current.refreshToken,
        })
        .expect(204);

      expect(
        await t.prisma.clientRefreshToken.count({
          where: { clientAccountId: client.id, revokedAt: null },
        }),
      ).toBe(1);
      await t
        .http()
        .post('/auth/client/login')
        .send({ email: 'cliente@int.test', password: NEW_PASSWORD })
        .expect(200);
      expect(
        await t.prisma.accessAuditLog.count({
          where: { type: 'PasswordChanged', subjectType: 'client_account' },
        }),
      ).toBe(1);
    });
  });

  it('constraints do banco: e-mail minúsculo, perfil em uso, nome sem diferenciar maiúsculas', async () => {
    await t.createStaff('admin@int.test', [GENERAL_ADMIN_PROFILE_ID]);
    const { accessToken } = await t.login('admin@int.test', 'ADMIN');

    // E-mail: a API normaliza; se algo escapar, o CHECK do banco recusa.
    await t
      .http()
      .post('/admin/staff-users')
      .set(bearer(accessToken))
      .send({ email: ' Nova@Int.TEST ', name: 'Nova' })
      .expect(201);
    expect(
      await t.prisma.user.count({ where: { email: 'nova@int.test' } }),
    ).toBe(1);
    await expect(
      t.prisma.user.create({ data: { email: 'Outra@Int.test', name: 'x' } }),
    ).rejects.toThrow(/users_email_lowercase/);

    // Nome de perfil: "FINANCEIRO" colide com "Financeiro".
    await t
      .http()
      .post('/admin/access-profiles')
      .set(bearer(accessToken))
      .send({ app: 'ADMIN', name: 'Financeiro', permissions: [] })
      .expect(201);
    const duplicate = await t
      .http()
      .post('/admin/access-profiles')
      .set(bearer(accessToken))
      .send({ app: 'ADMIN', name: 'FINANCEIRO', permissions: [] })
      .expect(409);
    expect(duplicate.body.code).toBe('ACCESS_PROFILE_NAME_TAKEN');

    // Perfil em uso: além da regra do domínio, a FK do banco impede apagar.
    await expect(
      t.prisma.accessProfile.delete({
        where: { id: GENERAL_ADMIN_PROFILE_ID },
      }),
    ).rejects.toThrow();
  });
});
