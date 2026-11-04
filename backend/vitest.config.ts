import { defineConfig } from 'vitest/config';

/**
 * Três projetos de teste. `npm test` roda `unidade-e-integracao` e `banco`; o projeto `supabase`
 * (Supabase Auth LOCAL real) roda só com `npm run test:supabase`, pois exige `npm run db:start`
 * e as chaves locais em backend/.env.
 */
const databaseTest = {
  globalSetup: ['tests/support/global-setup.ts'],
  fileParallelism: false,
  testTimeout: 30_000,
  hookTimeout: 120_000,
};

export default defineConfig({
  test: {
    environment: 'node',
    projects: [
      {
        extends: true,
        test: {
          name: 'unidade-e-integracao',
          include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
        },
      },
      {
        // Integração com PostgreSQL real (TEST_DATABASE_URL), em sequência: T32 e regras do banco.
        extends: true,
        test: { name: 'banco', include: ['tests/db/**/*.test.ts'], ...databaseTest },
      },
      {
        extends: true,
        test: { name: 'supabase', include: ['tests/supabase/**/*.test.ts'], ...databaseTest },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts', 'src/generated/**'],
    },
  },
});
