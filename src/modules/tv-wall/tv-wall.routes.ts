import { type RequestHandler, Router } from 'express';

import type { Queryable } from '../../lib/database.js';
import { ipRateLimit } from '../../middlewares/rate-limit.js';
import type { Clock } from '../../utils/dates.js';
import { parseInput } from '../../utils/validation.js';
import { requirePermission } from '../auth/auth.middleware.js';
import { tvWallQuerySchema } from './tv-wall.schemas.js';
import { getTvWallSummary, TvWallUnavailableError } from './tv-wall.service.js';

export interface TvWallRoutesDeps {
  db: Queryable;
  clock: Clock;
  hospitalShortName: string | undefined;
}

/** Cache público de 60 s do E42 (Seção 9), somente nas respostas 200. */
export const TV_WALL_CACHE_CONTROL = 'public, max-age=60';

/**
 * E42 — GET /tv-wall/summary: pública, sem login e sem cookies, limitada a 30 requisições por
 * minuto por IP (Seção 10). Erros (400, 429, 503) saem com Cache-Control: no-store, para que o
 * navegador ou um proxy nunca guardem uma falha no lugar dos últimos dados válidos (RF69).
 */
export function tvWallRouter({ db, clock, hospitalShortName }: TvWallRoutesDeps): Router {
  const router = Router();

  const noStoreUntilSuccess: RequestHandler = (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  };

  const summary: RequestHandler = async (req, res) => {
    const { period } = parseInput(tvWallQuerySchema, req.query);
    try {
      const data = await getTvWallSummary({ db, hospitalShortName }, period, clock.now());
      res.set('Cache-Control', TV_WALL_CACHE_CONTROL).status(200).json({ data });
    } catch (error) {
      if (error instanceof TvWallUnavailableError) {
        // Configuração do servidor: registrada no log, nunca na resposta pública.
        req.log.warn(
          { reason: error.reason, configured: hospitalShortName !== undefined },
          'TV Wall sem hospital definido (verifique TV_WALL_HOSPITAL_SHORT_NAME)',
        );
      }
      throw error;
    }
  };

  router.get(
    '/tv-wall/summary',
    noStoreUntilSuccess,
    ipRateLimit({ windowMs: 60_000, limit: 30 }),
    requirePermission('E42'),
    summary,
  );
  return router;
}
