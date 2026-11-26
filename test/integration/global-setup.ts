import { execSync } from 'node:child_process';
import { assertTestDatabase, TEST_DATABASE_URL } from './database.js';

/** Antes da suíte: aplica as migrations no banco de teste (o mesmo comando do deploy). */
export default function setup() {
  assertTestDatabase(TEST_DATABASE_URL);
  try {
    execSync('pnpm exec prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
      stdio: 'pipe',
    });
  } catch (error) {
    const output = (error as { stderr?: Buffer }).stderr?.toString() ?? '';
    throw new Error(
      `Não foi possível preparar o banco de teste (${TEST_DATABASE_URL}). ` +
        `O Postgres está de pé? (docker compose up -d)\n${output}`,
    );
  }
}
