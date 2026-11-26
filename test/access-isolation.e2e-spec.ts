import { JwtService } from '@nestjs/jwt';
import { StaffApp } from '../src/modules/accounts/domain/apps.js';
import { CLIENT_PASSWORD, PASSWORD, seedAccounts } from './support/fixtures.js';
import { createTestApp, type TestApp } from './support/test-app.js';
import { TEST_ENV } from './support/test-env.js';

describe('Isolamento de acesso entre apps e domínios', () => {
  let t: TestApp;
  let accounts: Awaited<ReturnType<typeof seedAccounts>>;

  beforeEach(async () => {
    t = await createTestApp();
    accounts = await seedAccounts(t);
  });

  afterEach(() => t.app.close());

  const staffToken = async (email: string, app: StaffApp) =>
    (
      await t
        .http()
        .post('/auth/staff/login')
        .send({ email, password: PASSWORD, app })
        .expect(200)
    ).body.accessToken as string;

  const clientToken = async () =>
    (
      await t
        .http()
        .post('/auth/client/login')
        .send({ email: 'cliente@exemplo.test', password: CLIENT_PASSWORD })
        .expect(200)
    ).body.accessToken as string;

  const get = (path: string, token?: string) => {
    const req = t.http().get(path);
    return token ? req.auth(token, { type: 'bearer' }) : req;
  };

  it('token do app CONSULTOR não abre rota do ADMIN', async () => {
    const token = await staffToken(
      'consultor@eredita.test',
      StaffApp.CONSULTOR,
    );
    await get('/probe/consultor', token).expect(200);

    const res = await get('/probe/admin', token).expect(403);
    expect(res.body.code).toBe('AUTH_APP_FORBIDDEN');
  });

  it('quem tem ADMIN e CONSULTOR só usa, com cada token, o app em que entrou', async () => {
    const asConsultor = await staffToken(
      'gestora@eredita.test',
      StaffApp.CONSULTOR,
    );
    await get('/probe/admin', asConsultor).expect(403);

    const asAdmin = await staffToken('gestora@eredita.test', StaffApp.ADMIN);
    await get('/probe/admin', asAdmin).expect(200, {
      id: accounts.adminConsultor.id,
      app: 'ADMIN',
    });
  });

  it('rota liberada para dois apps informa de qual app veio o token', async () => {
    const token = await staffToken(
      'consultor@eredita.test',
      StaffApp.CONSULTOR,
    );
    await get('/probe/admin-ou-consultor', token).expect(200, {
      id: accounts.consultor.id,
      app: 'CONSULTOR',
    });
  });

  it('token de cliente não vale em nenhuma rota da equipe', async () => {
    const token = await clientToken();
    await get('/probe/cliente', token).expect(200);

    for (const path of ['/probe/admin', '/probe/consultor', '/auth/staff/me']) {
      const res = await get(path, token).expect(401);
      expect(res.body.code).toBe('AUTH_TOKEN_INVALID');
    }
  });

  it('token da equipe (até de admin) não vale no portal do cliente', async () => {
    const token = await staffToken('admin@eredita.test', StaffApp.ADMIN);
    for (const path of ['/probe/cliente', '/auth/client/me']) {
      await get(path, token).expect(401);
    }
  });

  it('token forjado com o segredo do cliente e claims de admin é recusado', async () => {
    // Mesmo que alguém obtivesse o segredo do portal do cliente, não conseguiria
    // fabricar um token de admin: a equipe é verificada com outro segredo.
    const forged = await new JwtService().signAsync(
      { realm: 'staff' },
      {
        secret: TEST_ENV.JWT_CLIENT_SECRET,
        issuer: TEST_ENV.JWT_ISSUER,
        subject: accounts.admin.id,
        audience: StaffApp.ADMIN,
        expiresIn: 60,
      },
    );
    await get('/probe/admin', forged).expect(401);
  });

  it('token assinado com o segredo certo mas com `realm` trocado é recusado', async () => {
    const forged = await new JwtService().signAsync(
      { realm: 'client' },
      {
        secret: TEST_ENV.JWT_STAFF_SECRET,
        issuer: TEST_ENV.JWT_ISSUER,
        subject: accounts.admin.id,
        audience: StaffApp.ADMIN,
        expiresIn: 60,
      },
    );
    await get('/probe/admin', forged).expect(401);
  });

  it('rota sem política de acesso é negada, mesmo com token válido', async () => {
    const token = await staffToken('admin@eredita.test', StaffApp.ADMIN);
    const res = await get('/probe/sem-politica', token).expect(403);
    expect(res.body).toEqual({
      statusCode: 403,
      code: 'AUTH_ACCESS_POLICY_MISSING',
      message: 'Route has no access policy',
    });
  });

  it('sem token, ou com token malformado, a resposta é 401', async () => {
    const missing = await get('/probe/admin').expect(401);
    expect(missing.body.code).toBe('AUTH_TOKEN_MISSING');

    const malformed = await get('/probe/admin', 'nao-e-um-jwt').expect(401);
    expect(malformed.body.code).toBe('AUTH_TOKEN_INVALID');
  });

  it('remover o perfil do app derruba o token já emitido, sem esperar expirar', async () => {
    const token = await staffToken('gestora@eredita.test', StaffApp.ADMIN);
    await get('/probe/admin', token).expect(200);

    // Sem nenhum perfil do admin, ela perde o app ADMIN (continua consultora).
    t.staff.unassign(
      accounts.adminConsultor.id,
      accounts.profiles.operations.id,
    );
    await get('/probe/admin', token).expect(401);
  });

  it('desativar a conta derruba os tokens já emitidos', async () => {
    const staff = await staffToken('admin@eredita.test', StaffApp.ADMIN);
    const client = await clientToken();

    t.staff.update(accounts.admin.id, { status: 'DISABLED' });
    t.clientAccounts.update(accounts.cliente.id, { status: 'DISABLED' });

    await get('/probe/admin', staff).expect(401);
    await get('/probe/cliente', client).expect(401);
  });

  it('health é público', async () => {
    await get('/health').expect(200, { status: 'ok' });
  });
});
