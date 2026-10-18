/** TL16 — Gestão de usuários (RF03, RF06–RF09) na interface. */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { apiError, FakeAuthClient, json, meOf, mockApi, renderApp } from '../../test/admin-helpers';
import type { AdminUser } from './users-api';

const SA = meOf();
const SECTORS = [
  {
    id: 'setor-pa',
    code: 'PA',
    name: 'Pronto Atendimento',
    description: null,
    isActive: true,
    deactivatedAt: null,
    activeTeams: 3,
    activeSurveys: 1,
  },
  {
    id: 'setor-uti',
    code: 'UTI',
    name: 'UTI Adulto',
    description: null,
    isActive: true,
    deactivatedAt: null,
    activeTeams: 2,
    activeSurveys: 1,
  },
  {
    id: 'setor-old',
    code: 'OLD',
    name: 'Setor Antigo',
    description: null,
    isActive: false,
    deactivatedAt: '2026-01-01T00:00:00Z',
    activeTeams: 0,
    activeSurveys: 0,
  },
];

function userOf(overrides: Partial<AdminUser>): AdminUser {
  return {
    id: 'u-ge',
    fullName: 'Gestora Fictícia',
    email: 'gestora@example.com',
    role: 'management',
    allSectors: true,
    sectors: [],
    isActive: true,
    mustChangePassword: false,
    deactivatedAt: null,
    createdAt: '2026-10-01T12:00:00Z',
    updatedAt: '2026-10-01T12:00:00Z',
    ...overrides,
  };
}

const SELF = userOf({ id: SA.id, fullName: SA.fullName, email: SA.email, role: 'superadmin' });
const GE = userOf({});
const DISABLED = userOf({
  id: 'u-off',
  fullName: 'Pessoa Desativada',
  email: 'off@example.com',
  role: 'viewer',
  isActive: false,
  deactivatedAt: '2026-10-15T13:30:00Z',
});

function setup(extra: Parameters<typeof mockApi>[0] = {}) {
  const client = new FakeAuthClient();
  client.token = 'token-sa';
  const api = mockApi({
    'GET /me': () => json({ data: SA }),
    'GET /admin/users': () =>
      json({ data: [SELF, GE, DISABLED], meta: { page: 1, pageSize: 20, total: 3 } }),
    'GET /admin/sectors': () => json({ data: SECTORS }),
    ...extra,
  });
  renderApp('/admin/usuarios', client);
  return api;
}

const row = async (name: string) => (await screen.findByText(name)).closest('tr') as HTMLElement;

describe('TL16 — lista e filtros', () => {
  it('mostra perfil, escopo e situação com datas em dd/mm/aaaa', async () => {
    setup();
    const off = await row('Pessoa Desativada');
    expect(within(off).getByText('Desativado')).toBeInTheDocument();
    expect(within(off).getByText('desde 15/10/2026 10:30')).toBeInTheDocument();
    expect(within(await row('Gestora Fictícia')).getByText('Todos os setores')).toBeInTheDocument();
  });

  it('a própria linha não oferece desativar nem redefinir senha (RN24)', async () => {
    setup();
    const self = await row(`${SA.fullName} (você)`);
    expect(within(self).getByRole('button', { name: `Editar ${SA.fullName}` })).toBeInTheDocument();
    expect(
      within(self).queryByRole('button', { name: /Desativar|Redefinir/ }),
    ).not.toBeInTheDocument();
  });

  it('envia os filtros ao E06', async () => {
    const { calls } = setup();
    const user = userEvent.setup();
    await row('Gestora Fictícia');
    await user.type(screen.getByLabelText('Buscar por nome ou e-mail'), ' gestora ');
    await user.selectOptions(screen.getByLabelText('Perfil'), 'management');
    await user.selectOptions(screen.getByLabelText('Situação'), 'true');
    await user.selectOptions(screen.getByLabelText('Setor'), 'setor-uti');
    await user.click(screen.getByRole('button', { name: 'Filtrar' }));

    await waitFor(() => {
      const last = calls.filter((call) => call.path === '/admin/users').at(-1);
      expect(Object.fromEntries(last?.query ?? [])).toEqual({
        search: 'gestora',
        role: 'management',
        isActive: 'true',
        sectorId: 'setor-uti',
        page: '1',
        pageSize: '20',
      });
    });
  });

  it('erro ao carregar mostra o código da requisição e permite tentar de novo', async () => {
    let attempts = 0;
    setup({
      'GET /admin/users': () => {
        attempts += 1;
        return attempts === 1
          ? apiError(503, 'SERVICE_UNAVAILABLE', 'O serviço está temporariamente indisponível.')
          : json({ data: [GE], meta: { page: 1, pageSize: 20, total: 1 } });
      },
    });
    const user = userEvent.setup();
    expect(
      await screen.findByText('Código da requisição: 9f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Gestora Fictícia')).toBeInTheDocument();
  });
});

