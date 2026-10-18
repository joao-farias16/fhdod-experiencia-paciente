import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  // Tabela 22: primário #1D4ED8 com texto branco (6,70:1); secundário com borda #6B7280;
  // perigo #B91C1C, sempre com confirmação.
  primary: 'bg-brand-700 text-white hover:bg-brand-800 disabled:bg-brand-700/60',
  secondary:
    'border border-neutral-border bg-white text-slate-900 hover:bg-slate-100 disabled:text-slate-500',
  danger: 'bg-danger-700 text-white hover:bg-red-800 disabled:bg-danger-700/60',
  ghost: 'text-brand-700 hover:bg-brand-50 disabled:text-slate-500',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

/** Botão com alvo mínimo de 44 × 44 px (RNF05) e foco visível global (RNF07). */
export function Button({
  variant = 'primary',
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg px-4 font-medium transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
