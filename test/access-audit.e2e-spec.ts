import type { AccessEvent } from '../src/modules/accounts/domain/access/access-events.js';
import { type Accounts, seedAccounts, staffToken } from './support/fixtures.js';
import { createTestApp, type TestApp } from './support/test-app.js';

describe('Auditoria paginada (GET /admin/access-audit)', () => {
  let t: TestApp;
  let accounts: Accounts;
  let adminToken: string;

  beforeEach(async () => {
    t = await createTestApp();
    accounts = await seedAccounts(t);
    adminToken = await staffToken(t, 'admin@eredita.test', 'ADMIN');
    // Começa do zero: só os eventos que cada teste grava.
    t.staff.events.length = 0;
  });

  afterEach(() => t.app.close());

  const audit = (query = '') =>
    t
      .http()
      .get(`/admin/access-audit${query}`)
      .auth(adminToken, { type: 'bearer' });

  /** Um evento por dia, a partir de 1º/11/2026, gravados em ordem. */
  async function seed(
    count: number,
    make: (day: number) => Partial<AccessEvent> = () => ({}),
  ) {
    const events: AccessEvent[] = Array.from({ length: count }, (_, i) => ({
      type: 'AccessProfileGranted',
      actorId: accounts.admin.id,
      subjectType: 'staff_user',
      subjectId: accounts.consultor.id,
      data: { n: i + 1 },
      occurredAt: new Date(Date.UTC(2026, 10, 1 + i, 12)),
      ...make(i + 1),
    }));
    await t.staff.append(events);
  }

  it('pagina do mais recente para o mais antigo, com o total', async () => {
    await seed(30);

    const first = await audit('?pageSize=25').expect(200);
    expect(first.body).toMatchObject({ total: 30, page: 1, pageSize: 25 });
    expect(first.body.items).toHaveLength(25);
    expect(first.body.items[0].data).toEqual({ n: 30 });

    const second = await audit('?page=2&pageSize=25').expect(200);
    expect(
      second.body.items.map((e: { data: { n: number } }) => e.data.n),
    ).toEqual([5, 4, 3, 2, 1]);

    const oldest = await audit('?order=asc&pageSize=3').expect(200);
    expect(
      oldest.body.items.map((e: { data: { n: number } }) => e.data.n),
    ).toEqual([1, 2, 3]);

    const beyond = await audit('?page=9').expect(200);
    expect(beyond.body).toMatchObject({ total: 30, items: [] });
  });

  it('filtra por tipo, pessoa (quem fez ou sobre quem) e período', async () => {
    await seed(10, (day) =>
      day <= 3
        ? { type: 'StaffUserDisabled', actorId: accounts.adminConsultor.id }
        : day === 4
          ? { actorId: null, subjectId: accounts.adminConsultor.id }
          : {},
    );

    const disabled = await audit('?type=StaffUserDisabled').expect(200);
    expect(disabled.body.total).toBe(3);

    // A gestora fez 3 (actor) e foi o assunto de 1 (subject).
    const gestora = await audit(
      `?personId=${accounts.adminConsultor.id}`,
    ).expect(200);
    expect(gestora.body.total).toBe(4);

    // Período: do dia 2 ao dia 5, inclusive.
    const period = await audit(
      '?from=2026-11-02&to=2026-11-05&order=asc',
    ).expect(200);
    expect(
      period.body.items.map((e: { data: { n: number } }) => e.data.n),
    ).toEqual([2, 3, 4, 5]);
  });

  it('busca pelo nome ou e-mail da pessoa e pelo nome do perfil', async () => {
    await seed(3, (day) =>
      day === 1
        ? { actorId: accounts.adminConsultor.id }
        : day === 2
          ? {
              subjectType: 'access_profile',
              subjectId: accounts.profiles.operations.id,
              actorId: accounts.admin.id,
            }
          : {},
    );

    // "gestora" é o nome (vem do e-mail) da conta adminConsultor.
    expect((await audit('?search=GESTORA').expect(200)).body.total).toBe(1);
    expect((await audit('?search=opera').expect(200)).body.total).toBe(1);
    expect((await audit('?search=ninguem-assim').expect(200)).body.total).toBe(
      0,
    );
  });

  it('recusa parâmetros inválidos', async () => {
    for (const query of [
      '?pageSize=101',
      '?page=0',
      '?type=Inventado',
      '?order=lado',
      '?from=2026-13-45',
      '?to=27/11/2026',
    ]) {
      const res = await audit(query).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
  });
});
