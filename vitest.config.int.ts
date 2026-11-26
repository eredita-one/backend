import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './test/integration/database.js';
import { TEST_ENV } from './test/support/test-env.js';

/**
 * Testes de integração: API inteira contra o Postgres de teste (docker compose up -d).
 * Rodam um arquivo por vez, porque compartilham o mesmo banco.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/integration/**/*.int-spec.ts'],
    env: { ...TEST_ENV, DATABASE_URL: TEST_DATABASE_URL },
    globalSetup: ['./test/integration/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
