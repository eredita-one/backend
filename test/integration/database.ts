/** Banco dos testes de integração. Nunca o de desenvolvimento: os testes apagam tudo. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://api:api@localhost:5432/api_backend_test';

export function assertTestDatabase(url: string) {
  const database = new URL(url).pathname.slice(1);
  if (!database.endsWith('_test')) {
    throw new Error(
      `Testes de integração só rodam num banco terminado em "_test" (recebido: "${database}").`,
    );
  }
}
