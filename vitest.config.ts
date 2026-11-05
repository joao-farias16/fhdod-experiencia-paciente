import { defineConfig } from 'vitest/config';

/**
 * Dois projetos de teste, ambos em `npm test`: `unidade-e-integracao` (sem banco) e `banco`
 * (MySQL real no banco de testes TEST_DB_*, recriado e migrado pelo global-setup a cada execução).
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
        // Integração com MySQL real (TEST_DB_*), em sequência: T12–T37, T32 e regras do banco.
        extends: true,
        test: { name: 'banco', include: ['tests/db/**/*.test.ts'], ...databaseTest },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts'],
    },
  },
});