describe('TL16 — cadastro com senha temporária exibida uma vez', () => {
  it('cadastra AS com setores ativos e mostra a senha temporária até Concluir', async () => {
    const { calls } = setup({
      'POST /admin/users': (call) =>
        json(
          {
            data: {
              user: userOf({ id: 'novo', fullName: 'Novo Admin', role: 'sector_admin' }),
              temporaryPassword: 'Tmp4Senha8Segura', // gitleaks:allow — senha fictícia de teste
            },
            ...{ body: call.body },
          },
          201,
        ),
    });
    const user = userEvent.setup();
    await row('Gestora Fictícia');
    await user.click(screen.getByRole('button', { name: 'Novo usuário' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo usuário' });

    await user.type(within(dialog).getByLabelText('Nome completo'), 'Novo Admin');
    await user.type(within(dialog).getByLabelText('E-mail'), 'novo.admin@example.com');
    await user.selectOptions(within(dialog).getByLabelText('Perfil'), 'sector_admin');
    // Setor desativado não é oferecido para novas associações.
    expect(within(dialog).queryByLabelText('Setor Antigo (desativado)')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cadastrar usuário' }));
    expect(await within(dialog).findByText('Escolha ao menos um setor.')).toBeInTheDocument();

    await user.click(within(dialog).getByLabelText('UTI Adulto'));
    await user.click(within(dialog).getByRole('button', { name: 'Cadastrar usuário' }));

    const passwordDialog = await screen.findByRole('dialog', { name: 'Senha temporária' });
    expect(within(passwordDialog).getByText('Tmp4Senha8Segura')).toBeInTheDocument();
    expect(within(passwordDialog).getByText(/não será exibida novamente/)).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      fullName: 'Novo Admin',
      email: 'novo.admin@example.com',
      role: 'sector_admin',
      allSectors: false,
      sectorIds: ['setor-uti'],
    });

    await user.click(within(passwordDialog).getByRole('button', { name: 'Concluir' }));
    expect(screen.queryByText('Tmp4Senha8Segura')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Usuário Novo Admin cadastrado.');
  });

  it('e-mail duplicado (409) aparece no campo de e-mail', async () => {
    setup({ 'POST /admin/users': () => apiError(409, 'CONFLICT', 'Já existe.') });
    const user = userEvent.setup();
    await row('Gestora Fictícia');
    await user.click(screen.getByRole('button', { name: 'Novo usuário' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo usuário' });
    await user.type(within(dialog).getByLabelText('Nome completo'), 'Pessoa Repetida');
    await user.type(within(dialog).getByLabelText('E-mail'), GE.email);
    await user.selectOptions(within(dialog).getByLabelText('Perfil'), 'viewer');
    await user.click(within(dialog).getByRole('button', { name: 'Cadastrar usuário' }));

    expect(
      await within(dialog).findByText('Já existe um usuário com este e-mail.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('E-mail')).toHaveAttribute('aria-invalid', 'true');
  });

  it('Esc fecha o diálogo e devolve o foco ao botão', async () => {
    setup();
    const user = userEvent.setup();
    await row('Gestora Fictícia');
    const open = screen.getByRole('button', { name: 'Novo usuário' });
    await user.click(open);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(open).toHaveFocus();
  });
});

describe('TL16 — edição, desativação e redefinição', () => {
  it('editar a si mesmo envia somente o nome', async () => {
    const { calls } = setup({
      [`PATCH /admin/users/${SA.id}`]: () => json({ data: { ...SELF, fullName: 'Nome Novo' } }),
    });
    const user = userEvent.setup();
    const self = await row(`${SA.fullName} (você)`);
    await user.click(within(self).getByRole('button', { name: `Editar ${SA.fullName}` }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar usuário' });
    expect(within(dialog).getByLabelText('Perfil')).toBeDisabled();
    const name = within(dialog).getByLabelText('Nome completo');
    await user.clear(name);
    await user.type(name, 'Nome Novo');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar alterações' }));

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
        fullName: 'Nome Novo',
      });
    });
  });

  it('desativação exige confirmação e envia isActive: false', async () => {
    const { calls } = setup({
      'PATCH /admin/users/u-ge': () => json({ data: { ...GE, isActive: false } }),
    });
    const user = userEvent.setup();
    await user.click(
      within(await row('Gestora Fictícia')).getByRole('button', {
        name: 'Desativar Gestora Fictícia',
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Desativar usuário' });
    expect(within(dialog).getByText(/perderá o acesso imediatamente/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Desativar' }));

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ isActive: false });
    });
    expect(await screen.findByText('Usuário Gestora Fictícia desativado.')).toBeInTheDocument();
  });

  it('erro 422 da desativação aparece no diálogo', async () => {
    setup({
      'PATCH /admin/users/u-ge': () =>
        apiError(
          422,
          'LAST_SUPERADMIN',
          'O sistema precisa de ao menos um superadministrador ativo.',
        ),
    });
    const user = userEvent.setup();
    await user.click(
      within(await row('Gestora Fictícia')).getByRole('button', {
        name: 'Desativar Gestora Fictícia',
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Desativar usuário' });
    await user.click(within(dialog).getByRole('button', { name: 'Desativar' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'ao menos um superadministrador ativo',
    );
  });

  it('redefinição gera a senha temporária e a exibe uma vez; inativo não pode ser redefinido', async () => {
    const { calls } = setup({
      'POST /admin/users/u-ge/reset-password': () =>
        json({ data: { temporaryPassword: 'Nova7Senha3Tempo' } }), // gitleaks:allow — senha fictícia de teste
    });
    const user = userEvent.setup();
    expect(
      within(await row('Pessoa Desativada')).getByRole('button', {
        name: 'Redefinir senha de Pessoa Desativada',
      }),
    ).toBeDisabled();

    await user.click(
      within(await row('Gestora Fictícia')).getByRole('button', {
        name: 'Redefinir senha de Gestora Fictícia',
      }),
    );
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Redefinir senha' })).getByRole('button', {
        name: 'Gerar senha temporária',
      }),
    );

    expect(await screen.findByText('Nova7Senha3Tempo')).toBeInTheDocument();
    expect(calls.filter((call) => call.path === '/admin/users/u-ge/reset-password')).toHaveLength(
      1,
    );
    await user.click(screen.getByRole('button', { name: 'Concluir' }));
    expect(screen.queryByText('Nova7Senha3Tempo')).not.toBeInTheDocument();
  });
});
