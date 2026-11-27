import {
  type Accounts,
  addStaff,
  CLIENT_PASSWORD,
  PASSWORD,
  seedAccounts,
  staffToken,
} from './support/fixtures.js';
import { createTestApp, type TestApp } from './support/test-app.js';

const NEW_PASSWORD = 'Senha-Nova-Definida-2026';

describe('Dados da conta e senha', () => {
  let t: TestApp;
  let accounts: Accounts;
  let adminToken: string;

  beforeEach(async () => {
    t = await createTestApp();
    accounts = await seedAccounts(t);
    adminToken = await staffToken(t, 'admin@eredita.test', 'ADMIN');
  });

  afterEach(() => t.app.close());

  const editUser = (token: string, userId: string, body: object) =>
    t
      .http()
      .patch(`/admin/staff-users/${userId}`)
      .auth(token, { type: 'bearer' })
      .send(body);

  const staffLogin = (email: string, password: string, app = 'CONSULTOR') =>
    t.http().post('/auth/staff/login').send({ email, password, app });

  const changeOwn = (
    realm: 'staff' | 'client',
    token: string,
    body: {
      currentPassword: string;
      newPassword: string;
      refreshToken?: string;
    },
  ) =>
    t
      .http()
      .post(`/auth/${realm}/password`)
      .auth(token, { type: 'bearer' })
      .send(body);

  const refresh = (realm: 'staff' | 'client', refreshToken: string) =>
    t.http().post(`/auth/${realm}/refresh`).send({ refreshToken });

  describe('admin edita outra pessoa (PATCH /admin/staff-users/:id)', () => {
    it('muda nome e e-mail, registra de → para e o novo e-mail entra', async () => {
      const res = await editUser(adminToken, accounts.consultor.id, {
        name: ' Consultor Renomeado ',
        email: ' NOVO.Consultor@Eredita.test ',
      }).expect(200);
      expect(res.body).toMatchObject({
        name: 'Consultor Renomeado',
        email: 'novo.consultor@eredita.test',
      });

      expect(t.staff.eventsOf('StaffUserUpdated')).toMatchObject([
        {
          actorId: accounts.admin.id,
          subjectId: accounts.consultor.id,
          data: {
            name: { from: 'consultor', to: 'Consultor Renomeado' },
            email: {
              from: 'consultor@eredita.test',
              to: 'novo.consultor@eredita.test',
            },
          },
        },
      ]);
      await staffLogin('consultor@eredita.test', PASSWORD).expect(401);
      await staffLogin('novo.consultor@eredita.test', PASSWORD).expect(200);
    });

    it('recusa e-mail de outra pessoa, mas aceita o próprio e-mail de volta', async () => {
      const taken = await editUser(adminToken, accounts.consultor.id, {
        email: 'gestora@eredita.test',
      }).expect(409);
      expect(taken.body.code).toBe('STAFF_USER_EMAIL_TAKEN');

      await editUser(adminToken, accounts.consultor.id, {
        email: 'consultor@eredita.test',
      }).expect(200);
      expect(t.staff.eventsOf('StaffUserUpdated')).toHaveLength(0);
    });

    it('senha nova: a antiga para de valer, as sessões caem e o bloqueio sai', async () => {
      const session = (
        await staffLogin('consultor@eredita.test', PASSWORD).expect(200)
      ).body;
      t.staff.update(accounts.consultor.id, {
        lockedUntil: new Date(t.clock.now().getTime() + 60_000),
      });

      const res = await editUser(adminToken, accounts.consultor.id, {
        password: NEW_PASSWORD,
      }).expect(200);
      expect(res.body.invitePending).toBe(false);

      expect(t.staffTokens.activeOf(accounts.consultor.id)).toHaveLength(0);
      await refresh('staff', session.refreshToken).expect(401);
      await staffLogin('consultor@eredita.test', PASSWORD).expect(401);
      await staffLogin('consultor@eredita.test', NEW_PASSWORD).expect(200);

      const [event] = t.staff.eventsOf('StaffUserPasswordReset');
      expect(event).toMatchObject({
        actorId: accounts.admin.id,
        subjectId: accounts.consultor.id,
        data: { sessionsRevoked: true },
      });
      expect(JSON.stringify(t.staff.events)).not.toContain(NEW_PASSWORD);
    });

    it('com a senha definida, quem tinha convite pendente passa a entrar', async () => {
      await staffLogin('convidado@eredita.test', NEW_PASSWORD).expect(401);
      const res = await editUser(adminToken, accounts.pendingInvite.id, {
        password: NEW_PASSWORD,
      }).expect(200);
      expect(res.body.invitePending).toBe(false);
      await staffLogin('convidado@eredita.test', NEW_PASSWORD).expect(200);
    });

    it('senha fora da regra: 422 com os limites, e nada muda', async () => {
      const res = await editUser(adminToken, accounts.consultor.id, {
        name: 'Não Deve Mudar',
        password: 'curta',
      }).expect(422);
      expect(res.body).toMatchObject({
        code: 'AUTH_PASSWORD_WEAK',
        details: { minLength: 6, maxLength: 128 },
      });
      expect(t.staff.users.get(accounts.consultor.id)?.name).toBe('consultor');
    });

    it('não edita quem tem mais poder nem a própria conta', async () => {
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
      const rhToken = await staffToken(t, 'rh@eredita.test', 'ADMIN');

      const boss = await editUser(rhToken, accounts.admin.id, {
        password: NEW_PASSWORD,
      }).expect(403);
      expect(boss.body.code).toBe('ACCESS_ESCALATION_DENIED');
      await staffLogin('admin@eredita.test', PASSWORD, 'ADMIN').expect(200);

      // Desligado tem o perfil Operações, que o RH cobre.
      await editUser(rhToken, accounts.disabled.id, { name: 'Ok' }).expect(200);

      const self = await editUser(adminToken, accounts.admin.id, {
        name: 'Eu Mesmo',
      }).expect(403);
      expect(self.body.code).toBe('ACCESS_SELF_CHANGE_DENIED');
    });

    it('exige a permissão de gestão de usuários', async () => {
      const gestora = await staffToken(t, 'gestora@eredita.test', 'ADMIN');
      const res = await editUser(gestora, accounts.consultor.id, {
        name: 'X',
      }).expect(403);
      expect(res.body).toMatchObject({
        code: 'AUTH_PERMISSION_DENIED',
        details: { required: ['admin.access.users.manage'] },
      });
    });
  });

  describe('a pessoa troca a própria senha', () => {
    it('equipe: exige a atual, mantém a sessão atual e encerra as outras', async () => {
      const current = (
        await staffLogin('consultor@eredita.test', PASSWORD).expect(200)
      ).body;
      const other = (
        await staffLogin('consultor@eredita.test', PASSWORD).expect(200)
      ).body;

      await changeOwn('staff', current.accessToken, {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
        refreshToken: current.refreshToken,
      }).expect(204);

      await refresh('staff', current.refreshToken).expect(200);
      await refresh('staff', other.refreshToken).expect(401);
      await staffLogin('consultor@eredita.test', PASSWORD).expect(401);
      await staffLogin('consultor@eredita.test', NEW_PASSWORD).expect(200);

      expect(t.staff.eventsOf('PasswordChanged')).toMatchObject([
        {
          actorId: accounts.consultor.id,
          subjectType: 'staff_user',
          subjectId: accounts.consultor.id,
        },
      ]);
    });

    it('senha atual errada: 422, e os erros levam ao bloqueio como no login', async () => {
      const token = await staffToken(t, 'consultor@eredita.test', 'CONSULTOR');
      for (let attempt = 1; attempt <= 5; attempt++) {
        const res = await changeOwn('staff', token, {
          currentPassword: 'errada-errada',
          newPassword: NEW_PASSWORD,
        }).expect(422);
        expect(res.body.code).toBe('AUTH_CURRENT_PASSWORD_INVALID');
      }
      const locked = await changeOwn('staff', token, {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      }).expect(429);
      expect(locked.body.code).toBe('AUTH_ACCOUNT_LOCKED');
      await staffLogin('consultor@eredita.test', PASSWORD).expect(429);
    });

    it('recusa senha nova fraca ou igual à atual', async () => {
      const token = await staffToken(t, 'consultor@eredita.test', 'CONSULTOR');
      const weak = await changeOwn('staff', token, {
        currentPassword: PASSWORD,
        newPassword: 'curta',
      }).expect(422);
      expect(weak.body.code).toBe('AUTH_PASSWORD_WEAK');

      const same = await changeOwn('staff', token, {
        currentPassword: PASSWORD,
        newPassword: PASSWORD,
      }).expect(422);
      expect(same.body.code).toBe('AUTH_PASSWORD_UNCHANGED');
    });

    it('refresh token de outra pessoa não protege sessão nenhuma', async () => {
      const mine = (
        await staffLogin('consultor@eredita.test', PASSWORD).expect(200)
      ).body;
      const adminSession = (
        await staffLogin('admin@eredita.test', PASSWORD, 'ADMIN').expect(200)
      ).body;

      await changeOwn('staff', mine.accessToken, {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
        refreshToken: adminSession.refreshToken,
      }).expect(204);

      expect(t.staffTokens.activeOf(accounts.consultor.id)).toHaveLength(0);
      await refresh('staff', adminSession.refreshToken).expect(200);
    });

    it('cliente: mesma regra, no domínio dos clientes', async () => {
      const clientLogin = () =>
        t
          .http()
          .post('/auth/client/login')
          .send({ email: 'cliente@exemplo.test', password: CLIENT_PASSWORD })
          .expect(200);
      const current = (await clientLogin()).body;
      const other = (await clientLogin()).body;

      await changeOwn('client', current.accessToken, {
        currentPassword: CLIENT_PASSWORD,
        newPassword: NEW_PASSWORD,
        refreshToken: current.refreshToken,
      }).expect(204);

      await refresh('client', current.refreshToken).expect(200);
      await refresh('client', other.refreshToken).expect(401);
      expect(t.staff.eventsOf('PasswordChanged')).toMatchObject([
        { subjectType: 'client_account', subjectId: accounts.cliente.id },
      ]);

      // Token da equipe não troca senha de cliente (nem o contrário).
      const res = await changeOwn('client', adminToken, {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      });
      expect([401, 403]).toContain(res.status);
    });
  });
});
