/**
 * TL09 e TL11 — pesquisa pública na interface (ET06): pergunta geral obrigatória com mensagem e
 * foco (T03), etapas com progresso, Voltar e recarga (T27, RF36), envio idempotente com reenvio
 * automático (T10, RF37), confirmação e limpeza (T28, RF38, RF39), inatividade e páginas 404/410.
 */
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiError, FakeAuthClient, json, mockApi, renderApp } from '../../test/admin-helpers';
import type { PublicSurvey } from './public-survey-api';

const SURVEY: PublicSurvey = {
  surveyVersionId: '7c0b6a51-8d0e-4c47-9b1e-1a2b3c4d5e6f',
  versionNumber: 2,
  slug: 'pronto-atendimento',
  title: 'Avaliação do Pronto Atendimento',
  introText: 'Leva menos de um minuto.',
  thankYouMessage: 'Obrigado! Sua opinião ajuda a melhorar o atendimento.',
  sectorName: 'Pronto Atendimento',
  npsQuestion: {
    id: 'q-nps',
    text: 'O quanto você recomendaria este setor a um amigo ou familiar?',
    anchors: { min: '0 = Nada provável', max: '10 = Extremamente provável' },
  },
  stages: [
    {
      name: 'Recepção',
      position: 1,
      questions: [
        { id: 'q-recepcao', text: 'Como foi a recepção?' },
        { id: 'q-espera', text: 'Como foi o tempo de espera?' },
      ],
    },
  ],
  scaleLabels: ['Muito ruim', 'Ruim', 'Regular', 'Bom', 'Muito bom'],
};

const PATH = '/p/pronto-atendimento?origem=qr';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CREATED = {
  data: {
    responseId: 'r-1',
    submittedAt: '2026-10-27T15:00:00.000Z',
    lowScore: false,
    manifestation: { token: 'token', expiresAt: '2026-10-27T16:00:00.000Z' },
  },
};

function fhdodKeys(): string[] {
  return Object.keys(sessionStorage).filter((key) => key.startsWith('fhdod:'));
}

function render(handlers: Parameters<typeof mockApi>[0] = {}) {
  const api = mockApi({
    'GET /public/surveys/pronto-atendimento': () => json({ data: SURVEY }),
    ...handlers,
  });
  return { api, ...renderApp(PATH, new FakeAuthClient()) };
}

