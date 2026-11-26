import { StaffApp } from '../src/modules/accounts/domain/apps.js';
import { permissionsOfApp } from '../src/modules/accounts/domain/permissions.js';
import { CLIENT_PASSWORD, PASSWORD, seedAccounts } from './support/fixtures.js';
import { createTestApp, type TestApp } from './support/test-app.js';

describe('Login', () => {
  let t: TestApp;
  let accounts: Awaited<ReturnType<typeof seedAccounts>>;

  beforeEach(async () => {
    t = await createTestApp();
    accounts = await seedAccounts(t);
  });

  afterEach(() => t.app.close());

  const staffLogin = (email: string, password: string, app: string) =>
    t.http().post('/auth/staff/login').send({ email, password, app });

  describe('equipe interna', () => {
    it('admin entra no app ADMIN e recebe tokens + perfil', async () => {
      const res = await staffLogin(
        'admin@eredita.test',
        PASSWORD,
        StaffApp.ADMIN,
      ).expect(200);

      expect(res.body).toMatchObject({
        accessToken: expect.any(String),
        accessTokenExpiresIn: 900,
        refreshToken: expect.any(String),
        user: { id: accounts.admin.id, app: 'ADMIN', apps: ['ADMIN'] },
      });
      expect(t.staff.users.get(accounts.admin.id)!.lastLoginAt).toBeInstanceOf(
        Date,
      );

      const me = await t
        .http()
        .get('/auth/staff/me')
        .auth(res.body.accessToken, { type: 'bearer' })
        .expect(200);
      expect(me.body).toEqual({
        id: accounts.admin.id,
        email: 'admin@eredita.test',
        name: 'admin',
        app: 'ADMIN',
        apps: ['ADMIN'],
        // Administrador geral: todas as permissões do admin.
        permissions: [...permissionsOfApp('ADMIN')].sort(),
      });
    });

    it('e-mail é comparado sem diferenciar maiúsculas e espaços', async () => {
      await staffLogin(
        '  Admin@Eredita.TEST ',
        PASSWORD,
        StaffApp.ADMIN,
      ).expect(200);
    });

    it('consultor não entra no app ADMIN, mesmo com a senha certa', async () => {
      const res = await staffLogin(
        'consultor@eredita.test',
        PASSWORD,
        StaffApp.ADMIN,
      ).expect(403);
      expect(res.body.code).toBe('AUTH_APP_FORBIDDEN');
      // Acesso negado ao app não conta como login feito.
      expect(t.staff.users.get(accounts.consultor.id)!.lastLoginAt).toBeNull();
    });

    it('quem tem dois apps escolhe em qual entrar; o token vale só para ele', async () => {
      const res = await staffLogin(
        'gestora@eredita.test',
        PASSWORD,
        StaffApp.CONSULTOR,
      ).expect(200);
      // As permissões devolvidas são só as do app da sessão.
      expect(res.body.user).toMatchObject({
        app: 'CONSULTOR',
        apps: ['ADMIN', 'CONSULTOR'],
        permissions: ['consultor.earnings.view', 'consultor.portfolio.view'],
      });
    });

    it('senha errada e e-mail inexistente dão a mesma resposta', async () => {
      const wrong = await staffLogin(
        'admin@eredita.test',
        'errada',
        StaffApp.ADMIN,
      ).expect(401);
      const unknown = await staffLogin(
        'ninguem@eredita.test',
        PASSWORD,
        StaffApp.ADMIN,
      ).expect(401);
      expect(wrong.body).toEqual(unknown.body);
      expect(wrong.body.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('convite não aceito (sem senha) não entra', async () => {
      const res = await staffLogin(
        'convidado@eredita.test',
        '',
        StaffApp.CONSULTOR,
      );
      // Senha vazia é barrada pela validação; qualquer outra cai em credenciais inválidas.
      expect(res.status).toBe(400);
      const other = await staffLogin(
        'convidado@eredita.test',
        PASSWORD,
        StaffApp.CONSULTOR,
      ).expect(401);
      expect(other.body.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('conta desativada não entra', async () => {
      const res = await staffLogin(
        'desligado@eredita.test',
        PASSWORD,
        StaffApp.ADMIN,
      ).expect(403);
      expect(res.body.code).toBe('AUTH_ACCOUNT_DISABLED');
    });

    it('bloqueia após 5 falhas seguidas e libera depois de 15 minutos', async () => {
      for (let i = 0; i < 5; i++) {
        await staffLogin('admin@eredita.test', 'errada', StaffApp.ADMIN).expect(
          401,
        );
      }

      // Bloqueada: nem a senha certa passa.
      const locked = await staffLogin(
        'admin@eredita.test',
        PASSWORD,
        StaffApp.ADMIN,
      ).expect(429);
      expect(locked.body).toMatchObject({
        code: 'AUTH_ACCOUNT_LOCKED',
        details: { retryAfterSeconds: 900 },
      });

      t.clock.advance(15 * 60 * 1000 + 1);
      await staffLogin('admin@eredita.test', PASSWORD, StaffApp.ADMIN).expect(
        200,
      );
      expect(t.staff.users.get(accounts.admin.id)).toMatchObject({
        failedLoginCount: 0,
        lockedUntil: null,
      });
      // O bloqueio fica na auditoria, como ação do sistema.
      expect(t.staff.eventsOf('AccountLocked')).toMatchObject([
        {
          actorId: null,
          subjectType: 'staff_user',
          subjectId: accounts.admin.id,
        },
      ]);
    });

    it('login com sucesso zera as falhas anteriores', async () => {
      for (let i = 0; i < 4; i++) {
        await staffLogin('admin@eredita.test', 'errada', StaffApp.ADMIN).expect(
          401,
        );
      }
      await staffLogin('admin@eredita.test', PASSWORD, StaffApp.ADMIN).expect(
        200,
      );
      expect(t.staff.users.get(accounts.admin.id)!.failedLoginCount).toBe(0);
    });

    it('rejeita app desconhecido e campos fora do contrato', async () => {
      const badApp = await staffLogin(
        'admin@eredita.test',
        PASSWORD,
        'SUPERADMIN',
      ).expect(400);
      expect(badApp.body.code).toBe('VALIDATION_FAILED');
      expect(badApp.body.details).toEqual([
        { field: 'app', constraints: ['isIn'] },
      ]);

      const extra = await t
        .http()
        .post('/auth/staff/login')
        .send({
          email: 'admin@eredita.test',
          password: PASSWORD,
          app: 'ADMIN',
          isAdmin: true,
        })
        .expect(400);
      expect(extra.body.details).toEqual([
        { field: 'isAdmin', constraints: ['whitelistValidation'] },
      ]);
    });
  });

  describe('portal do cliente', () => {
    it('cliente entra e consulta o próprio perfil', async () => {
      const res = await t
        .http()
        .post('/auth/client/login')
        .send({ email: 'cliente@exemplo.test', password: CLIENT_PASSWORD })
        .expect(200);
      expect(res.body.client).toEqual({
        id: accounts.cliente.id,
        email: 'cliente@exemplo.test',
        name: 'cliente',
      });

      await t
        .http()
        .get('/auth/client/me')
        .auth(res.body.accessToken, { type: 'bearer' })
        .expect(200, res.body.client);
    });

    it('não aceita o campo `app`: o cliente não escolhe módulo da equipe', async () => {
      const res = await t
        .http()
        .post('/auth/client/login')
        .send({
          email: 'cliente@exemplo.test',
          password: CLIENT_PASSWORD,
          app: 'ADMIN',
        })
        .expect(400);
      expect(res.body.details).toEqual([
        { field: 'app', constraints: ['whitelistValidation'] },
      ]);
    });

    it('mesmo e-mail nos dois domínios: cada senha só vale no seu', async () => {
      // Senha da conta de cliente não abre a conta da equipe...
      await staffLogin(
        'duplo@exemplo.test',
        CLIENT_PASSWORD,
        StaffApp.CONSULTOR,
      ).expect(401);
      // ...e a senha da equipe não abre o portal do cliente.
      await t
        .http()
        .post('/auth/client/login')
        .send({ email: 'duplo@exemplo.test', password: PASSWORD })
        .expect(401);

      await staffLogin(
        'duplo@exemplo.test',
        PASSWORD,
        StaffApp.CONSULTOR,
      ).expect(200);
      await t
        .http()
        .post('/auth/client/login')
        .send({ email: 'duplo@exemplo.test', password: CLIENT_PASSWORD })
        .expect(200);
    });

    it('conta de cliente nunca entra pelo login da equipe', async () => {
      const res = await staffLogin(
        'cliente@exemplo.test',
        CLIENT_PASSWORD,
        StaffApp.ADMIN,
      ).expect(401);
      expect(res.body.code).toBe('AUTH_INVALID_CREDENTIALS');
    });
  });
});
