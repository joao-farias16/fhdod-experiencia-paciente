import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

import { ApiError } from '../../lib/api-client';

/** Mesmo padrão do backend para códigos de setor e equipe (RF12, RF16). */
export const CODE_PATTERN = /^[A-Z0-9_-]{2,20}$/;

export interface Failure {
  text: string;
  requestId?: string | undefined;
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
  if (!(error instanceof ApiError)) return { text: 'Não foi possível salvar. Tente novamente.' };
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
