/**
 * Pesquisa pública ponta a ponta (ET06), com backend e frontend reais e o banco de TESTE:
 * T01 — link em contexto anônimo, slug inexistente (404) e pesquisa inativa (410);
 * T03 — sem nota não avança (mensagem e foco);
 * T27 — 360, 390, 820 e 1440 px, voltando e recarregando, sem rolagem horizontal e com alvos de toque;
 * T28 — concluir, usar Voltar e simular 3 min + 60 s de inatividade → sem chaves fhdod:*.
 */
import { expect, type Page, test } from '@playwright/test';

import { readFixture } from './fixture';
import { capture, expectNoHorizontalScroll } from './support';

const { surveys } = readFixture();
const QR_PATH = `/p/${surveys.active}?origem=qr`;
const NPS = /o quanto você recomendaria o atendimento/;

const fhdodKeys = (page: Page) =>
  page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('fhdod:')));

/** RNF05 e Tabela 22: 48 px nas escalas da pesquisa e 44 px nos demais botões. */
async function expectTouchTargets(page: Page): Promise<void> {
  const sizes = await page.locator('[role="radio"], main button').evaluateAll((elements) =>
    elements
      .filter((element) => element.getBoundingClientRect().width > 0)
      .map((element) => ({
        radio: element.getAttribute('role') === 'radio',
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
      })),
  );
  expect(sizes.length).toBeGreaterThan(0);
  for (const size of sizes) {
    const min = size.radio ? 48 : 44;
    expect(Math.round(size.width)).toBeGreaterThanOrEqual(min);
    expect(Math.round(size.height)).toBeGreaterThanOrEqual(min);
  }
}

test('T01 — abre por link sem login nem cookies; 404 e 410 com mensagem', async ({
  page,
  context,
}) => {
  await page.goto(`/p/${surveys.active}?origem=link`);
  await expect(page.getByRole('heading', { name: NPS })).toBeVisible();
  expect(await context.cookies()).toEqual([]);
  await expect(page.getByRole('link', { name: /usuários|auditoria/i })).toHaveCount(0);

  await page.goto('/p/pesquisa-que-nao-existe');
  await expect(page.getByRole('heading', { name: 'Pesquisa não encontrada' })).toBeVisible();
  await page.goto(`/p/${surveys.inactive}`);
  await expect(page.getByRole('heading', { name: 'Pesquisa indisponível' })).toBeVisible();
});

test('T03 e T27 — sem nota não avança; 360/390/820/1440 px sem rolagem; Voltar e recarga mantêm as respostas', async ({
  page,
}, testInfo) => {
  // Leiaute e alvos de toque nas quatro larguras (uma carga por largura: E01 tem limite por IP).
  await page.goto(QR_PATH);
  for (const width of [360, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: width < 640 ? 800 : 900 });
    await expect(page.getByRole('heading', { name: NPS })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);
    if (width === 360 || width === 1440)
      await capture(page, testInfo, `TL09-nota-${width}`, 'ET04-ET06');
  }

  // T03: sem nota não avança (mensagem e foco).
  await expect(page.getByText('Etapa 1 de 2')).toBeVisible();
  await page.getByRole('button', { name: /Continuar/ }).click();
  await expect(page.getByText('Escolha uma nota de 0 a 10 para continuar.')).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: NPS })).toBeFocused();

  // RF36: etapa 2, Voltar e recarga preservam as respostas.
  await page.getByRole('radio', { name: '8', exact: true }).click();
  await page.getByRole('button', { name: /Continuar/ }).click();
  await expect(page.getByText('Etapa 2 de 2')).toBeVisible();
  await page.getByRole('radio', { name: '5 — Muito bom' }).first().click();
  for (const width of [360, 820]) {
    await page.setViewportSize({ width, height: 800 });
    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);
  }
  await capture(page, testInfo, 'TL09-etapa', 'ET04-ET06');
  await page.getByRole('button', { name: /Voltar/ }).click();
  await expect(page.getByRole('radio', { name: '8', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.reload();
  await expect(page.getByRole('radio', { name: '8', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('button', { name: /Continuar/ }).click();
  await expect(page.getByRole('radio', { name: '5 — Muito bom' }).first()).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('T28 — concluir apaga os dados; Voltar não mostra respostas', async ({ page }, testInfo) => {
  await page.goto(QR_PATH);
  await page.getByRole('radio', { name: '10', exact: true }).click();
  await page.getByRole('button', { name: /Continuar/ }).click();
  await page.getByRole('radio', { name: '4 — Bom' }).first().click();
  const sent = page.waitForResponse(
    (response) => response.url().endsWith('/api/v1/public/responses') && response.status() === 201,
  );
  await page.getByRole('button', { name: /^Enviar$/ }).click();
  const request = (await sent).request();
  expect(request.headers()['idempotency-key']).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  await expect(page.getByRole('heading', { name: 'Resposta enviada' })).toBeVisible();
  await expect(
    page.getByText('Obrigado! Sua opinião ajuda a melhorar o atendimento.'),
  ).toBeVisible();
  await capture(page, testInfo, 'TL11-confirmacao', 'ET04-ET06');
  expect(await fhdodKeys(page)).toEqual([]);

  await page.goBack();
  await page.goForward();
  await expect(page.getByRole('heading', { name: NPS })).toBeVisible();
  await expect(page.getByRole('radio', { name: '10', exact: true })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  expect(await fhdodKeys(page)).toEqual([]);
});

test('T28 — 3 min + 60 s sem uso apagam as respostas', async ({ page }) => {
  await page.clock.install();
  await page.goto(QR_PATH);
  await page.getByRole('radio', { name: '6', exact: true }).click();
  expect(await fhdodKeys(page)).toHaveLength(1);
  await page.clock.fastForward('03:00');
  await expect(page.getByRole('dialog', { name: 'Você ainda está aí?' })).toBeVisible();
  await page.clock.fastForward('01:00');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Por segurança, as respostas foram apagadas')).toBeVisible();
  await expect(page.getByRole('radio', { name: '6', exact: true })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  expect(await fhdodKeys(page)).toEqual([]);
});
