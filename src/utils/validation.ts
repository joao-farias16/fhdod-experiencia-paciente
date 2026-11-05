/** Validação da entrada com Zod (RNF11) e filtros comuns da query string (período RN25, listas). */
import { z } from 'zod';

import { addDays, daysInclusive, isValidLocalDate, localDateOf } from './dates.js';
import { type ErrorDetail, HttpError } from './errors.js';

// Mensagens padrão do Zod em português; nenhuma delas repete o valor recebido.
z.config(z.locales.pt());

export const VALIDATION_MESSAGE = 'Os dados enviados são inválidos.';

function detailsOf(error: z.ZodError): ErrorDetail[] {
  return error.issues.flatMap((issue): ErrorDetail[] => {
    const base = issue.path.map(String).join('.');
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({
        field: base === '' ? key : `${base}.${key}`,
        message: 'Campo não permitido.',
      }));
    }
    return [{ field: base === '' ? '(corpo)' : base, message: issue.message }];
  });
}

/**
 * Valida a entrada com um esquema Zod estrito (RNF11). Falha → 400 VALIDATION_ERROR com detalhes
 * por campo, sem ecoar os valores recebidos (senhas, por exemplo).
 */
export function parseInput<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw validationError(detailsOf(result.error));
  return result.data;
}

/** 400 VALIDATION_ERROR com detalhes por campo, para validações feitas fora do esquema Zod. */
export function validationError(details: ErrorDetail[], message = VALIDATION_MESSAGE): HttpError {
  return new HttpError(400, 'VALIDATION_ERROR', message, details);
}

/** 400 VALIDATION_ERROR com um único campo inválido. */
export function invalidField(field: string, message: string): HttpError {
  return validationError([{ field, message }]);
}

/** UUID em parâmetros de rota e filtros. */
// Minúsculas: forma canônica gravada no MySQL (CHAR(36)), como o tipo uuid do PostgreSQL fazia.
export const uuidSchema = z
  .uuid({ error: 'Informe um identificador válido.' })
  .overwrite((value) => value.toLowerCase());

/** Parâmetro de rota `:id` (UUID). */
export const idParamsSchema = z.strictObject({ id: uuidSchema });

/** Paginação comum das listas (`meta: { page, pageSize, total }`). */
export function paginationSchema(maxPageSize: number, defaultPageSize: number) {
  return {
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(maxPageSize).default(defaultPageSize),
  };
}

/** Booleano em query string: somente "true" ou "false". */
export const queryBoolean = z.enum(['true', 'false']).transform((value) => value === 'true');

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
