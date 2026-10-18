import { z } from 'zod';

import { type ErrorDetail, HttpError } from './http-error.js';

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
  if (!result.success) {
    throw new HttpError(400, 'VALIDATION_ERROR', VALIDATION_MESSAGE, detailsOf(result.error));
  }
  return result.data;
}

/** UUID em parâmetros de rota e filtros. */
export const uuidSchema = z.uuid({ error: 'Informe um identificador válido.' });

/** Paginação comum das listas (`meta: { page, pageSize, total }`). */
export function paginationSchema(maxPageSize: number, defaultPageSize: number) {
  return {
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(maxPageSize).default(defaultPageSize),
  };
}

/** Booleano em query string: somente "true" ou "false". */
export const queryBoolean = z.enum(['true', 'false']).transform((value) => value === 'true');
