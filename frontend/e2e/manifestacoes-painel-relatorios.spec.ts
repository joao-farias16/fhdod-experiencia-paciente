/**
 * ET07–ET09 ponta a ponta, com backend e frontend reais e o banco de TESTE:
 * T07/T08 — QR Code, nota baixa, oferta em destaque, manifestação anônima (padrão) e protocolo;
 *   nota 10 sem oferta em destaque.
 * T09 — manifestação com contato (só e-mail) e aceite da finalidade.
 * T18/T19 — Ouvidoria: lista, detalhe, mudança de status, nota interna, contato auditado e eliminação.
 * T11 — painel com uma resposta nova: Atualizar → total + 1 com n visível.
 * T20 — exportação do painel baixa um .xlsx com o nome padronizado.
 */
import { expect, type Page, test } from '@playwright/test';

import { readFixture } from './fixture';
import { capture, expectNoHorizontalScroll, login, logout } from './support';

const { surveys, accounts } = readFixture();
const QR_PATH = `/p/${surveys.active}?origem=qr`;
const NPS = /o quanto você recomendaria o atendimento/;
const DESCRIPTION = 'A espera na recepção passou de duas horas sem nenhuma informação.';

test.describe.configure({ mode: 'serial' });

/** Responde a pesquisa pelo QR Code com a nota geral informada e envia. */
async function evaluate(page: Page, score: string): Promise<void> {
  await page.goto(QR_PATH);
  await expect(page.getByRole('heading', { name: NPS })).toBeVisible();
  await page.getByRole('radio', { name: score, exact: true }).click();
  await page.getByRole('button', { name: /Continuar/ }).click();
  await page.getByRole('button', { name: /^Enviar$/ }).click();
  await expect(page.getByRole('heading', { name: 'Resposta enviada' })).toBeVisible();
}

async function manifest(page: Page, type: string, description: string): Promise<string> {
  await page.getByRole('button', { name: /Registrar manifestação/ }).click();
  const form = page.getByRole('form', { name: 'Registrar manifestação' });
  await form.getByRole('radio', { name: type }).check();
  await form.getByLabel('O que você quer contar?').fill(description);
  return description;
}

let anonymousProtocol = '';
let contactProtocol = '';

test('T07/T08 — nota baixa pelo QR Code: oferta, manifestação anônima e protocolo', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'computador-1440', 'Grava dados: roda uma vez.');
  await evaluate(page, '3');
  await expect(page.getByRole('heading', { name: 'Quer contar o que aconteceu?' })).toBeVisible();
  await capture(page, testInfo, 'TL11-oferta-nota-baixa', 'ET07');

  await manifest(page, 'Reclamação', DESCRIPTION);
  const form = page.getByRole('form', { name: 'Registrar manifestação' });
  await expect(form.getByRole('radio', { name: 'Enviar sem me identificar' })).toBeChecked();
  await capture(page, testInfo, 'TL10-manifestacao', 'ET07');
  await form.getByRole('button', { name: /Enviar manifestação/ }).click();

  await expect(page.getByRole('heading', { name: 'Manifestação registrada' })).toBeVisible();
  anonymousProtocol = (await page.getByText(/^FHD-\d{4}-\d{6}$/).textContent()) ?? '';
  expect(anonymousProtocol).toMatch(/^FHD-\d{4}-\d{6}$/);
  await capture(page, testInfo, 'TL11-protocolo', 'ET07');
  // RF39: nada da avaliação nem da manifestação fica no sessionStorage.
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter((key) => key.startsWith('fhdod:')),
    ),
  ).toEqual([]);
});

test('T07 — nota 10: sem oferta em destaque, só a ação secundária', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'computador-1440', 'Grava dados: roda uma vez.');
  await evaluate(page, '10');
  await expect(page.getByRole('heading', { name: 'Quer contar o que aconteceu?' })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /Deixar um elogio, sugestão ou reclamação/ }),
  ).toBeVisible();
});

test('T09 — contato só com e-mail e aceite; formulário sem rolagem horizontal em 360 px', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'computador-1440', 'Grava dados: roda uma vez.');
  await page.setViewportSize({ width: 360, height: 800 });
  await evaluate(page, '2');
  await manifest(page, 'Sugestão', 'Seria bom ter um painel com a ordem de chamada na recepção.');
  const form = page.getByRole('form', { name: 'Registrar manifestação' });
  await form.getByRole('radio', { name: /Quero informar meu contato/ }).check();
  await form.getByLabel('Nome').fill('Contato Fictício E2E');
  await form.getByLabel('E-mail (opcional)').fill('contato.e2e@example.com');
  await form.getByRole('button', { name: /Enviar manifestação/ }).click();
  await expect(form.getByText('Marque o aceite para informar seu contato.')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await capture(page, testInfo, 'TL10-contato-celular', 'ET07');
  await form.getByRole('checkbox', { name: /Li e aceito/ }).check();
  await form.getByRole('button', { name: /Enviar manifestação/ }).click();
  await expect(page.getByRole('heading', { name: 'Manifestação registrada' })).toBeVisible();
  contactProtocol = (await page.getByText(/^FHD-\d{4}-\d{6}$/).textContent()) ?? '';
});

