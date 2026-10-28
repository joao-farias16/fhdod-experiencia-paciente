/**
 * Fluxo administrativo ponta a ponta (TL16 → TL02 → TL17; RF03, RF04, RF06, RF09, RF11) com
 * Supabase Auth local real: o SA cadastra um usuário (senha temporária exibida uma vez), o usuário
 * troca a senha no primeiro acesso, o SA o desativa (login bloqueado) e consulta a auditoria.
 * Executado somente no projeto de computador (playwright.config.ts); o de celular cobre o T12.
 */
import { expect, test } from '@playwright/test';

import { readFixture } from './fixture';
import { capture, expectNoHorizontalScroll, GENERIC_ERROR, login, logout } from './support';

const { accounts } = readFixture();

test('cadastro, troca obrigatória, desativação, redefinição e auditoria', async ({
  page,
}, testInfo) => {
  const suffix = Date.now().toString(36);
  const email = `e2e-novo.${suffix}@example.com`;
  const finalPassword = 'SenhaDefinitivaE2e2026'; // gitleaks:allow — senha fictícia de teste

  // 1. SA cadastra um Gestor restrito ao Pronto Atendimento.
  await login(page, accounts.sa.email, accounts.sa.password);
  await expect(page.getByRole('heading', { name: 'Gestão de usuários' })).toBeVisible();
  await page.getByRole('button', { name: 'Novo usuário' }).click();
  const form = page.getByRole('dialog', { name: 'Novo usuário' });
  await form.getByLabel('Nome completo').fill('Pessoa Criada E2E');
  await form.getByLabel('E-mail').fill(email);
  await form.getByLabel('Perfil').selectOption('management');
  await form.getByLabel('Setores específicos').check();
  await form.getByLabel('Pronto Atendimento E2E').check();
  await capture(page, testInfo, 'TL16-novo-usuario');
  await form.getByRole('button', { name: 'Cadastrar usuário' }).click();

  const passwordDialog = page.getByRole('dialog', { name: 'Senha temporária' });
  const temporaryPassword = (
    await passwordDialog.getByLabel('Senha temporária').innerText()
  ).trim();
  expect(temporaryPassword).toMatch(/^[A-Za-z0-9]{16}$/);
  await capture(page, testInfo, 'TL16-senha-temporaria');
  await passwordDialog.getByRole('button', { name: 'Concluir' }).click();
  await expect(page.getByText(temporaryPassword)).toHaveCount(0);
  await expect(page.getByText(email)).toBeVisible();
  await capture(page, testInfo, 'TL16-lista');
  await logout(page);

  // 2. Primeiro acesso: troca obrigatória (TL02).
  await login(page, email, temporaryPassword);
  await expect(page).toHaveURL(/\/trocar-senha$/);
  await expect(page.getByRole('heading', { name: 'Troca obrigatória de senha' })).toBeVisible();
  await page.goto('/admin/usuarios');
  await expect(page).toHaveURL(/\/trocar-senha$/);
  await page.getByLabel('Nova senha', { exact: true }).fill('semnumeros');
  await page.getByLabel('Confirme a nova senha').fill('semnumeros');
  await page.getByRole('button', { name: 'Salvar nova senha' }).click();
  await expect(page.getByText('A senha não atende a todas as regras abaixo.')).toBeVisible();
  await capture(page, testInfo, 'TL02-troca-obrigatoria');
  await page.getByLabel('Nova senha', { exact: true }).fill(finalPassword);
  await page.getByLabel('Confirme a nova senha').fill(finalPassword);
  await page.getByRole('button', { name: 'Salvar nova senha' }).click();
  await expect(page).toHaveURL(/\/painel$/);
  await expect(page.getByText('Senha alterada com sucesso.')).toBeVisible();
  await expect(page.getByText('Pronto Atendimento E2E')).toBeVisible();
  await logout(page);

  // A senha temporária deixou de autenticar.
  await login(page, email, temporaryPassword);
  await expect(page.getByRole('alert')).toHaveText(GENERIC_ERROR);

  // 3. SA desativa o usuário; o login passa a ser recusado com a mensagem genérica.
  await login(page, accounts.sa.email, accounts.sa.password);
  await page.getByRole('button', { name: 'Desativar Pessoa Criada E2E' }).click();
  await page
    .getByRole('dialog', { name: 'Desativar usuário' })
    .getByRole('button', { name: 'Desativar' })
    .click();
  await expect(page.getByText('Usuário Pessoa Criada E2E desativado.')).toBeVisible();
  await logout(page);
  await login(page, email, finalPassword);
  await expect(page.getByRole('alert')).toHaveText(GENERIC_ERROR);

  // 4. SA reativa, redefine a senha do usuário e consulta a auditoria (TL17).
  await login(page, accounts.sa.email, accounts.sa.password);
  await page.getByRole('button', { name: 'Reativar Pessoa Criada E2E' }).click();
  await page
    .getByRole('dialog', { name: 'Reativar usuário' })
    .getByRole('button', { name: 'Reativar' })
    .click();
  await expect(page.getByText('Usuário Pessoa Criada E2E reativado.')).toBeVisible();
  await page.getByRole('button', { name: 'Redefinir senha de Pessoa Criada E2E' }).click();
  await page
    .getByRole('dialog', { name: 'Redefinir senha' })
    .getByRole('button', { name: 'Gerar senha temporária' })
    .click();
  const resetTemporary = (
    await page
      .getByRole('dialog', { name: 'Senha temporária' })
      .getByLabel('Senha temporária')
      .innerText()
  ).trim();
  expect(resetTemporary).toHaveLength(16);
  await page.getByRole('button', { name: 'Concluir' }).click();

  await page.getByRole('link', { name: 'Auditoria' }).click();
  await expect(page.getByRole('heading', { name: 'Auditoria' })).toBeVisible();
  for (const action of [
    'Usuário cadastrado',
    'Senha trocada pelo próprio usuário',
    'Usuário desativado',
    'Usuário reativado',
    'Senha redefinida pelo superadministrador',
  ]) {
    await expect(page.getByRole('cell', { name: action }).first()).toBeVisible();
  }
  // A trilha nunca mostra senhas nem e-mails.
  await expect(page.getByText(temporaryPassword)).toHaveCount(0);
  await expect(page.getByText(finalPassword)).toHaveCount(0);
  await expect(page.getByRole('cell', { name: new RegExp(email) })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await capture(page, testInfo, 'TL17-auditoria');

  await page.getByLabel('Ação', { exact: true }).selectOption('USER_DEACTIVATED');
  await page.getByRole('button', { name: 'Filtrar' }).click();
  await expect(page.getByRole('cell', { name: 'Usuário desativado' })).toHaveCount(1);
  await expect(page.getByRole('cell', { name: 'Usuário cadastrado' })).toHaveCount(0);
});
