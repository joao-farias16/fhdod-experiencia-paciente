import { createHash, createHmac } from 'node:crypto';

import { HttpError } from '../utils/http-error.js';

/**
 * Idempotência das submissões públicas (RN13, Seção 4.3): Idempotency-Key UUID v4 por
 * submissão e request_hash = SHA-256 do JSON canônico (chaves ordenadas) do corpo validado.
 */

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Cabeçalho ausente ou fora do formato UUID v4 → 400 IDEMPOTENCY_KEY_INVALID. */
export function parseIdempotencyKey(value: string | undefined): string {
  if (value === undefined || !UUID_V4.test(value.trim())) {
    throw new HttpError(
      400,
      'IDEMPOTENCY_KEY_INVALID',
      'O cabeçalho Idempotency-Key deve conter um UUID v4.',
    );
  }
  return value.trim().toLowerCase();
}

function canonical(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(canonical);
  if (input !== null && typeof input === 'object') {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, value]) => [key, canonical(value)]),
    );
  }
  return input;
}

/** SHA-256 hexadecimal do JSON canônico. */
export function canonicalHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

/** Mesma chave com conteúdo diferente → 409 IDEMPOTENCY_KEY_REUSED (RN13). */
export function idempotencyKeyReused(): HttpError {
  return new HttpError(
    409,
    'IDEMPOTENCY_KEY_REUSED',
    'Esta chave de envio já foi usada com outro conteúdo.',
  );
}

/**
 * Token de manifestação (Seção 4.3): base64url(HMAC-SHA256(MANIFESTATION_TOKEN_SECRET,
 * responseId)), nunca armazenado; a validade fica em manifestation_token_expires_at.
 */
export function manifestationToken(secret: string, responseId: string): string {
  return createHmac('sha256', secret).update(responseId).digest('base64url');
}
