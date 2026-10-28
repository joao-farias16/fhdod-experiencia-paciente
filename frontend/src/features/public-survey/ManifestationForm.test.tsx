/**
 * TL10 — manifestação na interface (ET07):
 * T07: nota baixa (NPS 3) → oferta em destaque com Registrar manifestação e Não, obrigado; a recusa
 * não chama o E03; NPS 10 → só a ação secundária. Envio → protocolo na confirmação.
 * T08: a opção padrão é anônima (sem contato no corpo do E03).
 * T09: contato só com e-mail é aceito; sem aceite ou telefone de 9 dígitos → mensagem e nada enviado.
 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  apiError,
  type ApiCall,
  FakeAuthClient,
  json,
  mockApi,
  renderApp,
} from '../../test/admin-helpers';
import type { PublicSurvey } from './public-survey-api';

const SURVEY: PublicSurvey = {
  surveyVersionId: '7c0b6a51-8d0e-4c47-9b1e-1a2b3c4d5e6f',
  versionNumber: 1,
  slug: 'pronto-atendimento',
  title: 'Avaliação do Pronto Atendimento',
  introText: null,
  thankYouMessage: 'Obrigado pela avaliação.',
  sectorName: 'Pronto Atendimento',
  npsQuestion: {
    id: 'q-nps',
    text: 'O quanto você recomendaria este setor?',
    anchors: { min: '0 = Nada provável', max: '10 = Extremamente provável' },
  },
  stages: [],
  scaleLabels: ['Muito ruim', 'Ruim', 'Regular', 'Bom', 'Muito bom'],
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DESCRIPTION = 'A espera na recepção passou de duas horas sem informação.';

function submitted(lowScore: boolean) {
  return json(
    {
      data: {
        responseId: 'resposta-1',
        submittedAt: '2026-10-28T15:00:00.000Z',
        lowScore,
        manifestation: { token: 'token-hmac', expiresAt: '2026-10-28T16:00:00.000Z' },
      },
    },
    201,
  );
}

async function evaluate(
  score: string,
  lowScore: boolean,
  extra: Parameters<typeof mockApi>[0] = {},
) {
  const user = userEvent.setup();
  const api = mockApi({
    'GET /public/surveys/pronto-atendimento': () => json({ data: SURVEY }),
    'POST /public/responses': () => submitted(lowScore),
    'POST /public/manifestations': () =>
      json({ data: { protocol: 'FHD-2026-000184', receivedAt: '2026-10-28T15:02:00.000Z' } }, 201),
    ...extra,
  });
  renderApp('/p/pronto-atendimento', new FakeAuthClient());
  await screen.findByRole('heading', { name: SURVEY.npsQuestion.text });
  await user.click(screen.getByRole('radio', { name: score }));
  await user.click(screen.getByRole('button', { name: /^Enviar$/ }));
  await screen.findByRole('heading', { name: 'Resposta enviada' });
  return { user, api };
}

const manifestationCalls = (calls: ApiCall[]) =>
  calls.filter((call) => call.method === 'POST' && call.path === '/public/manifestations');

beforeEach(() => {
  sessionStorage.clear();
});

describe('T07 — oferta após nota baixa', () => {
  it('NPS 3 → oferta em destaque; "Não, obrigado" esconde a oferta sem chamar o E03', async () => {
    const { user, api } = await evaluate('3', true);
    expect(
      screen.getByRole('heading', { name: 'Quer contar o que aconteceu?' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Não, obrigado' }));
    expect(
      screen.queryByRole('heading', { name: 'Quer contar o que aconteceu?' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Registrar manifestação/ }),
    ).not.toBeInTheDocument();
    expect(manifestationCalls(api.calls)).toHaveLength(0);
  });

  it('NPS 10 → sem oferta em destaque, só a ação secundária', async () => {
    await evaluate('10', false);
    expect(
      screen.queryByRole('heading', { name: 'Quer contar o que aconteceu?' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Deixar um elogio, sugestão ou reclamação/ }),
    ).toBeInTheDocument();
  });

  it('registrar: valida tipo e descrição, envia anônima por padrão (T08) e mostra o protocolo', async () => {
    const { user, api } = await evaluate('3', true);
    await user.click(screen.getByRole('button', { name: /Registrar manifestação/ }));
    const form = screen.getByRole('form', { name: 'Registrar manifestação' });
    expect(within(form).getByRole('radio', { name: 'Enviar sem me identificar' })).toBeChecked();

    await user.type(within(form).getByLabelText('O que você quer contar?'), 'curto');
    await user.click(within(form).getByRole('button', { name: /Enviar manifestação/ }));
    expect(within(form).getByText('Escolha o tipo da manifestação.')).toBeInTheDocument();
    expect(within(form).getByText('Escreva pelo menos 10 caracteres.')).toBeInTheDocument();
    expect(manifestationCalls(api.calls)).toHaveLength(0);

    await user.click(within(form).getByRole('radio', { name: 'Reclamação' }));
    await user.clear(within(form).getByLabelText('O que você quer contar?'));
    await user.type(within(form).getByLabelText('O que você quer contar?'), DESCRIPTION);
    await user.click(within(form).getByRole('button', { name: /Enviar manifestação/ }));

    expect(await screen.findByText('FHD-2026-000184')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Manifestação registrada' })).toBeInTheDocument();
    const [call] = manifestationCalls(api.calls);
    expect(call?.idempotencyKey).toMatch(UUID_V4);
    expect(call?.body).toEqual({
      responseId: 'resposta-1',
      manifestationToken: 'token-hmac',
      type: 'complaint',
      description: DESCRIPTION,
      anonymous: true,
    });
    // Nada da manifestação fica no sessionStorage (dados só em memória).
    expect(Object.keys(sessionStorage).filter((key) => key.startsWith('fhdod:'))).toEqual([]);
  });
});

describe('T09 — contato opcional', () => {
  it('sem aceite e telefone de 9 dígitos → mensagens e nada enviado; só e-mail com aceite → enviado', async () => {
    const { user, api } = await evaluate('2', true);
    await user.click(screen.getByRole('button', { name: /Registrar manifestação/ }));
    const form = screen.getByRole('form', { name: 'Registrar manifestação' });
    await user.click(within(form).getByRole('radio', { name: 'Sugestão' }));
    await user.type(within(form).getByLabelText('O que você quer contar?'), DESCRIPTION);
    await user.click(within(form).getByRole('radio', { name: /Quero informar meu contato/ }));
    expect(within(form).getByText(/somente pela Ouvidoria/)).toBeInTheDocument();

    await user.type(within(form).getByLabelText('Nome'), 'Contato Fictício 001');
    await user.type(within(form).getByLabelText('Telefone com DDD (opcional)'), '519000009');
    await user.click(within(form).getByRole('button', { name: /Enviar manifestação/ }));
    expect(
      within(form).getByText('Informe o telefone com DDD (10 ou 11 dígitos).'),
    ).toBeInTheDocument();
    expect(
      within(form).getByText('Marque o aceite para informar seu contato.'),
    ).toBeInTheDocument();
    expect(manifestationCalls(api.calls)).toHaveLength(0);

    await user.clear(within(form).getByLabelText('Telefone com DDD (opcional)'));
    await user.type(within(form).getByLabelText('E-mail (opcional)'), 'c001@example.com');
    await user.click(within(form).getByRole('checkbox', { name: /Li e aceito/ }));
    await user.click(within(form).getByRole('button', { name: /Enviar manifestação/ }));

    await screen.findByText('FHD-2026-000184');
    expect(manifestationCalls(api.calls)[0]?.body).toMatchObject({
      type: 'suggestion',
      anonymous: false,
      contact: { fullName: 'Contato Fictício 001', email: 'c001@example.com', consent: true },
    });
  });

  it('token expirado (422) → mensagem do servidor e sem nova tentativa', async () => {
    const { user } = await evaluate('3', true, {
      'POST /public/manifestations': () =>
        apiError(
          422,
          'MANIFESTATION_TOKEN_EXPIRED',
          'O prazo para registrar a manifestação terminou.',
        ),
    });
    await user.click(screen.getByRole('button', { name: /Registrar manifestação/ }));
    const form = screen.getByRole('form', { name: 'Registrar manifestação' });
    await user.click(within(form).getByRole('radio', { name: 'Reclamação' }));
    await user.type(within(form).getByLabelText('O que você quer contar?'), DESCRIPTION);
    await user.click(within(form).getByRole('button', { name: /Enviar manifestação/ }));
    expect(
      await within(form).findByText('O prazo para registrar a manifestação terminou.'),
    ).toBeInTheDocument();
    expect(
      within(form).queryByRole('button', { name: /Tentar enviar de novo/ }),
    ).not.toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Voltar' }));
    expect(screen.getByRole('heading', { name: 'Resposta enviada' })).toBeInTheDocument();
  });
});
