/**
 * Fluxos administrativos das ET04 e ET05 ponta a ponta, integrados à pesquisa pública (ET06), com
 * Supabase Auth local, backend e frontend reais: o SA cadastra uma equipe (TL05), importa a escala
 * por CSV com turno noturno (TL07, F08), confere a escala (TL06), cria e publica uma pesquisa (TL08,
 * F06), decodifica o QR Code com jsqr (T02) e responde pela URL decodificada (TL09, TL11).
 * Executado somente no projeto de computador (grava dados no banco de teste).
 */
import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';
import jsQR from 'jsqr';

import { readFixture } from './fixture';
import { capture, expectNoHorizontalScroll, login } from './support';

const { accounts } = readFixture();

function brDate(daysAhead: number): string {
  const date = new Date(Date.now() + daysAhead * 86_400_000);
  const local = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
  return local;
}

test('equipe, importação de escala, pesquisa publicada e QR Code decodificado', async ({
  page,
}, testInfo) => {
  const suffix = Date.now().toString(36).toUpperCase();
  const teamCode = `E2E-${suffix}`.slice(0, 20);

  // TL05 — equipe no Pronto Atendimento E2E.
  await login(page, accounts.sa.email, accounts.sa.password);
  await expect(page.getByRole('heading', { name: 'Gestão de usuários' })).toBeVisible();
  await page.goto('/admin/setores');
  await expect(page.getByRole('heading', { name: 'Setores e equipes' })).toBeVisible();
  await page.getByLabel('Equipes do setor').selectOption({ label: 'Pronto Atendimento E2E' });
  await page.getByRole('button', { name: 'Nova equipe' }).click();
  const teamDialog = page.getByRole('dialog', { name: 'Nova equipe' });
  await teamDialog.getByLabel('Código').fill(teamCode);
  await teamDialog.getByLabel('Nome').fill(`Equipe ${suffix}`);
  await teamDialog.getByRole('button', { name: 'Cadastrar equipe' }).click();
  await expect(page.getByText(`Equipe Equipe ${suffix} cadastrada.`)).toBeVisible();
  await capture(page, testInfo, 'TL05-setores-equipes', 'ET04-ET06');

  // TL07 — CSV com turno diurno e noturno: validação sem gravar e confirmação.
  await page.goto('/admin/escalas/importar');
  const csv = [
    'setor_codigo;equipe_codigo;data;turno;hora_inicio;hora_fim',
    `PA;${teamCode};${brDate(2)};MANHA;07:00;19:00`,
    `PA;${teamCode};${brDate(2)};NOITE;19:00;07:00`,
  ].join('\n');
  await page.getByLabel('Arquivo CSV').setInputFiles({
    name: 'escala-e2e.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  });
  await page.getByRole('button', { name: 'Validar arquivo' }).click();
  await expect(page.getByText('Arquivo válido')).toBeVisible();
  await capture(page, testInfo, 'TL07-importacao-validada', 'ET04-ET06');
  await page.getByRole('button', { name: 'Confirmar importação' }).click();
  await expect(page.getByText('Escala importada')).toBeVisible();

  // TL06 — escala do setor com o turno noturno terminando no dia seguinte.
  await page.goto('/admin/turnos');
  await page.getByLabel('Setor', { exact: true }).selectOption({ label: 'Pronto Atendimento E2E' });
  await expect(page.getByText('19:00–07:00 (dia seguinte)')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await capture(page, testInfo, 'TL06-escala', 'ET04-ET06');

  // TL08 — pesquisa criada, pergunta incluída e versão 1 publicada.
  await page.goto('/admin/pesquisas');
  await page.getByRole('button', { name: 'Nova pesquisa' }).click();
  const create = page.getByRole('dialog', { name: 'Nova pesquisa' });
  await create.getByLabel('Setor').selectOption({ label: 'Pronto Atendimento E2E' });
  await create.getByLabel('Título').fill(`Pesquisa E2E ${suffix}`);
  await create.getByRole('button', { name: 'Criar rascunho' }).click();
  await expect(page.getByRole('heading', { name: `Pesquisa E2E ${suffix}` })).toBeVisible();
  await page.getByRole('button', { name: 'Nova pergunta' }).click();
  const question = page.getByRole('dialog', { name: 'Nova pergunta específica' });
  await question.getByLabel('Texto da pergunta').fill('Como foi o acolhimento?');
  await question.getByLabel('Etapa da jornada').selectOption({ label: 'Recepção' });
  await question.getByRole('button', { name: 'Salvar pergunta' }).click();
  await expect(page.getByText('Pergunta incluída.')).toBeVisible();
  await page.getByRole('button', { name: 'Publicar versão 1' }).click();
  await page
    .getByRole('dialog', { name: 'Publicar versão 1' })
    .getByRole('button', { name: 'Publicar' })
    .click();
  await expect(page.getByText('Versão 1 publicada.')).toBeVisible();
  await capture(page, testInfo, 'TL08-pesquisa-publicada', 'ET04-ET06');

  // T02 — os arquivos PNG e SVG baixados decodificam (jsqr) para a URL exata com origem=qr.
  const qrUrl = (await page.locator('dd', { hasText: /\?origem=qr$/ }).innerText()).trim();
  expect(qrUrl).toMatch(/^http:\/\/localhost:5174\/p\/pesquisa-e2e-[a-z0-9-]+\?origem=qr$/);
  const slug = new URL(qrUrl).pathname.split('/').pop() ?? '';
  const decodeDownload = async (button: string, mimeType: string) => {
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: button }).click();
    const file = await downloading;
    const extension = mimeType === 'image/png' ? 'png' : 'svg';
    expect(file.suggestedFilename()).toBe(`qrcode-${slug}.${extension}`);
    const content = readFileSync(await file.path());
    const pixels = await page.evaluate(
      async ({ base64, type }) => {
        const image = new Image();
        image.src = `data:${type};base64,${base64}`;
        await image.decode();
        const target = document.createElement('canvas');
        target.width = 400;
        target.height = 400;
        const context = target.getContext('2d');
        if (context === null) return [];
        context.fillStyle = '#fff';
        context.fillRect(0, 0, 400, 400);
        context.drawImage(image, 0, 0, 400, 400);
        return Array.from(context.getImageData(0, 0, 400, 400).data);
      },
      { base64: content.toString('base64'), type: mimeType },
    );
    return jsQR(Uint8ClampedArray.from(pixels), 400, 400)?.data;
  };
  expect(await decodeDownload('Baixar PNG', 'image/png')).toBe(qrUrl);
  const decoded = await decodeDownload('Baixar SVG', 'image/svg+xml');
  expect(decoded).toBe(qrUrl);

  // A URL decodificada abre a pesquisa publicada e registra a resposta (integração ET05 → ET06).
  await page.goto(decoded ?? '');
  await page.getByRole('radio', { name: '9', exact: true }).click();
  await page.getByRole('button', { name: /Continuar/ }).click();
  await page.getByRole('radio', { name: '5 — Muito bom' }).click();
  await page.getByRole('button', { name: /^Enviar$/ }).click();
  await expect(page.getByRole('heading', { name: 'Resposta enviada' })).toBeVisible();
});
