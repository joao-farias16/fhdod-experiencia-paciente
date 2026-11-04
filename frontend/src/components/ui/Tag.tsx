import type { ReactNode } from 'react';

export type TagTone = 'success' | 'info' | 'neutral';

const TONES: Record<TagTone, string> = {
  success: 'border-green-700 text-green-800',
  info: 'border-brand-700 text-brand-800',
  neutral: 'border-slate-500 text-slate-700',
};

/** Etiqueta de situação (ativo, rascunho, desativado…), sempre com texto (RNF08: nunca só cor). */
export function Tag({ tone, children }: { tone: TagTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-sm font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
