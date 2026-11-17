import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/desktop/test/**/*.test.ts', 'apps/sync-server/test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
  },
});
