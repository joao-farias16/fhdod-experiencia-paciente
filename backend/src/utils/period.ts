import { z } from 'zod';

import { addDays, daysInclusive, isValidLocalDate, localDateOf } from './dates.js';

/**
 * Filtros de período e listas da query string, comuns à Ouvidoria (E35), ao dashboard (E28–E33) e
 * aos relatórios (E34). RN25: datas locais no fuso do hospital, from e to inclusivos, até 366 dias,
 * padrão últimos 30 dias.
 */
export const MAX_RANGE_DAYS = 366;
export const DEFAULT_RANGE_DAYS = 30;

export const localDateSchema = z
  .string()
  .refine(isValidLocalDate, 'Use uma data válida no formato AAAA-MM-DD.');

/** Lista separada por vírgulas (ex.: status=received,in_review). */
export function csvList<T extends z.ZodType<unknown, string>>(item: T, max = 50) {
  return z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part !== ''),
    )
    .pipe(z.array(item).min(1, 'Informe ao menos um valor.').max(max));
}

/** from ≤ to e no máximo 366 dias (RN25) → 400 com detalhe no campo. */
export function refinePeriod(
  query: { from?: string | undefined; to?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (query.from === undefined || query.to === undefined) return;
  if (query.from > query.to) {
    ctx.addIssue({
      code: 'custom',
      path: ['from'],
      message: 'A data inicial deve ser anterior ou igual à final.',
    });
  } else if (daysInclusive(query.from, query.to) > MAX_RANGE_DAYS) {
    ctx.addIssue({
      code: 'custom',
      path: ['to'],
      message: `O período deve ter no máximo ${MAX_RANGE_DAYS} dias.`,
    });
  }
}

export interface LocalPeriod {
  from: string;
  to: string;
}

/** Período efetivo (datas locais inclusivas), completando o que não foi informado. */
export function resolvePeriod(
  query: { from?: string | undefined; to?: string | undefined },
  now: Date,
): LocalPeriod {
  const span = DEFAULT_RANGE_DAYS - 1;
  if (query.from !== undefined && query.to !== undefined) return { from: query.from, to: query.to };
  if (query.from !== undefined) {
    const to = addDays(query.from, span);
    const today = localDateOf(now);
    return { from: query.from, to: to > today ? today : to };
  }
  const to = query.to ?? localDateOf(now);
  return { from: addDays(to, -span), to };
}
