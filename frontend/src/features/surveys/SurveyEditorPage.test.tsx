/**
 * TL08 na interface (ET05): pesquisa publicada com setor, endereço e pergunta geral bloqueados,
 * link e QR Code com a URL exata (origem=qr), histórico de versões e publicação da versão seguinte.
 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { FakeAuthClient, json, meOf, mockApi, renderApp } from '../../test/admin-helpers';
import type { SurveyDetail } from './surveys-api';

const AS = meOf({
  role: 'sector_admin',
  allSectors: false,
  permissions: [
    'profile:read',
    'sectors:read',
    'teams:read',
    'journey_stages:read',
    'surveys:read',
    'surveys:create',
    'surveys:update',
    'surveys:publish',
  ],
});

const QR_URL = 'http://localhost:5173/p/pronto-atendimento?origem=qr';
const SURVEY: SurveyDetail = {
  id: 's1',
  sectorId: 'setor-pa',
  sectorCode: 'PA',
  sectorName: 'Pronto Atendimento',
  sectorIsActive: true,
  title: 'Avaliação do Pronto Atendimento',
  slug: 'pronto-atendimento',
  status: 'active',
  isActive: true,
  hasUnpublishedChanges: true,
  activeSpecificQuestions: 1,
  currentVersion: { id: 'v1', versionNumber: 1, publishedAt: '2026-10-20T12:00:00Z' },
  updatedAt: '2026-10-21T12:00:00Z',
  introText: null,
  thankYouMessage: 'Obrigado.',
  deactivatedAt: null,
  createdAt: '2026-10-19T12:00:00Z',
  questions: [
    {
      id: 'q-nps',
      type: 'nps',
      text: 'Recomendaria?',
      journeyStage: null,
      position: 1,
      isRequired: true,
      isActive: true,
      locked: true,
    },
    {
      id: 'q-1',
      type: 'scale_1_5',
      text: 'Como foi a recepção?',
      journeyStage: { id: 'st-1', code: 'RECEPCAO', name: 'Recepção', position: 1 },
      position: 2,
      isRequired: false,
      isActive: true,
      locked: true,
    },
    {
      id: 'q-2',
      type: 'scale_1_5',
      text: 'Pergunta nova',
      journeyStage: { id: 'st-1', code: 'RECEPCAO', name: 'Recepção', position: 1 },
      position: 3,
      isRequired: false,
      isActive: true,
      locked: false,
    },
  ],
  versions: [
    {
      id: 'v1',
      versionNumber: 1,
      title: 'Avaliação do Pronto Atendimento',
      introText: null,
      thankYouMessage: 'Obrigado.',
      publishedAt: '2026-10-20T12:00:00Z',
      publishedBy: { id: 'u-as', fullName: 'Administrador Fictício' },
      supersededAt: null,
      isCurrent: true,
      questions: [
        {
          id: 'svq-1',
          questionId: 'q-nps',
          type: 'nps',
          text: 'Recomendaria?',
          journeyStageName: null,
          position: 1,
        },
        {
          id: 'svq-2',
          questionId: 'q-1',
          type: 'scale_1_5',
          text: 'Como foi a recepção?',
          journeyStageName: 'Recepção',
          position: 2,
        },
      ],
    },
  ],
  links: { qrUrl: QR_URL, linkUrl: 'http://localhost:5173/p/pronto-atendimento?origem=link' },
};

describe('TL08 — editor de pesquisa', () => {
  it('bloqueia campos publicados, exibe QR com a URL exata e publica a versão 2', async () => {
    const user = userEvent.setup();
    const fake = new FakeAuthClient();
    fake.token = 'token-as';
    const api = mockApi({
      'GET /me': () => json({ data: AS }),
      'GET /admin/sectors': () => json({ data: [] }),
      'GET /admin/surveys/s1': () => json({ data: SURVEY }),
      'POST /admin/surveys/s1/publish': () =>
        json({ data: { ...SURVEY.versions[0], id: 'v2', versionNumber: 2 } }, 201),
    });
    renderApp('/admin/pesquisas/s1', fake);
    expect(await screen.findByRole('heading', { name: SURVEY.title })).toBeInTheDocument();

    expect(screen.getByLabelText('Endereço (slug)')).toBeDisabled();
    expect(screen.getByLabelText('Setor')).toBeDisabled();
    expect(screen.getByLabelText('Pergunta geral (0 a 10)')).toBeDisabled();
    // Pergunta publicada sem "Editar"; a nova (não publicada) pode ser editada.
    expect(
      screen.queryByRole('button', { name: 'Editar: Como foi a recepção?' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar: Pergunta nova' })).toBeInTheDocument();
    expect(screen.getByText('2 de 10 perguntas específicas ativas.')).toBeInTheDocument();

    expect(screen.getByText(QR_URL)).toBeInTheDocument();
    expect(screen.getByTitle(`QR Code da pesquisa: ${QR_URL}`)).toBeInTheDocument();
    expect(
      screen.getByText(/Publicada em 20\/10\/2026 09:00 por Administrador Fictício/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Publicar versão 2' }));
    const dialog = screen.getByRole('dialog', { name: 'Publicar versão 2' });
    await user.click(within(dialog).getByRole('button', { name: 'Publicar' }));
    expect(await screen.findByText('Versão 2 publicada.')).toBeInTheDocument();
    expect(
      api.calls.some((call) => call.method === 'POST' && call.path === '/admin/surveys/s1/publish'),
    ).toBe(true);
  });
});
