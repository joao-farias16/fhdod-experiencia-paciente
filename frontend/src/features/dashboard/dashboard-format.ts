import { formatNumber, type NpsIndicator } from './dashboard-api';

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
