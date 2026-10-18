import { Copy, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';

interface TemporaryPasswordDialogProps {
  /** Senha recebida do E07 ou E09; null fecha o diálogo e a descarta da memória. */
  password: string | null;
  userName: string;
  onClose: () => void;
}

/**
 * Exibe a senha temporária UMA única vez (RF03, RF06), com opção de copiar. Ao fechar, a senha é
 * descartada pelo componente pai e não pode ser exibida de novo.
 */
export function TemporaryPasswordDialog({
  password,
  userName,
  onClose,
}: TemporaryPasswordDialogProps) {
  const [copied, setCopied] = useState<'ok' | 'erro' | null>(null);

  const close = () => {
    setCopied(null);
    onClose();
  };

  const copy = async () => {
    if (password === null) return;
    try {
      await navigator.clipboard.writeText(password);
      setCopied('ok');
    } catch {
      setCopied('erro');
    }
  };

  return (
    <Dialog
      open={password !== null}
      title="Senha temporária"
      description={`Entregue esta senha a ${userName} por um canal seguro. No primeiro acesso, a troca será obrigatória.`}
      onClose={close}
    >
      <div className="space-y-4">
        <p className="flex gap-2 rounded-lg border-l-4 border-amber-600 bg-amber-50 p-3 text-amber-950">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          Anote ou copie agora: esta senha não será exibida novamente.
        </p>
        <output
          aria-label="Senha temporária"
          className="block rounded-lg bg-slate-100 px-4 py-3 text-center font-mono text-2xl tracking-wider break-all select-all"
        >
          {password}
        </output>
        <p role="status" className="min-h-6 text-sm text-slate-700">
          {copied === 'ok'
            ? 'Senha copiada.'
            : copied === 'erro'
              ? 'Não foi possível copiar; anote a senha.'
              : ''}
        </p>
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={() => void copy()}>
            <Copy aria-hidden="true" className="size-4" />
            Copiar senha
          </Button>
          <Button onClick={close}>Concluir</Button>
        </div>
      </div>
    </Dialog>
  );
}
