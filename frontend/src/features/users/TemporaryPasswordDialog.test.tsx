/** Senha temporária exibida uma única vez (RF03): cópia e orientação quando a cópia falha. */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TemporaryPasswordDialog } from './TemporaryPasswordDialog';

const FICTITIOUS_PASSWORD = 'Abcd2345Efgh6789'; // gitleaks:allow — senha fictícia de teste

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
