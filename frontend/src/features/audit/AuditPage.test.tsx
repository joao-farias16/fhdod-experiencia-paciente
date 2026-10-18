/** TL17 — Auditoria (RF11) na interface. */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { addDays, localDateOf } from '../../lib/format';
import { FakeAuthClient, json, meOf, mockApi, renderApp } from '../../test/admin-helpers';
import { describeDetails } from './audit-labels';

const SA = meOf();
const LOGS = [
  {
    id: '12',
    occurredAt: '2026-10-18T13:05:00.000Z',
    actor: { id: SA.id, fullName: SA.fullName, role: 'superadmin' },
    action: 'USER_UPDATED',
    entityType: 'profile',
    entityId: 'perfil-1',
    sectorId: null,
    details: {
      changedFields: ['role', 'scope'],
      roleFrom: 'viewer',
      roleTo: 'management',
      allSectors: false,
      sectorIdsAdded: ['setor-pa'],
      sectorIdsRemoved: [],
    },
    requestId: 'c1d6f0c2-4b7e-4f43-9a35-0f1f6a8e2b11',
  },
  {
    id: '11',
    occurredAt: '2026-10-18T02:59:00.000Z',
    actor: { id: 'vi', fullName: 'Visualizador Fictício', role: 'viewer' },
    action: 'AUTHORIZATION_DENIED',
    entityType: 'endpoint',
    entityId: 'E41',
    sectorId: null,
    details: { code: 'FORBIDDEN', method: 'GET', permission: 'audit_logs:read' },
    requestId: null,
  },
];

function setup() {
  const client = new FakeAuthClient();
  client.token = 'token-sa';
  const api = mockApi({
    'GET /me': () => json({ data: SA }),
    'GET /admin/audit-logs': (call) =>
      json({
        data: LOGS,
        meta: {
          page: 1,
          pageSize: Number(call.query.get('pageSize')),
          total: 2,
          from: call.query.get('from'),
          to: call.query.get('to'),
        },
      }),
    'GET /admin/users': () =>
      json({
        data: [{ id: SA.id, fullName: SA.fullName }],
        meta: { page: 1, pageSize: 100, total: 1 },
      }),
    'GET /admin/sectors': () =>
      json({ data: [{ id: 'setor-pa', code: 'PA', name: 'Pronto Atendimento', isActive: true }] }),
  });
  renderApp('/admin/auditoria', client);
  return api;
}

describe('TL17 — consulta da auditoria', () => {
  it('lista eventos em dd/mm/aaaa hh:mm (America/Sao_Paulo), com rótulos e detalhes legíveis', async () => {
    setup();
    // O rótulo também existe no filtro "Ação"; por isso a busca é pela célula da tabela.
    const first = (await screen.findByRole('cell', { name: 'Usuário alterado' })).closest(
      'tr',
    ) as HTMLElement;
    expect(within(first).getByText('18/10/2026 10:05')).toBeInTheDocument();
    expect(within(first).getByText('Perfil: Visualizador → Gestão')).toBeInTheDocument();
    expect(within(first).getByText('Setores incluídos: Pronto Atendimento')).toBeInTheDocument();

    const denied = screen.getByRole('cell', { name: 'Acesso negado' }).closest('tr') as HTMLElement;
    expect(within(denied).getByText('17/10/2026 23:59')).toBeInTheDocument();
    expect(within(denied).getByText('Motivo: sem permissão')).toBeInTheDocument();
  });

  it('usa os últimos 30 dias e 50 itens por padrão; aplica os filtros escolhidos', async () => {
    const { calls } = setup();
    const user = userEvent.setup();
    await screen.findByRole('cell', { name: 'Usuário alterado' });
    const today = localDateOf();
    const firstCall = calls.find((call) => call.path === '/admin/audit-logs');
    expect(Object.fromEntries(firstCall?.query ?? [])).toEqual({
      from: addDays(today, -29),
      to: today,
      pageSize: '50',
      page: '1',
    });

    await user.selectOptions(screen.getByLabelText('Ação'), 'USER_CREATED');
    await user.selectOptions(screen.getByLabelText('Autor'), SA.id);
    await user.selectOptions(screen.getByLabelText('Entidade'), 'profile');
    await user.selectOptions(screen.getByLabelText('Itens por página'), '100');
    await user.click(screen.getByRole('button', { name: 'Filtrar' }));

    await waitFor(() => {
      const last = calls.filter((call) => call.path === '/admin/audit-logs').at(-1);
      expect(Object.fromEntries(last?.query ?? [])).toMatchObject({
        action: 'USER_CREATED',
        actorProfileId: SA.id,
        entityType: 'profile',
        pageSize: '100',
      });
    });
  });

  it('valida o período (data inicial ≤ final, até 366 dias) antes de consultar', async () => {
    const { calls } = setup();
    const user = userEvent.setup();
    await screen.findByRole('cell', { name: 'Usuário alterado' });
    const before = calls.length;
    const from = screen.getByLabelText('De');
    await user.clear(from);
    await user.type(from, '2030-01-01');
    await user.click(screen.getByRole('button', { name: 'Filtrar' }));
    expect(
      await screen.findByText('A data inicial deve ser anterior ou igual à final.'),
    ).toBeInTheDocument();

    await user.clear(from);
    await user.type(from, '2020-01-01');
    await user.click(screen.getByRole('button', { name: 'Filtrar' }));
    expect(await screen.findByText('O período deve ter no máximo 366 dias.')).toBeInTheDocument();
    expect(calls.filter((call) => call.path === '/admin/audit-logs')).toHaveLength(
      calls.slice(0, before).filter((call) => call.path === '/admin/audit-logs').length,
    );
  });
});

describe('describeDetails', () => {
  it('traduz os detalhes técnicos e usa o id quando o setor é desconhecido', () => {
    expect(describeDetails({ mandatory: true }, (id) => id)).toEqual(['Troca obrigatória: sim']);
    expect(describeDetails({ sectorIds: ['x'] }, (id) => id)).toEqual(['Setores: x']);
    expect(describeDetails({ code: 'SECTOR_OUT_OF_SCOPE' }, (id) => id)).toEqual([
      'Motivo: setor fora do escopo',
    ]);
    expect(describeDetails(null, (id) => id)).toEqual([]);
  });
});
