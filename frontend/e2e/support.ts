import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, type Page, type TestInfo } from '@playwright/test';

export const GENERIC_ERROR = 'E-mail ou senha incorretos. Confira os dados e tente novamente.';

const EVIDENCE_ROOT = resolve(import.meta.dirname, '../../docs/evidencias');

export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

export async function logout(page: Page): Promise<void> {
  const menu = page.getByRole('button', { name: 'Menu' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/login$/);
}

/** RNF01: sem rolagem horizontal na página. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Captura de tela para docs/evidencias/<etapa>/telas (somente dados fictícios). */
export async function capture(
  page: Page,
  testInfo: TestInfo,
  name: string,
  stage = 'ET03',
): Promise<void> {
  const dir = `${EVIDENCE_ROOT}/${stage}/telas`;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/${name}-${testInfo.project.name}.png`, fullPage: true });
}

/** Arquivo com as contas fictícias da execução (ignorado pelo Git; apagado no teardown). */
export const FIXTURE_FILE = resolve(import.meta.dirname, '../playwright/.cache/e2e-fixture.json');

export interface E2EAccount {
  email: string;
  password: string;
}

export interface E2EFixture {
  hospitalId: string;
  accounts: { sa: E2EAccount; vi: E2EAccount; ou: E2EAccount; ge: E2EAccount };
  /** Pesquisas publicadas do Pronto Atendimento E2E (ET06): ativa e desativada. */
  surveys: { active: string; inactive: string };
}

/** Executa backend/scripts/e2e/fixture.ts (banco de teste e Supabase Auth locais). */
export function runFixture(command: 'setup' | 'teardown'): void {
  const result = spawnSync('npx', ['tsx', 'scripts/e2e/fixture.ts', command, FIXTURE_FILE], {
    cwd: resolve(import.meta.dirname, '../../backend'),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) throw new Error(`Falha ao preparar os dados E2E (${command}).`);
}

export function readFixture(): E2EFixture {
  if (!existsSync(FIXTURE_FILE))
    throw new Error('Dados E2E ausentes: o global-setup não foi executado.');
  return JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')) as E2EFixture;
}
