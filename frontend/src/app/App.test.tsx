import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { createQueryClient } from './query-client';
import { routes } from './routes';

function renderAt(path: string) {
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  return render(
    <App
      router={createMemoryRouter(routes, { initialEntries: [path] })}
      queryClient={queryClient}
    />,
  );
}

function healthResponse() {
  return new Response(
    JSON.stringify({
      data: {
        status: 'ok',
        service: 'fhdod-api',
        timestamp: '2026-10-10T17:25:03.120Z',
        uptimeSeconds: 12,
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('página inicial', () => {
  it('identifica o sistema FHDOD e o aviso de dados fictícios', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(healthResponse()));

    renderAt('/');

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Sistema de Gestão da Experiência do Paciente',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pular para o conteúdo' })).toHaveAttribute(
      'href',
      '#conteudo',
    );
    expect(screen.getByText(/somente dados fictícios/i)).toBeInTheDocument();
    expect(await screen.findByText('API disponível')).toBeInTheDocument();
  });

  it('mostra o estado de conexão e o horário da verificação no fuso local', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(healthResponse()));

    renderAt('/');

    expect(screen.getByText('Conectando ao servidor…')).toBeInTheDocument();
    expect(await screen.findByText(/verificado em 10\/10\/2026 14:25/)).toBeInTheDocument();
  });

  it('informa API indisponível e permite tentar novamente', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(healthResponse());
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderAt('/');

    expect(await screen.findByText('API indisponível')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    expect(await screen.findByText('API disponível')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('rota inexistente', () => {
  it('exibe a página não encontrada com link para o início', () => {
    vi.stubGlobal('fetch', vi.fn());

    renderAt('/rota-que-nao-existe');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Página não encontrada' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar ao início' })).toHaveAttribute('href', '/');
  });
});
