import { Router } from 'express';

import type { PrismaClient } from '../lib/prisma.js';
import { healthRouter } from '../modules/health/health.routes.js';
import type { Clock } from '../utils/clock.js';

export interface V1Deps {
  clock: Clock;
  prisma: Pick<PrismaClient, '$queryRaw'>;
}

/** Agrega as rotas da versão 1 da API, montadas em /api/v1. */
export function v1Router({ clock, prisma }: V1Deps): Router {
  const router = Router();
  router.use(healthRouter({ clock, prisma }));
  return router;
}
