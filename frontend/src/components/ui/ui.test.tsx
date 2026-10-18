/** Componentes de interface: diálogo acessível, paginação, estados e senha temporária. */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TemporaryPasswordDialog } from '../../features/users/TemporaryPasswordDialog';
import { ApiError } from '../../lib/api-client';
import { Dialog } from './Dialog';
import { EmptyState, ErrorState, Pagination } from './States';

const FICTITIOUS_PASSWORD = 'Abcd2345Efgh6789'; // gitleaks:allow — senha fictícia de teste

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Abrir
      </button>
      <Dialog
        open={open}
        title="Título"
        onClose={() => {
          setOpen(false);
        }}
      >
        <button type="button">Primeiro</button>
        <button type="button">Último</button>
      </Dialog>
    </>
  );
}

describe('Dialog (RNF07)', () => {
  it('foca o primeiro controle, prende o Tab no diálogo e devolve o foco ao fechar', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));

    const dialog = screen.getByRole('dialog', { name: 'Título' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const close = screen.getByRole('button', { name: 'Fechar' });
    expect(close).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Primeiro' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Último' })).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Último' })).toHaveFocus();

    await user.click(close);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir' })).toHaveFocus();
  });
});

describe('Pagination e estados', () => {
  it('mostra o intervalo e navega entre páginas', async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    render(<Pagination page={2} pageSize={20} total={45} onPageChange={onPageChange} />);

    expect(screen.getByText('Exibindo 21–40 de 45')).toBeInTheDocument();
    expect(screen.getByText('Página 2 de 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Anterior' }));
    await user.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(onPageChange.mock.calls).toEqual([[1], [3]]);
  });

  it('desabilita a navegação nos limites e informa lista vazia', () => {
    render(<Pagination page={1} pageSize={20} total={0} onPageChange={vi.fn()} />);
    expect(screen.getByText('Nenhum registro')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled();
  });

  it('erro mostra a mensagem da API e o código; erro genérico usa texto padrão', () => {
    const { rerender } = render(
      <ErrorState error={new ApiError(503, 'SERVICE_UNAVAILABLE', 'Indisponível.', 'req-1')} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Indisponível.');
    expect(screen.getByText('Código da requisição: req-1')).toBeInTheDocument();
    rerender(<ErrorState error={new Error('interno')} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar os dados.');
    expect(screen.queryByText(/interno/)).not.toBeInTheDocument();
    rerender(<EmptyState title="Nada aqui" />);
    expect(screen.getByText('Nada aqui')).toBeInTheDocument();
  });
});

describe('TemporaryPasswordDialog (RF03)', () => {
  it('copia a senha e informa o resultado', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render(
      <TemporaryPasswordDialog
        password={FICTITIOUS_PASSWORD}
        userName="Pessoa"
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Copiar senha' }));

    expect(writeText).toHaveBeenCalledWith(FICTITIOUS_PASSWORD);
    expect(screen.getByText('Senha copiada.')).toBeInTheDocument();
  });

  it('sem permissão de área de transferência, orienta a anotar', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('negado'));
    const onClose = vi.fn();
    render(
      <TemporaryPasswordDialog
        password={FICTITIOUS_PASSWORD}
        userName="Pessoa"
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Copiar senha' }));
    expect(screen.getByText('Não foi possível copiar; anote a senha.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Concluir' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('não renderiza nada sem senha', () => {
    render(<TemporaryPasswordDialog password={null} userName="" onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
