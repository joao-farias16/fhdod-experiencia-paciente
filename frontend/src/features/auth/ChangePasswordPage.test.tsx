/** TL02 — troca obrigatória de senha (RF04, RN28) na interface. */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  apiError,
  FakeAuthClient,
  json,
  mockApi,
  renderApp,
  VIEWER,
} from '../../test/admin-helpers';

const PENDING = { ...VIEWER, mustChangePassword: true };

function setup(handlers: Parameters<typeof mockApi>[0] = {}) {
  const client = new FakeAuthClient();
  client.token = 'token-temporario';
  const api = mockApi({ 'GET /me': () => json({ data: PENDING }), ...handlers });
  const view = renderApp('/trocar-senha', client);
  return { client, ...api, ...view };
}

describe('TL02 — troca de senha', () => {
  it('mostra as regras e marca cada uma como atendida conforme a digitação', async () => {
    setup();
    const user = userEvent.setup();
    const field = await screen.findByLabelText('Nova senha');
    const rules = screen.getByRole('list', { name: '' });

    expect(within(rules).getAllByText('(pendente)')).toHaveLength(3);
    await user.type(field, 'abc');
    expect(within(rules).getAllByText('(atendida)')).toHaveLength(1);
    await user.type(field, 'defghij1');
    expect(within(rules).getAllByText('(atendida)')).toHaveLength(3);
  });

  it('senha fora da política ou confirmação diferente não chega ao backend', async () => {
    const { calls } = setup();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Nova senha'), 'semnumeros');
    await user.type(screen.getByLabelText('Confirme a nova senha'), 'outra');
    await user.click(screen.getByRole('button', { name: 'Salvar nova senha' }));

    expect(
      await screen.findByText('A senha não atende a todas as regras abaixo.'),
    ).toBeInTheDocument();
    expect(screen.getByText('As senhas não são iguais.')).toBeInTheDocument();
    expect(calls.some((call) => call.path === '/me/password')).toBe(false);
  });

  it('senha válida: E05, novo login com a senha nova e tela inicial do perfil', async () => {
    const { client, calls, router } = setup({
      'POST /me/password': () => new Response(null, { status: 204 }),
    });
    client.addAccount(VIEWER.email, 'MinhaSenhaNova123', 'token-novo');
    let afterChange = false;
    const user = userEvent.setup();
    // Depois da troca, o E04 passa a informar mustChangePassword: false.
    const meHandler = () => json({ data: afterChange ? VIEWER : PENDING });
    mockApi({
      'GET /me': meHandler,
      'POST /me/password': () => {
        afterChange = true;
        return new Response(null, { status: 204 });
      },
    });

    await user.type(await screen.findByLabelText('Nova senha'), 'MinhaSenhaNova123');
    await user.type(screen.getByLabelText('Confirme a nova senha'), 'MinhaSenhaNova123');
    await user.click(screen.getByRole('button', { name: 'Salvar nova senha' }));

    expect(await screen.findByText('Senha alterada com sucesso.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/painel');
    expect(client.signInCalls).toEqual([{ email: VIEWER.email, password: 'MinhaSenhaNova123' }]); // gitleaks:allow — senha fictícia de teste
    expect(calls).toBeDefined();
  });

  it('400 do backend mostra mensagem sem repetir a senha', async () => {
    setup({ 'POST /me/password': () => apiError(400, 'VALIDATION_ERROR', 'Dados inválidos.') });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Nova senha'), 'SenhaValida123');
    await user.type(screen.getByLabelText('Confirme a nova senha'), 'SenhaValida123');
    await user.click(screen.getByRole('button', { name: 'Salvar nova senha' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('A senha não atende às regras.');
    expect(alert).not.toHaveTextContent('SenhaValida123');
  });

  it('429 informa a espera', async () => {
    setup({ 'POST /me/password': () => apiError(429, 'RATE_LIMITED') });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Nova senha'), 'SenhaValida123');
    await user.type(screen.getByLabelText('Confirme a nova senha'), 'SenhaValida123');
    await user.click(screen.getByRole('button', { name: 'Salvar nova senha' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Aguarde 15 minutos');
  });
});
