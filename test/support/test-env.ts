/**
 * Ambiente dos testes. Os testes não leem o `.env` (veja `ignoreEnvFile` no AppModule):
 * tudo o que importa está aqui, para o resultado não depender da máquina.
 */
export const TEST_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/nao-usado-nos-testes',
  JWT_ISSUER: 'api-backend-test',
  JWT_STAFF_SECRET: 'segredo-de-teste-da-equipe-interna-0123456789',
  JWT_CLIENT_SECRET: 'segredo-de-teste-do-portal-do-cliente-0123456789',
  ACCESS_TOKEN_TTL_SECONDS: '900',
  REFRESH_TOKEN_TTL_HOURS: '12',
  REFRESH_TOKEN_REMEMBER_DAYS: '30',
  REFRESH_TOKEN_REUSE_GRACE_SECONDS: '10',
  LOGIN_MAX_ATTEMPTS: '5',
  LOGIN_LOCK_MINUTES: '15',
  AUTH_RATE_LIMIT_PER_MINUTE: '1000',
} as const;
