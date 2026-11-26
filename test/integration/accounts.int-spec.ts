import { GENERAL_ADMIN_PROFILE_ID } from '../../src/modules/accounts/domain/access/access-profile.js';
import { permissionsOfApp } from '../../src/modules/accounts/domain/permissions.js';
import { createIntegrationApp, type IntegrationApp } from './support.js';

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
