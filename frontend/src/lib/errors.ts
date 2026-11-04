import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

import { ApiError } from './api-client';

/** Texto padrão quando um salvamento falha sem resposta da API. */
export const SAVE_FAILED = 'Não foi possível salvar. Tente novamente.';

/** Falha exibida ao usuário: mensagem da API (ou texto padrão) e o requestId, quando houver. */
export interface Failure {
  text: string;
  requestId?: string | undefined;
}

/** Mensagem e requestId de um ApiError; outros erros (rede, inesperados) → texto padrão. */
export function failureOf(
  error: unknown,
  fallback = 'Não foi possível concluir a ação. Tente novamente.',
): Failure {
  return error instanceof ApiError
    ? { text: error.message, requestId: error.requestId }
    : { text: fallback };
}

/**
 * Leva os erros da API para os campos do formulário (400 com detalhes e 409 no código); o que não
 * pertencer a um campo vira aviso geral com o requestId.
 */
export function applyApiError<T extends FieldValues>(
  error: unknown,
  fields: readonly Path<T>[],
  setError: UseFormSetError<T>,
  conflictField?: Path<T>,
): Failure | null {
  if (!(error instanceof ApiError)) return failureOf(error, SAVE_FAILED);
  let mapped = false;
  for (const detail of error.details) {
    const field = fields.find((name) => name === detail.field);
    if (field !== undefined) {
      setError(field, { message: detail.message });
      mapped = true;
    }
  }
  if (!mapped && error.status === 409 && conflictField !== undefined) {
    setError(conflictField, { message: error.message });
    mapped = true;
  }
  return mapped ? null : { text: error.message, requestId: error.requestId };
}
