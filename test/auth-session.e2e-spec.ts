import { StaffApp } from '../src/modules/accounts/domain/apps.js';
import { hashRefreshToken } from '../src/modules/accounts/domain/refresh-tokens.js';
import { CLIENT_PASSWORD, PASSWORD, seedAccounts } from './support/fixtures.js';
import { createTestApp, type TestApp } from './support/test-app.js';

describe('Sessão: refresh e logout', () => {
  let t: TestApp;
  let accounts: Awaited<ReturnType<typeof seedAccounts>>;

  beforeEach(async () => {
    t = await createTestApp();
    accounts = await seedAccounts(t);
  });

  afterEach(() => t.app.close());

  const login = async (remember = false) =>
    (
      await t
        .http()
        .post('/auth/staff/login')
        .send({
          email: 'gestora@eredita.test',
          password: PASSWORD,
          app: StaffApp.ADMIN,
          remember,
        })
        .expect(200)
    ).body as {
      accessToken: string;
      refreshToken: string;
      refreshTokenExpiresAt: string;
    };

  const refresh = (refreshToken: string, realm: 'staff' | 'client' = 'staff') =>
    t.http().post(`/auth/${realm}/refresh`).send({ refreshToken });

  const familyOf = (rawToken: string) =>
    t.staffTokens.tokens.find(
      (token) => token.tokenHash === hashRefreshToken(rawToken),
    )!.familyId;

  it('guarda só o hash do refresh token', async () => {
    const session = await login();
    const stored = t.staffTokens.tokens[0]!;
    expect(stored.tokenHash).toBe(hashRefreshToken(session.refreshToken));
    expect(JSON.stringify(t.staffTokens.tokens)).not.toContain(
      session.refreshToken,
    );
  });

  it('"Manter conectado" define a duração da sessão', async () => {
    const short = await login(false);
    const long = await login(true);
    const hours = (iso: string) =>
      (new Date(iso).getTime() - t.clock.now().getTime()) / 3_600_000;
    expect(Math.round(hours(short.refreshTokenExpiresAt))).toBe(12);
    expect(Math.round(hours(long.refreshTokenExpiresAt))).toBe(30 * 24);
  });

  it('refresh troca o par de tokens, mantém o app e não estende a sessão', async () => {
    const session = await login();
    const res = await refresh(session.refreshToken).expect(200);

    expect(res.body.refreshToken).not.toBe(session.refreshToken);
    expect(res.body.refreshTokenExpiresAt).toBe(session.refreshTokenExpiresAt);
    await t
      .http()
      .get('/probe/admin')
      .auth(res.body.accessToken, { type: 'bearer' })
      .expect(200, { id: accounts.adminConsultor.id, app: 'ADMIN' });
  });

  it('reuso de refresh token já trocado (fora da tolerância) derruba a sessão inteira', async () => {
    const session = await login();
    const family = familyOf(session.refreshToken);
    const rotated = await refresh(session.refreshToken).expect(200);

    t.clock.advance(11_000);
    const reuse = await refresh(session.refreshToken).expect(401);
    expect(reuse.body.code).toBe('AUTH_REFRESH_INVALID');

    // O token legítimo mais novo também morreu: quem roubou e quem é dono precisam entrar de novo.
    await refresh(rotated.body.refreshToken).expect(401);
    expect(t.staffTokens.activeInFamily(family)).toHaveLength(0);
    expect(t.staff.eventsOf('SessionReuseDetected')).toMatchObject([
      { subjectId: accounts.adminConsultor.id, data: { sessionId: family } },
    ]);
  });

  it('dentro da tolerância, requisições paralelas renovando o mesmo token não derrubam a sessão', async () => {
    const session = await login();
    const [first, second] = await Promise.all([
      refresh(session.refreshToken),
      refresh(session.refreshToken),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await refresh(first.body.refreshToken).expect(200);
    await refresh(second.body.refreshToken).expect(200);
  });

  it('sessão expirada não renova', async () => {
    const session = await login();
    t.clock.advance(12 * 3_600_000 + 1);
    await refresh(session.refreshToken).expect(401);
  });

  it('logout encerra a sessão; repetir o logout não dá erro', async () => {
    const session = await login();
    await t
      .http()
      .post('/auth/staff/logout')
      .send({ refreshToken: session.refreshToken })
      .expect(204);
    await t
      .http()
      .post('/auth/staff/logout')
      .send({ refreshToken: session.refreshToken })
      .expect(204);
    await refresh(session.refreshToken).expect(401);
    // Refresh atrasado depois do logout é normal: recusa, mas não é alarme de roubo.
    expect(t.staff.eventsOf('SessionReuseDetected')).toEqual([]);
  });

  it('remover o acesso ao app impede renovar a sessão desse app', async () => {
    const session = await login();
    t.staff.unassign(
      accounts.adminConsultor.id,
      accounts.profiles.operations.id,
    );

    await refresh(session.refreshToken).expect(401);
    expect(
      t.staffTokens.activeInFamily(familyOf(session.refreshToken)),
    ).toHaveLength(0);
  });

  it('refresh token da equipe não renova no portal do cliente, e vice-versa', async () => {
    const staff = await login();
    await refresh(staff.refreshToken, 'client').expect(401);

    const client = (
      await t
        .http()
        .post('/auth/client/login')
        .send({ email: 'cliente@exemplo.test', password: CLIENT_PASSWORD })
        .expect(200)
    ).body;
    await refresh(client.refreshToken, 'staff').expect(401);
    await refresh(client.refreshToken, 'client').expect(200);
  });
});
