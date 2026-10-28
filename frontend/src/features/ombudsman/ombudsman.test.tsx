/**
 * TL12 e TL13 — Ouvidoria na interface (ET07):
 * T18: lista com trecho e indicação de contato; detalhe com linha do tempo; transições oferecidas
 * conforme o backend; conclusão sem providências bloqueada; 409 STALE_RESOURCE com recarga.
 * T19: contato só por ação explícita, com finalidade; eliminação com confirmação e motivo.
 * Perfis sem permissão não veem o menu nem a tela.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  apiError,
  FakeAuthClient,
  json,
  meOf,
  mockApi,
  renderApp,
  VIEWER,
} from '../../test/admin-helpers';
import type { Me } from '../auth/auth-types';
import type { ManifestationDetail, ManifestationListItem } from './ombudsman-api';

const OU: Me = meOf({
  id: '44444444-4444-4444-8444-444444444444',
  fullName: 'Ouvidoria Fictícia',
  role: 'ombudsman',
  permissions: [
    'profile:read',
    'profile:change_password',
    'sectors:read',
    'teams:read',
    'dashboard:read',
    'reports:export_manifestations',
    'manifestations:read',
    'manifestations:update',
    'manifestations:add_note',
    'manifestation_contact:read',
    'manifestation_contact:delete',
  ],
});

const ITEM: ManifestationListItem = {
  id: 'm-1',
  protocol: 'FHD-2026-000184',
  receivedAt: '2026-10-27T15:00:00.000Z',
  updatedAt: '2026-10-27T15:00:00.000Z',
  sector: { id: 'setor-a', name: 'Pronto Atendimento' },
  type: 'complaint',
  status: 'received',
  priority: 'medium',
  excerpt: 'A espera na recepção passou de duas horas sem informação.',
  isAnonymous: false,
  hasContact: true,
  triggeredByLowScore: true,
};

const DETAIL: ManifestationDetail = {
  ...ITEM,
  description: 'A espera na recepção passou de duas horas sem informação.',
  actionsTaken: null,
  resolvedAt: null,
  allowedTransitions: ['in_review', 'archived'],
  response: {
    id: 'r-1',
    submittedAt: '2026-10-27T14:58:00.000Z',
    origin: 'qr_code',
    npsScore: 3,
    lowScore: true,
    survey: { title: 'Avaliação do Pronto Atendimento', versionNumber: 2 },
    answers: [{ questionText: 'Como foi a recepção?', journeyStageName: 'Recepção', score: 2 }],
  },
  timeline: [
    {
      id: 'e-1',
      kind: 'created',
      content: null,
      fromValue: null,
      toValue: 'received',
      createdAt: '2026-10-27T15:00:00.000Z',
      author: null,
    },
  ],
};

function setup(path: string, handlers: Parameters<typeof mockApi>[0] = {}, me: Me = OU) {
  const client = new FakeAuthClient();
  client.token = 'token-ou';
  const api = mockApi({
    'GET /me': () => json({ data: me }),
    'GET /admin/sectors': () => json({ data: [] }),
    'GET /ouvidoria/manifestations': () =>
      json({
        data: [ITEM],
        meta: { page: 1, pageSize: 25, total: 1, from: '2026-09-29', to: '2026-10-28' },
      }),
    'GET /ouvidoria/manifestations/m-1': () => json({ data: DETAIL }),
    ...handlers,
  });
  return { api, ...renderApp(path, client) };
}

describe('T18 — lista e detalhe', () => {
  it('lista com protocolo, trecho e contato (Sim), sem dados de contato; filtro de status na consulta', async () => {
    const user = userEvent.setup();
    const view = setup('/ouvidoria/manifestacoes');
    const table = await screen.findByRole('region', { name: 'Tabela de manifestações' });
    expect(within(table).getByRole('link', { name: 'FHD-2026-000184' })).toHaveAttribute(
      'href',
      '/ouvidoria/manifestacoes/m-1',
    );
    expect(within(table).getByText(ITEM.excerpt)).toBeInTheDocument();
    expect(within(table).getByText('Sim')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Status'), 'in_review');
    await user.click(screen.getByRole('button', { name: 'Filtrar' }));
    await waitFor(() => {
      const last = view.api.calls
        .filter((call) => call.path === '/ouvidoria/manifestations')
        .at(-1);
      expect(last?.query.get('status')).toBe('in_review');
    });
  });

  it('detalhe: relato, avaliação vinculada, linha do tempo; só as transições permitidas', async () => {
    setup('/ouvidoria/manifestacoes/m-1');
    expect(
      await screen.findByRole('heading', { name: 'Manifestação FHD-2026-000184' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Manifestação recebida pela pesquisa pública/)).toBeInTheDocument();
    expect(screen.getByText(/Como foi a recepção\?/)).toBeInTheDocument();
    const status = screen.getByLabelText('Novo status');
    expect(
      within(status)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Manter', 'Em análise', 'Arquivada']);
    // O contato não é carregado sem a ação explícita (RF48).
    expect(screen.getByRole('button', { name: /Ver contato/ })).toBeInTheDocument();
  });

  it('arquivar sem nota → mensagem sem chamada; mudança válida envia updatedAt; 409 oferece recarga', async () => {
    const user = userEvent.setup();
    const view = setup('/ouvidoria/manifestacoes/m-1', {
      'PATCH /ouvidoria/manifestations/m-1': () =>
        apiError(
          409,
          'STALE_RESOURCE',
          'A manifestação foi alterada por outra pessoa. Recarregue para ver a versão atual.',
        ),
    });
    await screen.findByRole('heading', { name: 'Manifestação FHD-2026-000184' });
    await user.selectOptions(screen.getByLabelText('Novo status'), 'archived');
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect(screen.getByText('Para arquivar, registre uma nota com o motivo.')).toBeInTheDocument();
    expect(view.api.calls.some((call) => call.method === 'PATCH')).toBe(false);

    await user.selectOptions(screen.getByLabelText('Novo status'), 'in_review');
    await user.selectOptions(screen.getByLabelText('Prioridade'), 'high');
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect(await screen.findByText(/alterada por outra pessoa/)).toBeInTheDocument();
    expect(view.api.calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      updatedAt: DETAIL.updatedAt,
      status: 'in_review',
      priority: 'high',
    });
    expect(screen.getByRole('button', { name: /Recarregar a versão atual/ })).toBeInTheDocument();
  });
});

describe('T19 — contato auditado e eliminação', () => {
  it('Ver contato mostra finalidade e dados; Eliminar pede confirmação e envia o motivo', async () => {
    const user = userEvent.setup();
    const view = setup('/ouvidoria/manifestacoes/m-1', {
      'GET /ouvidoria/manifestations/m-1/contact': () =>
        json({
          data: {
            fullName: 'Contato Fictício 001',
            phone: '51900000001',
            email: null,
            consentGivenAt: '2026-10-27T15:00:00.000Z',
            purposeTextVersion: 'v1',
            purposeText: 'Seus dados de contato serão usados somente pela Ouvidoria.',
          },
        }),
      'DELETE /ouvidoria/manifestations/m-1/contact': () => new Response(null, { status: 204 }),
    });
    await screen.findByRole('heading', { name: 'Manifestação FHD-2026-000184' });
    await user.click(screen.getByRole('button', { name: /Ver contato/ }));
    expect(await screen.findByText('Contato Fictício 001')).toBeInTheDocument();
    expect(
      screen.getByText('Seus dados de contato serão usados somente pela Ouvidoria.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Não informado')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Eliminar contato/ }));
    const dialog = screen.getByRole('dialog', { name: 'Eliminar os dados de contato?' });
    await user.selectOptions(within(dialog).getByLabelText('Motivo'), 'holder_request');
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar contato' }));
    await waitFor(() => {
      expect(view.api.calls.find((call) => call.method === 'DELETE')?.body).toEqual({
        reason: 'holder_request',
      });
    });
    await waitFor(() => {
      expect(screen.queryByText('Contato Fictício 001')).not.toBeInTheDocument();
    });
  });
});

describe('Permissões na interface', () => {
  it('VI não vê o menu Ouvidoria e recebe "Acesso não permitido" na rota direta', async () => {
    setup('/ouvidoria/manifestacoes', {}, VIEWER);
    expect(
      await screen.findByRole('heading', { name: 'Acesso não permitido' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ouvidoria' })).not.toBeInTheDocument();
  });
});
