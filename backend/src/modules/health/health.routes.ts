import { Router } from 'express';

import type { Clock } from '../../utils/clock.js';
import { ipRateLimit } from '../../middlewares/rate-limit.js';

export interface HealthStatus {
  status: 'ok';
  service: 'fhdod-api';
  timestamp: string;
  uptimeSeconds: number;
}

/**
 * E43 — GET /api/v1/health: verificação pública de saúde da API (RNF27).
 * Na ET02, com o banco conectado, passará a responder 503 se `SELECT 1` não responder em 2 s.
 */
export function healthRouter(clock: Clock): Router {
  const router = Router();

  router.get('/health', ipRateLimit({ windowMs: 60_000, limit: 60 }), (_req, res) => {
    const body: { data: HealthStatus } = {
      data: {
        status: 'ok',
        service: 'fhdod-api',
        timestamp: clock.now().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
      },
    };
    res.set('Cache-Control', 'no-store').status(200).json(body);
  });

  return router;
}
