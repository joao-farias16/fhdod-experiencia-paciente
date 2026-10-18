import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import type { ReactNode } from 'react';

type Tone = 'error' | 'success' | 'info';

const TONES: Record<Tone, { box: string; Icon: typeof Info }> = {
  error: { box: 'border-danger-700 bg-red-50 text-red-900', Icon: CircleAlert },
  success: { box: 'border-green-700 bg-green-50 text-green-900', Icon: CircleCheck },
  info: { box: 'border-brand-700 bg-brand-50 text-blue-950', Icon: Info },
};

interface AlertProps {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  /** Código da requisição exibido em erros para suporte (Tabela 22). */
  requestId?: string | undefined;
}

/**
 * Aviso com ícone e texto (nunca só cor, RNF08). Erros usam role="alert"; os demais, role="status"
 * (aria-live), para leitores de tela.
 */
export function Alert({ tone = 'info', title, children, requestId }: AlertProps) {
  const { box, Icon } = TONES[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex gap-3 rounded-lg border-l-4 p-4 ${box}`}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <div className="space-y-1">
        {title === undefined ? null : <p className="font-semibold">{title}</p>}
        {children === undefined ? null : <div>{children}</div>}
        {requestId === undefined ? null : (
          <p className="text-xs opacity-80">Código da requisição: {requestId}</p>
        )}
      </div>
    </div>
  );
}
