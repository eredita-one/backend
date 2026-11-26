import { validateEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/api',
  JWT_STAFF_SECRET: 's'.repeat(32),
  JWT_CLIENT_SECRET: 'c'.repeat(32),
};

describe('validateEnv', () => {
  it('aplica os padrões e converte números', () => {
    const env = validateEnv({ ...base, PORT: '4000' });
    expect(env.PORT).toBe(4000);
    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(env.SWAGGER_ENABLED).toBe(false);
  });

  it('exige segredos de pelo menos 32 caracteres', () => {
    expect(() => validateEnv({ ...base, JWT_STAFF_SECRET: 'curto' })).toThrow(
      /JWT_STAFF_SECRET/,
    );
  });

  it('não aceita o mesmo segredo para equipe e clientes', () => {
    expect(() =>
      validateEnv({ ...base, JWT_CLIENT_SECRET: base.JWT_STAFF_SECRET }),
    ).toThrow(/precisa ser diferente/);
  });

  it('não sobe sem segredo nem banco', () => {
    expect(() => validateEnv({})).toThrow(
      /DATABASE_URL[\s\S]*JWT_STAFF_SECRET/,
    );
  });
});
