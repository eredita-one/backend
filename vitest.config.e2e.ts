import { defineConfig } from 'vitest/config';
import { TEST_ENV } from './test/support/test-env.js';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    env: TEST_ENV,
    // argon2 é lento de propósito; as suítes fazem dezenas de logins.
    testTimeout: 20_000,
  },
});