test('T18/T19 — Ouvidoria: status, nota, contato auditado e eliminação', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'computador-1440', 'Grava dados: roda uma vez.');
  await login(page, accounts.ou.email, accounts.ou.password);
  await page.getByRole('link', { name: 'Ouvidoria' }).click();
  await expect(page.getByRole('heading', { name: 'Manifestações' })).toBeVisible();
  const table = page.getByRole('region', { name: 'Tabela de manifestações' });
  await expect(table.getByRole('link', { name: anonymousProtocol })).toBeVisible();
  await capture(page, testInfo, 'TL12-lista', 'ET07');

  await table.getByRole('link', { name: anonymousProtocol }).click();
  await expect(
    page.getByRole('heading', { name: `Manifestação ${anonymousProtocol}` }),
  ).toBeVisible();
  await expect(page.getByText(DESCRIPTION)).toBeVisible();
  await expect(page.getByText('Manifestação anônima: sem dados de contato.')).toBeVisible();
  await page.getByLabel('Novo status').selectOption('in_review');
  await page.getByLabel('Prioridade').selectOption('high');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByText('Status: Recebida → Em análise.')).toBeVisible();
  await expect(page.getByText('Prioridade: Média → Alta.')).toBeVisible();
  await page.getByLabel('Nova nota interna').fill('Contato feito com a coordenação da recepção.');
  await page.getByRole('button', { name: 'Adicionar nota' }).click();
  await expect(
    page.getByText('Nota interna: Contato feito com a coordenação da recepção.'),
  ).toBeVisible();
  await capture(page, testInfo, 'TL13-detalhe', 'ET07');

  await page.getByRole('link', { name: 'Voltar para a lista' }).click();
  await table.getByRole('link', { name: contactProtocol }).click();
  await page.getByRole('button', { name: /Ver contato/ }).click();
  await expect(page.getByText('contato.e2e@example.com')).toBeVisible();
  await page.getByRole('button', { name: /Eliminar contato/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Eliminar os dados de contato?' });
  await dialog.getByLabel('Motivo').selectOption('return_completed');
  await dialog.getByRole('button', { name: 'Eliminar contato' }).click();
  await expect(page.getByText('Os dados de contato foram eliminados.')).toBeVisible();
  await expect(page.getByText(/Dados de contato eliminados \(Retorno concluído\)/)).toBeVisible();
  await logout(page);
});

test('T11 e T20 — painel atualiza com nova resposta e exporta .xlsx', async ({
  page,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'computador-1440', 'Grava dados: roda uma vez.');
  await login(page, accounts.ge.email, accounts.ge.password);
  await expect(page).toHaveURL(/\/painel$/);
  await expect(page.getByText('NPS', { exact: true }).first()).toBeVisible();
  const before = Number(
    /n = (\d+)/.exec(
      (await page
        .getByText(/^n = \d+$/)
        .first()
        .textContent()) ?? '',
    )?.[1],
  );
  await capture(page, testInfo, 'TL03-painel', 'ET08');

  const visitor = await browser.newPage();
  await evaluate(visitor, '9');
  await visitor.close();

  await page.getByRole('button', { name: 'Atualizar' }).click();
  await expect(page.getByText(`n = ${before + 1}`).first()).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar respostas (Excel)' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^fhdod_respostas_\d{8}-\d{8}_gerado-\d{12}\.xlsx$/);
  await expect(page.getByText(/Arquivo gerado: fhdod_respostas_/)).toBeVisible();

  await page.getByRole('link', { name: 'Pronto Atendimento E2E' }).click();
  await expect(page.getByRole('heading', { name: 'Pronto Atendimento E2E' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Perguntas por etapa da jornada' })).toBeVisible();
  await capture(page, testInfo, 'TL04-painel-setor', 'ET08');

  await page.getByRole('link', { name: 'Relatórios' }).click();
  await expect(page.getByLabel('Relatório', { exact: true })).toBeVisible();
  await capture(page, testInfo, 'TL14-relatorios', 'ET09');
  await logout(page);
});
