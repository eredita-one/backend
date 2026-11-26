import { GENERAL_ADMIN_PROFILE_ID } from '../src/modules/accounts/domain/access/access-profile.js';
import { permissionsOfApp } from '../src/modules/accounts/domain/permissions.js';
import {
  type Accounts,
  addStaff,
  seedAccounts,
  staffToken,
} from './support/fixtures.js';
import { createTestApp, type TestApp } from './support/test-app.js';

describe('Gestão de acessos (perfis e permissões)', () => {
  let t: TestApp;
  let accounts: Accounts;
  let adminToken: string;

  beforeEach(async () => {
    t = await createTestApp();
    accounts = await seedAccounts(t);
    adminToken = await staffToken(t, 'admin@eredita.test', 'ADMIN');
  });

  afterEach(() => t.app.close());

  const as = (token: string) => ({
    get: (path: string) => t.http().get(path).auth(token, { type: 'bearer' }),
    post: (path: string, body?: object) =>
      t.http().post(path).auth(token, { type: 'bearer' }).send(body),
    put: (path: string) => t.http().put(path).auth(token, { type: 'bearer' }),
    patch: (path: string, body: object) =>
      t.http().patch(path).auth(token, { type: 'bearer' }).send(body),
    delete: (path: string) =>
      t.http().delete(path).auth(token, { type: 'bearer' }),
  });

  const grantPath = (userId: string, profileId: string) =>
    `/admin/staff-users/${userId}/access-profiles/${profileId}`;

  describe('permissões nas rotas (@Can / @CanAny)', () => {
    it('Administrador geral é criado ao subir, com todas as permissões do admin', async () => {
      const res = await as(adminToken)
        .get('/admin/access-profiles')
        .expect(200);
      const general = res.body.find(
        (p: { id: string }) => p.id === GENERAL_ADMIN_PROFILE_ID,
      );
      expect(general).toMatchObject({
        name: 'Administrador geral',
        isSystem: true,
        userCount: 1,
        permissions: [...permissionsOfApp('ADMIN')].sort(),
      });
    });

    it('perfil restrito não acessa funcionalidade sem a permissão', async () => {
      const gestora = await staffToken(t, 'gestora@eredita.test', 'ADMIN');

      const denied = await as(gestora).get('/probe/comissoes').expect(403);
      expect(denied.body).toMatchObject({
        code: 'AUTH_PERMISSION_DENIED',
        details: { required: ['admin.commissions.view'] },
      });
      await as(adminToken).get('/probe/comissoes').expect(200);

      // @Can com várias permissões exige todas; @CanAny, uma delas.
      await as(gestora).get('/probe/editar-cliente').expect(403);
      await as(gestora).get('/probe/comissoes-ou-solicitacoes').expect(200);
    });

    it('a gestão de acessos exige permissão de gestão, no app admin', async () => {
      const gestora = await staffToken(t, 'gestora@eredita.test', 'ADMIN');
      const res = await as(gestora).get('/admin/access-profiles').expect(403);
      expect(res.body.code).toBe('AUTH_PERMISSION_DENIED');

      const consultor = await staffToken(
        t,
        'consultor@eredita.test',
        'CONSULTOR',
      );
      expect(
        (await as(consultor).get('/admin/access-profiles').expect(403)).body
          .code,
      ).toBe('AUTH_APP_FORBIDDEN');
    });

    it('permissão concedida ou revogada vale na próxima requisição, com o mesmo token', async () => {
      const gestora = await staffToken(t, 'gestora@eredita.test', 'ADMIN');
      await as(gestora).get('/probe/comissoes').expect(403);

      const finance = await as(adminToken)
        .post('/admin/access-profiles', {
          app: 'ADMIN',
          name: ' Financeiro ',
          permissions: ['admin.commissions.view', 'admin.commissions.view'],
        })
        .expect(201);
      expect(finance.body).toMatchObject({
        name: 'Financeiro',
        permissions: ['admin.commissions.view'],
        userCount: 0,
      });

      const granted = await as(adminToken)
        .put(grantPath(accounts.adminConsultor.id, finance.body.id))
        .expect(200);
      expect(
        granted.body.profiles.map((p: { name: string }) => p.name),
      ).toEqual(['Operações', 'Consultor', 'Financeiro']);
      await as(gestora).get('/probe/comissoes').expect(200);

      await as(adminToken)
        .delete(grantPath(accounts.adminConsultor.id, finance.body.id))
        .expect(200);
      await as(gestora).get('/probe/comissoes').expect(403);
    });
  });

  describe('usuários da equipe', () => {
    it('usuário novo nasce com convite pendente e não consegue entrar', async () => {
      const res = await as(adminToken)
        .post('/admin/staff-users', {
          email: ' Nova@Eredita.TEST ',
          name: 'Nova Pessoa',
          profileIds: [accounts.profiles.operations.id],
        })
        .expect(201);
      expect(res.body).toMatchObject({
        email: 'nova@eredita.test',
        invitePending: true,
        status: 'ACTIVE',
        apps: ['ADMIN'],
        profiles: [{ name: 'Operações' }],
      });

      await t
        .http()
        .post('/auth/staff/login')
        .send({
          email: 'nova@eredita.test',
          password: 'qualquer-coisa',
          app: 'ADMIN',
        })
        .expect(401);

      const again = await as(adminToken)
        .post('/admin/staff-users', {
          email: 'nova@eredita.test',
          name: 'Outra',
        })
        .expect(409);
      expect(again.body.code).toBe('STAFF_USER_EMAIL_TAKEN');
    });

    it('desativar derruba o token da pessoa na hora; reativar devolve o acesso', async () => {
      const consultor = await staffToken(
        t,
        'consultor@eredita.test',
        'CONSULTOR',
      );
      await as(consultor).get('/probe/consultor').expect(200);

      await as(adminToken)
        .post(`/admin/staff-users/${accounts.consultor.id}/disable`)
        .expect(200);
      await as(consultor).get('/probe/consultor').expect(401);

      await as(adminToken)
        .post(`/admin/staff-users/${accounts.consultor.id}/enable`)
        .expect(200);
      await as(consultor).get('/probe/consultor').expect(200);
    });

    it('id malformado ou inexistente', async () => {
      await as(adminToken).get('/admin/staff-users/nao-e-uuid').expect(400);
      const missing = await as(adminToken)
        .get('/admin/staff-users/7d0c8a3e-9d5f-4a7b-8f42-1b2c3d4e5f60')
        .expect(404);
      expect(missing.body.code).toBe('STAFF_USER_NOT_FOUND');
    });
  });

  describe('proteções contra escalada', () => {
    let rhToken: string;

    beforeEach(async () => {
      // "RH": gerencia usuários e tem as permissões de Operações, nada além.
      const rh = t.staff.addProfile({
        app: 'ADMIN',
        name: 'RH',
        permissions: [
          'admin.access.users.manage',
          'admin.clients.view',
          'admin.requests.view',
          'admin.requests.handle',
        ],
      });
      await addStaff(t, 'rh@eredita.test', [rh]);
      rhToken = await staffToken(t, 'rh@eredita.test', 'ADMIN');
    });

    it('concede o perfil cujas permissões tem; o Administrador geral, não', async () => {
      await as(rhToken)
        .put(grantPath(accounts.consultor.id, accounts.profiles.operations.id))
        .expect(200);

      const res = await as(rhToken)
        .put(grantPath(accounts.consultor.id, GENERAL_ADMIN_PROFILE_ID))
        .expect(403);
      expect(res.body.code).toBe('ACCESS_ESCALATION_DENIED');
      expect(res.body.details.missing).toContain('admin.commissions.view');
      expect(t.staff.profileIdsOf(accounts.consultor.id)).not.toContain(
        GENERAL_ADMIN_PROFILE_ID,
      );
    });

    it('não desativa quem tem mais poder', async () => {
      const res = await as(rhToken)
        .post(`/admin/staff-users/${accounts.admin.id}/disable`)
        .expect(403);
      expect(res.body.code).toBe('ACCESS_ESCALATION_DENIED');
    });

    it('não altera o próprio acesso', async () => {
      const rh = [...t.staff.users.values()].find(
        (u) => u.email === 'rh@eredita.test',
      )!;
      const res = await as(rhToken)
        .put(grantPath(rh.id, accounts.profiles.operations.id))
        .expect(403);
      expect(res.body.code).toBe('ACCESS_SELF_CHANGE_DENIED');
    });

    it('sem gestão de perfis, não cria nem edita perfis', async () => {
      await as(rhToken)
        .post('/admin/access-profiles', {
          app: 'ADMIN',
          name: 'X',
          permissions: [],
        })
        .expect(403);
    });
  });

  describe('último Administrador geral', () => {
    it('não pode ser revogado nem desativado por quem tem as mesmas permissões', async () => {
      // "Vice": perfil comum com todas as permissões do admin, sem ser o perfil do sistema.
      const vice = t.staff.addProfile({
        app: 'ADMIN',
        name: 'Vice',
        permissions: permissionsOfApp('ADMIN'),
      });
      await addStaff(t, 'vice@eredita.test', [vice]);
      const viceToken = await staffToken(t, 'vice@eredita.test', 'ADMIN');

      const revoke = await as(viceToken)
        .delete(grantPath(accounts.admin.id, GENERAL_ADMIN_PROFILE_ID))
        .expect(409);
      expect(revoke.body.code).toBe('ACCESS_LAST_GENERAL_ADMIN');

      const disable = await as(viceToken)
        .post(`/admin/staff-users/${accounts.admin.id}/disable`)
        .expect(409);
      expect(disable.body.code).toBe('ACCESS_LAST_GENERAL_ADMIN');

      // Com um segundo Administrador geral ativo, a revogação passa.
      await addStaff(t, 'admin2@eredita.test', [
        accounts.profiles.generalAdmin,
      ]);
      await as(viceToken)
        .delete(grantPath(accounts.admin.id, GENERAL_ADMIN_PROFILE_ID))
        .expect(200);
    });
  });

  describe('perfis', () => {
    it('perfil do sistema não é editado nem apagado', async () => {
      const path = `/admin/access-profiles/${GENERAL_ADMIN_PROFILE_ID}`;
      expect(
        (await as(adminToken).patch(path, { name: 'Outro' }).expect(409)).body
          .code,
      ).toBe('ACCESS_SYSTEM_PROFILE_READONLY');
      await as(adminToken).delete(path).expect(409);
    });

    it('perfil em uso não é apagado; sem uso, é', async () => {
      const inUse = await as(adminToken)
        .delete(`/admin/access-profiles/${accounts.profiles.operations.id}`)
        .expect(409);
      // Gestora e o usuário desligado: perfil atribuído conta mesmo com a conta desativada.
      expect(inUse.body).toMatchObject({
        code: 'ACCESS_PROFILE_IN_USE',
        details: { holders: 2 },
      });

      const created = await as(adminToken)
        .post('/admin/access-profiles', {
          app: 'CONTABIL',
          name: 'Leitura',
          permissions: ['contabil.taxpayers.view'],
        })
        .expect(201);
      await as(adminToken)
        .delete(`/admin/access-profiles/${created.body.id}`)
        .expect(204);
    });

    it('rejeita permissão de outro app e nome repetido', async () => {
      const wrongApp = await as(adminToken)
        .post('/admin/access-profiles', {
          app: 'ADMIN',
          name: 'X',
          permissions: ['consultor.team.view'],
        })
        .expect(422);
      expect(wrongApp.body).toMatchObject({
        code: 'ACCESS_UNKNOWN_PERMISSION',
        details: { app: 'ADMIN', permissions: ['consultor.team.view'] },
      });

      const taken = await as(adminToken)
        .post('/admin/access-profiles', {
          app: 'ADMIN',
          name: 'Operações',
          permissions: [],
        })
        .expect(409);
      expect(taken.body.code).toBe('ACCESS_PROFILE_NAME_TAKEN');
    });

    it('edição troca as permissões e vale para quem já tem o perfil', async () => {
      const gestora = await staffToken(t, 'gestora@eredita.test', 'ADMIN');
      await as(gestora).get('/probe/comissoes').expect(403);

      await as(adminToken)
        .patch(`/admin/access-profiles/${accounts.profiles.operations.id}`, {
          permissions: [
            ...accounts.profiles.operations.permissions,
            'admin.commissions.view',
          ],
        })
        .expect(200);
      await as(gestora).get('/probe/comissoes').expect(200);
    });
  });

  describe('gestão delegada do app Consultor', () => {
    let networkToken: string;

    beforeEach(async () => {
      const networkManager = t.staff.addProfile({
        app: 'ADMIN',
        name: 'Gestão da rede',
        permissions: ['admin.access.consultor.manage'],
      });
      await addStaff(t, 'rede@eredita.test', [networkManager]);
      networkToken = await staffToken(t, 'rede@eredita.test', 'ADMIN');
    });

    it('cria e concede perfis do app Consultor, mas não do admin', async () => {
      const leader = await as(networkToken)
        .post('/admin/access-profiles', {
          app: 'CONSULTOR',
          name: 'Líder de rede',
          permissions: ['consultor.portfolio.view', 'consultor.team.propose'],
        })
        .expect(201);
      await as(networkToken)
        .put(grantPath(accounts.consultor.id, leader.body.id))
        .expect(200);

      await as(networkToken)
        .post('/admin/access-profiles', {
          app: 'ADMIN',
          name: 'Y',
          permissions: [],
        })
        .expect(403);
      await as(networkToken)
        .put(grantPath(accounts.consultor.id, accounts.profiles.operations.id))
        .expect(403);
      // Criar usuário e desativar continuam sendo da gestão de usuários.
      await as(networkToken)
        .post('/admin/staff-users', { email: 'z@eredita.test', name: 'Z' })
        .expect(403);
    });
  });

  describe('auditoria', () => {
    it('registra quem concedeu o quê, e só quem pode vê', async () => {
      await as(adminToken)
        .put(grantPath(accounts.consultor.id, accounts.profiles.operations.id))
        .expect(200);

      const res = await as(adminToken)
        .get(`/admin/access-audit?subjectId=${accounts.consultor.id}&limit=10`)
        .expect(200);
      expect(res.body).toMatchObject([
        {
          type: 'AccessProfileGranted',
          actorId: accounts.admin.id,
          subjectType: 'staff_user',
          subjectId: accounts.consultor.id,
          data: { profileName: 'Operações', app: 'ADMIN' },
        },
      ]);

      const gestora = await staffToken(t, 'gestora@eredita.test', 'ADMIN');
      await as(gestora).get('/admin/access-audit').expect(403);
    });

    it('tentativa negada não altera nada nem gera evento', async () => {
      const before = t.staff.events.length;
      const gestora = await staffToken(t, 'gestora@eredita.test', 'ADMIN');
      await as(gestora)
        .put(grantPath(accounts.consultor.id, GENERAL_ADMIN_PROFILE_ID))
        .expect(403);
      expect(t.staff.events.length).toBe(before);
    });
  });
});
