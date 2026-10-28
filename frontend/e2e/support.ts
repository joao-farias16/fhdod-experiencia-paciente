import { mkdirSync } from 'node:fs';
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
