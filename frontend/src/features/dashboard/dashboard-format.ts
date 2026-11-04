import type { NpsIndicator } from './dashboard-api';

/** Número em pt-BR com vírgula decimal (RNF29); nulo → travessão. */
export function formatNumber(value: number | null, digits = 1): string {
  if (value === null) return '—';
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : digits,
    maximumFractionDigits: digits,
  });
}

/** RN21: texto do estado suprimido (Tabela 22). */
export const SUPPRESSED_TEXT = 'menos de 5 respostas';

/** n considerado, sempre junto do indicador (RF53). */
export function nText(indicator: Pick<NpsIndicator, 'n' | 'suppressed'>): string {
  if (indicator.suppressed) return SUPPRESSED_TEXT;
  return `n = ${formatNumber(indicator.n, 0)}`;
}

/** NPS exibido com uma casa e sinal; sem dados → "Sem dados" (RF60: nunca 0 sem dados). */
export function npsText(indicator: NpsIndicator): string {
  if (indicator.suppressed) return 'Oculto';
  if (indicator.nps === null) return 'Sem dados';
  return formatNumber(indicator.nps);
}
