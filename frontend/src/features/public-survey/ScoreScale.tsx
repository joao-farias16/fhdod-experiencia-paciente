import { Check } from 'lucide-react';
import { type KeyboardEvent, type Ref, useRef } from 'react';

interface ScoreScaleProps {
  /** id do texto da pergunta (aria-labelledby). */
  labelledBy: string;
  describedBy?: string | undefined;
  min: number;
  max: number;
  value: number | null;
  onChange: (value: number) => void;
  /** Rótulo exibido sob cada número (escala 1–5). */
  labelOf?: (value: number) => string | undefined;
  invalid?: boolean;
  /** Classes da grade (0–10 em duas linhas no celular, Tabela 22). */
  gridClassName: string;
  /** Recebe o foco quando a validação falha (RF34: "mensagem e foco"). */
  focusRef?: Ref<HTMLDivElement>;
}

/**
 * Escala de notas como radiogroup (Tabela 22): setas mudam a nota, Tab entra e sai do grupo, alvos
 * de 48 px (RNF05) e marcação com ícone e contorno, nunca só cor (RNF08), sem cores de julgamento.
 */
export function ScoreScale({
  labelledBy,
  describedBy,
  min,
  max,
  value,
  onChange,
  labelOf,
  invalid = false,
  gridClassName,
  focusRef,
}: ScoreScaleProps) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const values = Array.from({ length: max - min + 1 }, (_, index) => min + index);
  const focusable = value ?? min;

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: number) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = Math.min(max, Math.max(min, current + step));
    onChange(next);
    buttons.current[next - min]?.focus();
  };

  return (
    <div
      ref={focusRef}
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      aria-required={min === 0 ? true : undefined}
      tabIndex={-1}
      className={`grid gap-2 rounded-xl ${gridClassName}`}
    >
      {values.map((option) => {
        const checked = option === value;
        const label = labelOf?.(option);
        return (
          <button
            key={option}
            ref={(node) => {
              buttons.current[option - min] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={label === undefined ? String(option) : `${option} — ${label}`}
            tabIndex={option === focusable ? 0 : -1}
            onClick={() => {
              onChange(option);
            }}
            onKeyDown={(event) => {
              onKeyDown(event, option);
            }}
            className={`relative flex min-h-12 min-w-12 flex-col items-center justify-center rounded-lg border-2 px-1 py-1 text-lg font-semibold transition-colors ${
              checked
                ? 'border-brand-700 bg-brand-700 text-white'
                : 'border-neutral-border bg-white text-slate-900 hover:bg-slate-100'
            }`}
          >
            {checked ? (
              <Check aria-hidden="true" className="absolute top-0.5 right-0.5 size-3.5" />
            ) : null}
            <span>{option}</span>
            {label === undefined ? null : (
              <span className="text-xs leading-tight font-normal">{label}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
