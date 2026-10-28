/**
 * TL03 e TL14 na interface (ET08 e ET09):
 * T11: o painel consulta o E28 de novo a cada 60 s e pelo botão Atualizar → total + 1 visível, com n.
 * RF56: filtros aplicados vão para a URL; RF60: sem dados → mensagem e Limpar filtros (NPS nunca 0);
 * RN21: VI com grupo suprimido → "menos de 5 respostas". RF62/TL14: exportação com os filtros atuais
 * e tipos conforme o perfil.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type ApiCall,
  FakeAuthClient,
  json,
  meOf,
  mockApi,
  renderApp,
  VIEWER,
} from '../../test/admin-helpers';
import type { Me } from '../auth/auth-types';
import type { NpsIndicator, Summary } from './dashboard-api';

const GE: Me = meOf({
  id: '33333333-3333-4333-8333-333333333333',
  fullName: 'Gestão Fictícia',
  role: 'management',
  permissions: [
    'profile:read',
    'profile:change_password',
    'sectors:read',
    'teams:read',
    'dashboard:read',
    'reports:export_responses',
    'reports:export_indicators',
  ],
});

function indicator(n: number, promoters: number, detractors: number): NpsIndicator {
  const nps = n === 0 ? null : Math.round(((promoters - detractors) / n) * 1000) / 10;
  return {
    n,
    nps,
    promoters,
    passives: n - promoters - detractors,
    detractors,
    promotersPercent: n === 0 ? null : 50,
    passivesPercent: n === 0 ? null : 25,
    detractorsPercent: n === 0 ? null : 25,
    suppressed: false,
  };
}

function summaryOf(indicators: NpsIndicator): Summary {
  return {
    period: { from: '2026-09-29', to: '2026-10-28' },
    indicators,
    distribution: Array.from({ length: 11 }, (_, score) => ({
      score,
      count: score === 10 ? (indicators.n ?? 0) : 0,
      percent: indicators.n === 0 ? null : score === 10 ? 100 : 0,
    })),
    manifestations: { total: 1, compliment: 0, complaint: 1, suggestion: 0, suppressed: false },
    coverage: {
      total: indicators.n,
      attributed: 0,
      percent: indicators.n === 0 ? null : 0,
      suppressed: false,
    },
    comparison: null,
  };
}

const SUPPRESSED: NpsIndicator = {
  n: null,
  nps: null,
  promoters: null,
  passives: null,
  detractors: null,
  promotersPercent: null,
  passivesPercent: null,
  detractorsPercent: null,
  suppressed: true,
};

function setup(me: Me, summaries: Summary[], path = '/painel') {
  const client = new FakeAuthClient();
  client.token = 'token';
  let index = 0;
  const api = mockApi({
    'GET /me': () => json({ data: me }),
    'GET /admin/sectors': () => json({ data: [] }),
    'GET /admin/teams': () => json({ data: [] }),
    'GET /dashboard/summary': () => {
      const summary = summaries[Math.min(index, summaries.length - 1)];
      index += 1;
      return json({ data: summary });
    },
    'GET /dashboard/sectors': () =>
      json({ data: [], meta: { from: '2026-09-29', to: '2026-10-28' } }),
    'GET /dashboard/trends': () =>
      json({ data: [], meta: { from: '2026-09-29', to: '2026-10-28', granularity: 'day' } }),
    'GET /reports/export': () =>
      new Response('conteúdo xlsx fictício', {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition':
            'attachment; filename="fhdod_respostas_20260929-20261028_gerado-202610281500.xlsx"',
        },
      }),
  });
  return { api, ...renderApp(path, client) };
}

const summaryCalls = (calls: ApiCall[]) =>
  calls.filter((call) => call.path === '/dashboard/summary');

afterEach(() => {
  vi.useRealTimers();
});

describe('T11 — atualização do painel', () => {
  it('a cada 60 s com a aba visível e pelo botão Atualizar: total + 1 com n visível', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const view = setup(GE, [
      summaryOf(indicator(10, 5, 2)),
      summaryOf(indicator(11, 5, 3)),
      summaryOf(indicator(12, 6, 3)),
    ]);
    expect(await screen.findByText('n = 10')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(await screen.findByText('n = 11')).toBeInTheDocument();
    expect(screen.getByText('18,2')).toBeInTheDocument();

    vi.useRealTimers();
    await userEvent.setup().click(screen.getByRole('button', { name: /Atualizar/ }));
    expect(await screen.findByText('n = 12')).toBeInTheDocument();
    expect(summaryCalls(view.api.calls).length).toBeGreaterThanOrEqual(3);
  });
});

describe('RF56 e RF60 — filtros na URL e estado sem dados', () => {
  it('aplicar período personalizado e turno grava na URL e consulta o E28 com os filtros', async () => {
    const user = userEvent.setup();
    const view = setup(GE, [summaryOf(indicator(10, 5, 2))]);
    await screen.findByText('n = 10');
    const form = screen.getByRole('search', { name: 'Filtros do painel' });
    await user.clear(within(form).getByLabelText('De'));
    await user.type(within(form).getByLabelText('De'), '2026-09-01');
    await user.clear(within(form).getByLabelText('Até'));
    await user.type(within(form).getByLabelText('Até'), '2026-09-30');
    await user.selectOptions(within(form).getByLabelText('Turno'), 'night');
    await user.click(within(form).getByRole('checkbox', { name: /Comparar/ }));
    await user.click(within(form).getByRole('button', { name: 'Aplicar filtros' }));

    await waitFor(() => {
      expect(view.router.state.location.search).toBe(
        '?from=2026-09-01&to=2026-09-30&period=night&compare=previous_period',
      );
    });
    await waitFor(() => {
      const last = summaryCalls(view.api.calls).at(-1);
      expect(Object.fromEntries(last?.query ?? [])).toEqual({
        from: '2026-09-01',
        to: '2026-09-30',
        period: 'night',
        compare: 'previous_period',
      });
    });
  });

  it('período inválido (mais de 366 dias) → mensagem e nenhuma consulta nova', async () => {
    const user = userEvent.setup();
    const view = setup(GE, [summaryOf(indicator(10, 5, 2))]);
    await screen.findByText('n = 10');
    const before = summaryCalls(view.api.calls).length;
    const form = screen.getByRole('search', { name: 'Filtros do painel' });
    await user.clear(within(form).getByLabelText('De'));
    await user.type(within(form).getByLabelText('De'), '2025-01-01');
    await user.click(within(form).getByRole('button', { name: 'Aplicar filtros' }));
    expect(within(form).getByText('O período deve ter no máximo 366 dias.')).toBeInTheDocument();
    expect(summaryCalls(view.api.calls)).toHaveLength(before);
  });

  it('sem dados → mensagem e Limpar filtros; NPS nunca exibido como 0', async () => {
    const user = userEvent.setup();
    const view = setup(
      GE,
      [summaryOf(indicator(0, 0, 0))],
      '/painel?from=2020-01-01&to=2020-01-31',
    );
    expect(
      await screen.findByText('Nenhuma resposta para os filtros escolhidos.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('NPS')).not.toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'Limpar filtros' });
    await user.click(buttons.at(-1) as HTMLElement);
    await waitFor(() => {
      expect(view.router.state.location.search).toBe('');
    });
  });

  it('RN21: VI com grupo suprimido vê "menos de 5 respostas" e não vê botões de exportação', async () => {
    setup(VIEWER, [
      {
        ...summaryOf(SUPPRESSED),
        distribution: null,
        coverage: { total: null, attributed: null, percent: null, suppressed: true },
      },
    ]);
    expect((await screen.findAllByText('menos de 5 respostas')).length).toBeGreaterThan(0);
    expect(screen.getByText('Distribuição oculta: menos de 5 respostas.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Exportar/ })).not.toBeInTheDocument();
  });
});

describe('RF62 — exportação com os filtros do painel', () => {
  it('GE exporta respostas com os filtros da URL e vê o nome do arquivo gerado', async () => {
    const user = userEvent.setup();
    URL.createObjectURL = vi.fn(() => 'blob:fhdod');
    URL.revokeObjectURL = vi.fn();
    const view = setup(
      GE,
      [summaryOf(indicator(10, 5, 2))],
      '/painel?from=2026-09-01&to=2026-09-30&origin=qr_code',
    );
    await screen.findByText('n = 10');
    await user.click(screen.getByRole('button', { name: 'Exportar respostas (Excel)' }));
    expect(
      await screen.findByText(
        'Arquivo gerado: fhdod_respostas_20260929-20261028_gerado-202610281500.xlsx',
      ),
    ).toBeInTheDocument();
    const call = view.api.calls.find((item) => item.path === '/reports/export');
    expect(Object.fromEntries(call?.query ?? [])).toEqual({
      type: 'responses',
      from: '2026-09-01',
      to: '2026-09-30',
      origin: 'qr_code',
    });
    expect(call?.authorization).toBe('Bearer token');
  });

  it('TL14: a Ouvidoria só vê o relatório de manifestações, com Incluir textos', async () => {
    const OU = meOf({
      role: 'ombudsman',
      fullName: 'Ouvidoria Fictícia',
      permissions: [
        'profile:read',
        'sectors:read',
        'teams:read',
        'dashboard:read',
        'reports:export_manifestations',
        'manifestations:read',
      ],
    });
    setup(OU, [summaryOf(indicator(1, 1, 0))], '/relatorios');
    const select = await screen.findByLabelText('Relatório');
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Manifestações']);
    expect(screen.getByRole('checkbox', { name: /Incluir textos/ })).toBeInTheDocument();
  });
});