const npsGroup = () => screen.getByRole('radiogroup', { name: SURVEY.npsQuestion.text });
const radio = (name: string | RegExp) => screen.getByRole('radio', { name });

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TL09 — pesquisa pública', () => {
  it('exige a nota geral (mensagem e foco), navega com progresso e mantém respostas ao voltar e recarregar', async () => {
    const user = userEvent.setup();
    const view = render();
    await screen.findByRole('heading', { name: SURVEY.npsQuestion.text });
    expect(screen.getByText('Etapa 1 de 2')).toBeInTheDocument();
    expect(screen.getByText('0 = Nada provável')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(11);

    await user.click(screen.getByRole('button', { name: /Continuar/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Escolha uma nota de 0 a 10 para continuar.',
    );
    await waitFor(() => {
      expect(npsGroup()).toHaveFocus();
    });
    expect(screen.getByText('Etapa 1 de 2')).toBeInTheDocument();

    await user.click(radio('9'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Continuar/ }));
    expect(screen.getByText('Etapa 2 de 2')).toBeInTheDocument();
    await user.click(screen.getAllByRole('radio', { name: '4 — Bom' })[0] as HTMLElement);
    expect(screen.getByRole('button', { name: 'Limpar resposta' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Voltar/ }));
    expect(radio('9')).toHaveAttribute('aria-checked', 'true');
    expect(fhdodKeys()).toEqual(['fhdod:pesquisa:pronto-atendimento']);

    // Recarga: as respostas voltam do sessionStorage (RF36).
    view.unmount();
    render();
    await screen.findByRole('heading', { name: SURVEY.npsQuestion.text });
    expect(radio('9')).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('button', { name: /Continuar/ }));
    expect(screen.getAllByRole('radio', { name: '4 — Bom' })[0]).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('envia com Idempotency-Key, repete automaticamente com a mesma chave após 503 e confirma só após 201', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const { api } = render({
      'POST /public/responses': () => {
        attempts += 1;
        return attempts === 1 ? apiError(503, 'SERVICE_UNAVAILABLE') : json(CREATED, 201);
      },
    });
    await screen.findByRole('heading', { name: SURVEY.npsQuestion.text });
    await user.click(radio('9'));
    await user.click(screen.getByRole('button', { name: /Continuar/ }));
    await user.click(screen.getAllByRole('radio', { name: '4 — Bom' })[0] as HTMLElement);
    await user.click(screen.getByRole('button', { name: /^Enviar$/ }));

    expect(
      await screen.findByRole('heading', { name: 'Resposta enviada' }, { timeout: 4_000 }),
    ).toBeInTheDocument();
    expect(screen.getByText(SURVEY.thankYouMessage)).toBeInTheDocument();
    const posts = api.calls.filter((call) => call.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[0]?.idempotencyKey).toMatch(UUID_V4);
    expect(posts[1]?.idempotencyKey).toBe(posts[0]?.idempotencyKey);
    expect(posts[0]?.body).toEqual({
      surveyVersionId: SURVEY.surveyVersionId,
      origin: 'qr_code',
      npsScore: 9,
      answers: [{ questionId: 'q-recepcao', score: 4 }],
    });
    // RF39: nada fica salvo depois de concluir; Concluir recomeça vazio.
    expect(fhdodKeys()).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Concluir' }));
    expect(await screen.findByText('Etapa 1 de 2')).toBeInTheDocument();
    expect(
      screen.getAllByRole('radio').every((item) => item.getAttribute('aria-checked') === 'false'),
    ).toBe(true);
  }, 10_000);

  it('falha definitiva mantém as respostas; repetir usa a mesma chave e mudar a resposta gera outra', async () => {
    const user = userEvent.setup();
    const { api } = render({
      'POST /public/responses': () =>
        apiError(500, 'INTERNAL_ERROR', 'Ocorreu um erro inesperado.'),
    });
    await screen.findByRole('heading', { name: SURVEY.npsQuestion.text });
    await user.click(radio('3'));
    await user.click(screen.getByRole('button', { name: /Continuar/ }));
    await user.click(screen.getByRole('button', { name: /^Enviar$/ }));
    expect(await screen.findByText('Sua resposta ainda não foi enviada')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Tentar enviar de novo/ }));
    await user.click(screen.getAllByRole('radio', { name: '2 — Ruim' })[1] as HTMLElement);
    await user.click(screen.getByRole('button', { name: /Tentar enviar de novo/ }));

    await waitFor(() => {
      expect(api.calls.filter((call) => call.method === 'POST')).toHaveLength(3);
    });
    const keys = api.calls
      .filter((call) => call.method === 'POST')
      .map((call) => call.idempotencyKey);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(screen.getByText('Etapa 2 de 2')).toBeInTheDocument();
    expect(fhdodKeys()).toHaveLength(1);
  });

  it('após 3 min sem uso pergunta "Você ainda está aí?" e, 60 s depois, apaga as respostas', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    render();
    await screen.findByRole('heading', { name: SURVEY.npsQuestion.text });
    await user.click(radio('7'));
    expect(fhdodKeys()).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(3 * 60_000);
    });
    expect(screen.getByRole('dialog', { name: 'Você ainda está aí?' })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      screen.getByText('Por segurança, as respostas foram apagadas depois de um tempo sem uso.'),
    ).toBeInTheDocument();
    expect(radio('7')).toHaveAttribute('aria-checked', 'false');
    expect(fhdodKeys()).toEqual([]);
  });

  it('slug inexistente → "Pesquisa não encontrada"; pesquisa inativa → "Pesquisa indisponível"', async () => {
    const missing = render({
      'GET /public/surveys/pronto-atendimento': () => apiError(404, 'NOT_FOUND'),
    });
    expect(
      await screen.findByRole('heading', { name: 'Pesquisa não encontrada' }),
    ).toBeInTheDocument();
    missing.unmount();
    render({ 'GET /public/surveys/pronto-atendimento': () => apiError(410, 'SURVEY_UNAVAILABLE') });
    expect(
      await screen.findByRole('heading', { name: 'Pesquisa indisponível' }),
    ).toBeInTheDocument();
  });
});
