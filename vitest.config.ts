import { defineConfig } from 'vitest/config';
import { TEST_ENV } from './test/support/test-env.js';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts', 'prisma/**/*.spec.ts'],
    env: TEST_ENV,
  },
});
