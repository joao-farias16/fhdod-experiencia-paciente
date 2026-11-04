import { type Options, rateLimit } from 'express-rate-limit';

import { HttpError } from '../utils/errors.js';

interface RateLimitOptions {
  /** Janela em milissegundos. */
  windowMs: number;
  /** Máximo de requisições por chave na janela. */
  limit: number;
}

/** Limitador em memória que responde 429 RATE_LIMITED com Retry-After (RNF13). */
function limiter({ windowMs, limit }: RateLimitOptions, extra: Partial<Options> = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler(_req, _res, next) {
      next(new HttpError(429, 'RATE_LIMITED', 'Muitas requisições. Aguarde e tente novamente.'));
    },
    ...extra,
  });
}

/** Limitação por IP. O IP é usado apenas como chave em memória e nunca é gravado. */
export function ipRateLimit(options: RateLimitOptions) {
  return limiter(options);
}

/**
 * Limitação por perfil autenticado (Seção 10: rotas autenticadas 300/min, E05 5 a cada 15 min).
 * Deve ser usada depois de `authenticate`; a chave é o id do perfil, nunca o IP.
 */
export function profileRateLimit(options: RateLimitOptions) {
  return limiter(options, {
    keyGenerator: (req) => `perfil:${req.auth?.profileId ?? 'anonimo'}`,
  });
}
