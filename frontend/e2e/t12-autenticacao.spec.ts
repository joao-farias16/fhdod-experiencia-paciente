/**
 * T12 — Autenticação administrativa, ponta a ponta (RF01, RF02, RF05), com Supabase Auth local,
 * backend e frontend reais. Contas fictícias criadas para a execução (global-setup) no banco de
 * teste; nenhum dado de desenvolvimento é usado.
 */
import { expect, test } from '@playwright/test';

import { readFixture } from './fixture';
import { capture, expectNoHorizontalScroll, GENERIC_ERROR, login, logout } from './support';

const { accounts } = readFixture();

test('credenciais inválidas e e-mail inexistente: mesma mensagem genérica, permanece em /login', async ({
  page,
}, testInfo) => {
  await login(page, accounts.sa.email, 'SenhaErrada2026');
  await expect(page.getByRole('alert')).toHaveText(GENERIC_ERROR);
  await expect(page).toHaveURL(/\/login$/);
  await capture(page, testInfo, 'TL01-login-erro');

  await login(page, 'nao.existe@example.com', 'SenhaErrada2026');
  await expect(page.getByRole('alert')).toHaveText(GENERIC_ERROR);
  await expect(page).toHaveURL(/\/login$/);
  await expectNoHorizontalScroll(page);
});

test('sem sessão, a rota administrativa redireciona a /login', async ({ page }) => {
  await page.goto('/admin/usuarios');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Acesso administrativo' })).toBeVisible();
});

test('SA entra; Sair revoga a sessão, limpa o armazenamento e Voltar não mostra dados', async ({
  page,
}) => {
  await login(page, accounts.sa.email, accounts.sa.password);
  await expect(page).toHaveURL(/\/admin\/usuarios$/);
  await expect(page.getByText(accounts.vi.email)).toBeVisible();
  const token = await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find((item) => item.startsWith('fhdod-admin-auth'));
    const raw = key === undefined ? null : sessionStorage.getItem(key);
    return (JSON.parse(raw ?? '{}') as { access_token?: string }).access_token ?? '';
  });
  expect(token).not.toBe('');
  // Uma segunda tela administrativa no histórico, para testar o Voltar depois de sair.
  await page.goto('/admin/auditoria');
  await expect(page.getByRole('heading', { name: 'Auditoria' })).toBeVisible();

  await logout(page);
  const stored = await page.evaluate(() =>
    Object.keys(sessionStorage).filter((key) => key.startsWith('fhdod-admin-auth')),
  );
  expect(stored).toEqual([]);

  // O access token anterior foi revogado pelo signOut: a API recusa (401).
  const status = await page.evaluate(async (accessToken) => {
    const response = await fetch('/api/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return response.status;
  }, token);
  expect(status).toBe(401);

  await page.goBack();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText(accounts.vi.email)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Gestão de usuários' })).toHaveCount(0);
  await page.goto('/admin/usuarios');
  await expect(page).toHaveURL(/\/login$/);
});

test('VI vai para o painel; menu sem Usuários/Auditoria; acesso direto negado na tela e na API', async ({
  page,
}) => {
  await login(page, accounts.vi.email, accounts.vi.password);
  await expect(page).toHaveURL(/\/painel$/);
  await expect(page.getByRole('heading', { name: 'Olá, Visualizador E2E' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Usuários' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Auditoria' })).toHaveCount(0);

  await page.goto('/admin/auditoria');
  await expect(page.getByRole('heading', { name: 'Acesso não permitido' })).toBeVisible();

  const status = await page.evaluate(async () => {
    const key = Object.keys(sessionStorage).find((item) => item.startsWith('fhdod-admin-auth'));
    const raw = key === undefined ? null : sessionStorage.getItem(key);
    const session = JSON.parse(raw ?? '{}') as { access_token?: string };
    const response = await fetch('/api/v1/admin/audit-logs', {
      headers: { Authorization: `Bearer ${session.access_token ?? ''}` },
    });
    return response.status;
  });
  expect(status).toBe(403);
});
