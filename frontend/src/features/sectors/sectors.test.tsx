/** TL05 na interface: cadastro de setor pelo SA e equipes pelo AS (sem cadastro de setor). */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  ALL_PERMISSIONS_SA,
  json,
  meOf,
  mockApi,
  renderApp,
  SECTOR_ADMIN as AS,
  signedInClient as client,
  STRUCTURE_PERMISSIONS,
} from '../../test/helpers';

const SA = meOf({
  permissions: [
    ...ALL_PERMISSIONS_SA,
    'sectors:create',
    'sectors:update',
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
