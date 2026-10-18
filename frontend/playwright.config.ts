import { existsSync } from 'node:fs';

import { defineConfig } from '@playwright/test';

// Variáveis locais do backend (banco de TESTE e Supabase local); nunca serviços remotos.
if (existsSync('../backend/.env')) process.loadEnvFile('../backend/.env');

const BACKEND_PORT = '3334';
const FRONTEND_PORT = '5174';

/**
 * Testes ponta a ponta (Seção 12) com Supabase Auth local, backend e frontend reais. Portas
 * próprias (3334 e 5174) para não reutilizar servidores de desenvolvimento: o backend dos testes
 * usa TEST_DATABASE_URL, e as contas fictícias são criadas e excluídas pelo global-setup/teardown.
 * Usa o Chrome instalado (channel: 'chrome'), sem baixar navegadores. Exige `npm run db:start`.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    channel: 'chrome',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'computador-1440', use: { viewport: { width: 1440, height: 900 } } },
    {
      name: 'celular-360',
      // O fluxo administrativo grava dados; roda uma vez, no computador.
      testIgnore: /administracao\.spec\.ts/,
      use: { viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: [
    {
      command: 'npx tsx src/server.ts',
      cwd: '../backend',
      url: `http://localhost:${BACKEND_PORT}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: BACKEND_PORT,
        DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
        CORS_ORIGIN: `http://localhost:${FRONTEND_PORT}`,
        LOG_LEVEL: 'warn',
      },
    },
    {
      command: 'npx vite',
      url: `http://localhost:${FRONTEND_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_PORT: FRONTEND_PORT, VITE_PROXY_TARGET: `http://localhost:${BACKEND_PORT}` },
    },
  ],
});
