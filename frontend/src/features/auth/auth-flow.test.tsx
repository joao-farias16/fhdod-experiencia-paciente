/**
 * T12 na interface (RF01, RF02, RF05): login inválido permanece em /login com mensagem genérica;
 * login válido leva à tela inicial do perfil; rotas protegidas exigem sessão; logout limpa os dados
 * e Voltar não exibe dados administrativos; o menu vem das permissões do E04.
 */
import { act, screen, waitFor } from '@testing-library/react';
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
import { GENERIC_LOGIN_ERROR } from './AuthProvider';

const SA = meOf();
const USERS_PAGE = { data: [], meta: { page: 1, pageSize: 20, total: 0 } };

async function login(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('E-mail'), email);
  await user.type(screen.getByLabelText('Senha'), password);
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
  return user;
}

describe('TL01 — login administrativo', () => {
  it('credenciais inválidas: permanece em /login com mensagem genérica', async () => {
    const client = new FakeAuthClient().addAccount(SA.email, 'SenhaCorreta123', 'token-sa');
    const { calls } = mockApi({});
    const { router } = renderApp('/login', client);

    await login(SA.email, 'SenhaErrada123');

    expect(await screen.findByRole('alert')).toHaveTextContent(GENERIC_LOGIN_ERROR);
    expect(router.state.location.pathname).toBe('/login');
    expect(calls).toHaveLength(0);
  });

  it('e-mail inexistente recebe exatamente a mesma mensagem', async () => {
    mockApi({});
    renderApp('/login', new FakeAuthClient());

    await login('ninguem@example.com', 'QualquerSenha123');

    expect(await screen.findByRole('alert')).toHaveTextContent(GENERIC_LOGIN_ERROR);
  });

  it.each([
    ['sem perfil (401)', apiError(401, 'UNAUTHENTICATED')],
    ['desativada (403)', apiError(403, 'ACCOUNT_DISABLED')],
  ])('conta %s: mensagem genérica e sessão encerrada', async (_case, response) => {
    const client = new FakeAuthClient().addAccount(SA.email, 'SenhaCorreta123', 'token-sa');
    mockApi({ 'GET /me': () => response });
    const { router } = renderApp('/login', client);

    await login(SA.email, 'SenhaCorreta123');

    expect(await screen.findByRole('alert')).toHaveTextContent(GENERIC_LOGIN_ERROR);
    expect(client.signOutCalls).toBe(1);
    expect(client.token).toBeNull();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('valida campos obrigatórios sem chamar o Supabase', async () => {
    const client = new FakeAuthClient();
    mockApi({});
    renderApp('/login', client);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Entrar' }));

    expect(screen.getByText('Informe o e-mail.')).toBeInTheDocument();
    expect(screen.getByText('Informe a senha.')).toBeInTheDocument();
    expect(client.signInCalls).toHaveLength(0);
  });

  it('SA vai para a gestão de usuários; o token vai no cabeçalho Authorization', async () => {
    const client = new FakeAuthClient().addAccount(SA.email, 'SenhaCorreta123', 'token-sa');
    const { calls } = mockApi({
      'GET /me': () => json({ data: SA }),
      'GET /admin/users': () => json(USERS_PAGE),
      'GET /admin/sectors': () => json({ data: [] }),
    });
    const { router } = renderApp('/login', client);

    await login(SA.email, 'SenhaCorreta123');

    expect(await screen.findByRole('heading', { name: 'Gestão de usuários' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin/usuarios');
    expect(calls.find((call) => call.path === '/me')?.authorization).toBe('Bearer token-sa');
  });

  it('perfil sem administração de usuários vai para /painel', async () => {
    const client = new FakeAuthClient().addAccount(VIEWER.email, 'SenhaCorreta123', 'token-vi');
    mockApi({ 'GET /me': () => json({ data: VIEWER }) });
    const { router } = renderApp('/login', client);

    await login(VIEWER.email, 'SenhaCorreta123');

    expect(
      await screen.findByRole('heading', { name: `Olá, ${VIEWER.fullName}` }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/painel');
    expect(screen.getByText('Pronto Atendimento')).toBeInTheDocument();
  });

  it('troca de senha pendente leva à TL02', async () => {
    const client = new FakeAuthClient().addAccount(VIEWER.email, 'Temporaria12345', 'token-vi');
    mockApi({ 'GET /me': () => json({ data: { ...VIEWER, mustChangePassword: true } }) });
    const { router } = renderApp('/login', client);

    await login(VIEWER.email, 'Temporaria12345');

    expect(
      await screen.findByRole('heading', { name: 'Troca obrigatória de senha' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/trocar-senha');
    // Com troca pendente o menu não é exibido; resta apenas Sair.
    expect(screen.queryByRole('navigation', { name: 'Menu administrativo' })).toBeEmptyDOMElement();
  });
});

describe('proteção de rotas e logout (RF02)', () => {
  it('sem sessão, as rotas administrativas redirecionam a /login', async () => {
    const { calls } = mockApi({});
    const { router } = renderApp('/admin/usuarios', new FakeAuthClient());

    expect(
      await screen.findByRole('heading', { name: 'Acesso administrativo' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(calls).toHaveLength(0);
  });

  it('com troca pendente, outra rota administrativa redireciona a /trocar-senha', async () => {
    const client = new FakeAuthClient();
    client.token = 'token-vi';
    mockApi({ 'GET /me': () => json({ data: { ...SA, mustChangePassword: true } }) });
    const { router } = renderApp('/admin/auditoria', client);

    expect(
      await screen.findByRole('heading', { name: 'Troca obrigatória de senha' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/trocar-senha');
  });

  it('Sair encerra a sessão, limpa os dados e Voltar não mostra a tela administrativa', async () => {
    const client = new FakeAuthClient();
    client.token = 'token-sa';
    mockApi({
      'GET /me': () => json({ data: SA }),
      'GET /admin/users': () =>
        json({
          data: [
            {
              id: 'u1',
              fullName: 'Pessoa Listada Fictícia',
              email: 'listada@example.com',
              role: 'viewer',
              allSectors: true,
              sectors: [],
              isActive: true,
              mustChangePassword: false,
              deactivatedAt: null,
              createdAt: '2026-10-01T12:00:00Z',
              updatedAt: '2026-10-01T12:00:00Z',
            },
          ],
          meta: { page: 1, pageSize: 20, total: 1 },
        }),
      'GET /admin/sectors': () => json({ data: [] }),
    });
    const { router, queryClient } = renderApp('/painel', client);
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: `Olá, ${SA.fullName}` });
    await user.click(screen.getByRole('link', { name: 'Usuários' }));
    expect(await screen.findByText('Pessoa Listada Fictícia')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sair' }));

    expect(
      await screen.findByRole('heading', { name: 'Acesso administrativo' }),
    ).toBeInTheDocument();
    expect(client.signOutCalls).toBe(1);
    expect(client.token).toBeNull();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(screen.queryByText('Pessoa Listada Fictícia')).not.toBeInTheDocument();

    await act(() => router.navigate(-1));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login');
    });
    expect(screen.queryByText('Pessoa Listada Fictícia')).not.toBeInTheDocument();
    expect(screen.queryByText(SA.fullName)).not.toBeInTheDocument();
  });

  it('depois de Sair, o próximo usuário vai para a própria tela inicial (sem herdar a anterior)', async () => {
    const client = new FakeAuthClient().addAccount(SA.email, 'SenhaCorreta123', 'token-sa');
    client.token = 'token-vi';
    mockApi({
      'GET /me': (call) => json({ data: call.authorization === 'Bearer token-sa' ? SA : VIEWER }),
      'GET /admin/users': () => json(USERS_PAGE),
      'GET /admin/sectors': () => json({ data: [] }),
    });
    const { router } = renderApp('/painel', client);
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: `Olá, ${VIEWER.fullName}` });
    await user.click(screen.getByRole('button', { name: 'Sair' }));
    await screen.findByRole('heading', { name: 'Acesso administrativo' });

    await login(SA.email, 'SenhaCorreta123');

    expect(await screen.findByRole('heading', { name: 'Gestão de usuários' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin/usuarios');
  });

  it('acesso direto sem sessão volta à tela pedida depois do login', async () => {
    const client = new FakeAuthClient().addAccount(SA.email, 'SenhaCorreta123', 'token-sa');
    mockApi({
      'GET /me': () => json({ data: SA }),
      'GET /admin/audit-logs': () => json({ data: [], meta: { page: 1, pageSize: 50, total: 0 } }),
      'GET /admin/users': () => json(USERS_PAGE),
      'GET /admin/sectors': () => json({ data: [] }),
    });
    const { router } = renderApp('/admin/auditoria', client);

    await login(SA.email, 'SenhaCorreta123');

    expect(await screen.findByRole('heading', { name: 'Auditoria' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin/auditoria');
  });

  it('sessão expirada (evento do Supabase) volta ao login com aviso', async () => {
    const client = new FakeAuthClient();
    client.token = 'token-vi';
    mockApi({ 'GET /me': () => json({ data: VIEWER }) });
    const { router } = renderApp('/painel', client);
    await screen.findByRole('heading', { name: `Olá, ${VIEWER.fullName}` });

    act(() => {
      client.expire();
    });

    expect(
      await screen.findByText('Sua sessão terminou. Entre novamente para continuar.'),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('401 da API em uso encerra a sessão; 403 ACCOUNT_DISABLED também', async () => {
    const client = new FakeAuthClient();
    client.token = 'token-sa';
    let meCalls = 0;
    mockApi({
      'GET /me': () => {
        meCalls += 1;
        return json({ data: SA });
      },
      'GET /admin/users': () => apiError(403, 'ACCOUNT_DISABLED', 'Conta desativada.'),
      'GET /admin/sectors': () => json({ data: [] }),
    });
    const { router } = renderApp('/admin/usuarios', client);

    expect(
      await screen.findByText('Sua conta está desativada. Procure o superadministrador.'),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(client.signOutCalls).toBeGreaterThanOrEqual(1);
    expect(meCalls).toBe(1);
  });
});

describe('menu e permissões (RF05)', () => {
  it('SA vê Usuários e Auditoria; VI não', async () => {
    const sa = new FakeAuthClient();
    sa.token = 't';
    mockApi({ 'GET /me': () => json({ data: SA }) });
    const first = renderApp('/painel', sa);
    await screen.findByRole('heading', { name: `Olá, ${SA.fullName}` });
    expect(screen.getByRole('link', { name: 'Usuários' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Auditoria' })).toBeInTheDocument();
    first.unmount();

    const vi = new FakeAuthClient();
    vi.token = 't';
    mockApi({ 'GET /me': () => json({ data: VIEWER }) });
    renderApp('/painel', vi);
    await screen.findByRole('heading', { name: `Olá, ${VIEWER.fullName}` });
    expect(screen.queryByRole('link', { name: 'Usuários' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Auditoria' })).not.toBeInTheDocument();
  });

  it('acesso direto a tela sem permissão mostra "Acesso não permitido" sem chamar a API', async () => {
    const client = new FakeAuthClient();
    client.token = 't';
    const { calls } = mockApi({ 'GET /me': () => json({ data: VIEWER }) });
    renderApp('/admin/auditoria', client);

    expect(
      await screen.findByRole('heading', { name: 'Acesso não permitido' }),
    ).toBeInTheDocument();
    expect(calls.map((call) => call.path)).toEqual(['/me']);
  });
});
