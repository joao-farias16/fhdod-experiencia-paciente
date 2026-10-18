import { rateLimit } from 'express-rate-limit';

import { HttpError } from '../utils/http-error.js';

interface RateLimitOptions {
  /** Janela em milissegundos. */
  windowMs: number;
  /** Máximo de requisições por IP na janela. */
  limit: number;
}

/**
 * Limitação por IP em memória (RNF13): responde 429 RATE_LIMITED com Retry-After.
 * O IP é usado apenas como chave em memória e nunca é gravado.
 */
export function ipRateLimit({ windowMs, limit }: RateLimitOptions) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler(_req, _res, next) {
      next(new HttpError(429, 'RATE_LIMITED', 'Muitas requisições. Aguarde e tente novamente.'));
    },
  });
}
