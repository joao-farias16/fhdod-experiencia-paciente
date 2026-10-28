import { defineConfig } from 'vitest/config';

/**
 * Testes contra o Supabase Auth LOCAL real (`npm run test:supabase -w backend`). Exigem
 * `npm run db:start` e as chaves locais em backend/.env; não fazem parte de `npm test`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/supabase/**/*.test.ts'],
    globalSetup: ['tests/db/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
