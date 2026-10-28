/**
 * TL05 e TL07 na interface (ET04): cadastro de setor pelo SA, equipes pelo AS (sem cadastro de
 * setor) e importação de escala com erros por linha e confirmação.
 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  ALL_PERMISSIONS_SA,
  FakeAuthClient,
  json,
  meOf,
  mockApi,
  renderApp,
} from '../../test/admin-helpers';

const STRUCTURE_PERMISSIONS = [
  'teams:create',
  'teams:update',
  'journey_stages:read',
  'shifts:read',
  'shifts:create',
  'shifts:cancel',
  'rosters:import',
  'surveys:read',
  'surveys:create',
  'surveys:update',
  'surveys:publish',
];
const SA = meOf({
  permissions: [
    ...ALL_PERMISSIONS_SA,
    'sectors:create',
    'sectors:update',
    ...STRUCTURE_PERMISSIONS,
  ],
});
const AS = meOf({
  id: '33333333-3333-4333-8333-333333333333',
  role: 'sector_admin',
  allSectors: false,
  sectors: [{ id: 'setor-pa', code: 'PA', name: 'Pronto Atendimento', isActive: true }],
  permissions: [
    'profile:read',
    'profile:change_password',
    'sectors:read',
    'teams:read',
    'dashboard:read',
    ...STRUCTURE_PERMISSIONS,
  ],
});

const SECTOR = {
  id: 'setor-pa',
  code: 'PA',
  name: 'Pronto Atendimento',
  description: null,
  isActive: true,
  deactivatedAt: null,
  activeTeams: 1,
  activeSurveys: 1,
};
const TEAM = {
  id: 'equipe-a',
  sectorId: 'setor-pa',
  sectorCode: 'PA',
  sectorName: 'Pronto Atendimento',
  code: 'EQUIPE-A',
  name: 'Equipe A',
  isActive: true,
  deactivatedAt: null,
};

function client(token: string) {
  const fake = new FakeAuthClient();
  fake.token = token;
  return fake;
}

describe('TL05 — setores e equipes', () => {
  it('SA cadastra setor (código em maiúsculas) e o 409 aparece no campo código', async () => {
    const user = userEvent.setup();
    let first = true;
    const api = mockApi({
      'GET /me': () => json({ data: SA }),
      'GET /admin/sectors': () => json({ data: [SECTOR] }),
      'GET /admin/teams': () => json({ data: [TEAM] }),
      'POST /admin/sectors': (call) => {
        if (first) {
          first = false;
          return json(
            {
              error: {
                code: 'CONFLICT',
                message: 'Já existe um setor com este código.',
                details: [{ field: 'code', message: 'Escolha outro código.' }],
                requestId: 'x',
              },
            },
            409,
          );
        }
        return json(
          { data: { ...SECTOR, id: 'novo', ...(call.body as object), activeTeams: 0 } },
          201,
        );
      },
    });
    renderApp('/admin/setores', client('token-sa'));
    expect(await screen.findByRole('heading', { name: 'Setores e equipes' })).toBeInTheDocument();
    expect(await screen.findByText('Equipe A')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Novo setor' }));
    const dialog = screen.getByRole('dialog', { name: 'Novo setor' });
    await user.type(within(dialog).getByLabelText('Código'), 'cc-1');
    await user.type(within(dialog).getByLabelText('Nome'), 'Centro Cirúrgico');
    await user.click(within(dialog).getByRole('button', { name: 'Cadastrar setor' }));
    expect(await within(dialog).findByText('Escolha outro código.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cadastrar setor' }));
    expect(await screen.findByText('Setor Centro Cirúrgico cadastrado.')).toBeInTheDocument();
    const posts = api.calls.filter((call) => call.method === 'POST');
    expect(posts.at(-1)?.body).toEqual({ code: 'CC-1', name: 'Centro Cirúrgico', description: '' });
  });

  it('AS não vê cadastro de setor, mas cadastra equipe no próprio setor', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'GET /me': () => json({ data: AS }),
      'GET /admin/sectors': () => json({ data: [SECTOR] }),
      'GET /admin/teams': () => json({ data: [TEAM] }),
      'POST /admin/teams': (call) =>
        json({ data: { ...TEAM, id: 'nova', ...(call.body as object) } }, 201),
    });
    renderApp('/admin/setores', client('token-as'));
    expect(await screen.findByText('Equipe A')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Novo setor' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Nova equipe' }));
    const dialog = screen.getByRole('dialog', { name: 'Nova equipe' });
    await user.type(within(dialog).getByLabelText('Código'), 'EQUIPE-N');
    await user.type(within(dialog).getByLabelText('Nome'), 'Equipe da noite');
    await user.click(within(dialog).getByRole('button', { name: 'Cadastrar equipe' }));
    expect(await screen.findByText('Equipe Equipe da noite cadastrada.')).toBeInTheDocument();
    expect(api.calls.find((call) => call.method === 'POST')?.body).toEqual({
      sectorId: 'setor-pa',
      code: 'EQUIPE-N',
      name: 'Equipe da noite',
    });
  });
});

describe('TL07 — importação de escalas', () => {
  it('mostra erros por linha de um arquivo recusado e confirma um arquivo válido', async () => {
    const user = userEvent.setup();
    let uploads = 0;
    const base = { fileName: 'escala.csv', expiresAt: '2026-10-27T18:30:00Z', committedAt: null };
    const api = mockApi({
      'GET /me': () => json({ data: AS }),
      'POST /admin/rosters/import': () => {
        uploads += 1;
        return uploads === 1
          ? json(
              {
                data: {
                  ...base,
                  id: 'imp-1',
                  status: 'rejected',
                  totalRows: 2,
                  acceptedRows: 1,
                  rejectedRows: 1,
                  summary: [],
                  errors: [
                    {
                      line: 3,
                      column: 'data',
                      code: 'DATE_INVALID',
                      message: 'Use uma data válida no formato DD/MM/AAAA.',
                    },
                  ],
                },
              },
              201,
            )
          : json(
              {
                data: {
                  ...base,
                  id: 'imp-2',
                  status: 'validated',
                  totalRows: 2,
                  acceptedRows: 2,
                  rejectedRows: 0,
                  errors: [],
                  summary: [
                    {
                      sectorCode: 'PA',
                      sectorName: 'Pronto Atendimento',
                      teamCode: 'EQUIPE-A',
                      teamName: 'Equipe A',
                      shifts: 2,
                    },
                  ],
                },
              },
              201,
            );
      },
      'POST /admin/rosters/imports/imp-2/confirm': () =>
        json({
          data: {
            ...base,
            id: 'imp-2',
            status: 'committed',
            totalRows: 2,
            acceptedRows: 2,
            rejectedRows: 0,
            errors: [],
            summary: [],
            committedAt: '2026-10-27T18:05:00Z',
          },
        }),
    });
    renderApp('/admin/escalas/importar', client('token-as'));
    await screen.findByRole('heading', { name: 'Importação de escalas' });
    const file = new File(
      ['setor_codigo;equipe_codigo;data;turno;hora_inicio;hora_fim\n'],
      'escala.csv',
      { type: 'text/csv' },
    );
    await user.upload(screen.getByLabelText('Arquivo CSV'), file);
    await user.click(screen.getByRole('button', { name: 'Validar arquivo' }));
    expect(await screen.findByText('Arquivo recusado')).toBeInTheDocument();
    const table = screen.getByRole('region', { name: 'Erros por linha' });
    expect(
      within(table).getByText('Use uma data válida no formato DD/MM/AAAA.'),
    ).toBeInTheDocument();
    expect(within(table).getByText('DATE_INVALID')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar importação' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Validar arquivo' }));
    expect(await screen.findByText('Arquivo válido')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirmar importação' }));
    expect(await screen.findByText('Escala importada')).toBeInTheDocument();
    expect(api.calls.filter((call) => call.path === '/admin/rosters/import')).toHaveLength(2);
  });
});
