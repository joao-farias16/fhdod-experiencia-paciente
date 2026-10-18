import { type RequestHandler, Router } from 'express';
import type { Logger } from 'pino';

import type { PrismaClient } from '../lib/prisma.js';
import { authenticate } from '../middlewares/authenticate.js';
import { requirePasswordChanged } from '../middlewares/authorize.js';
import { profileRateLimit } from '../middlewares/rate-limit.js';
import { auditLogsRouter } from '../modules/audit-logs/audit-logs.routes.js';
import type { AuthAdmin, TokenVerifier } from '../modules/auth/auth.types.js';
import { healthRouter } from '../modules/health/health.routes.js';
import { meRouter } from '../modules/me/me.routes.js';
import { sectorsRouter } from '../modules/sectors/sectors.routes.js';
import { usersRouter } from '../modules/users/users.routes.js';
import type { Clock } from '../utils/clock.js';

export interface V1Deps {
  clock: Clock;
  prisma: PrismaClient;
  logger: Logger;
  verifier: TokenVerifier;
  authAdmin: AuthAdmin;
  ipSecret: string | undefined;
}

/**
 * Agrega as rotas da versão 1 da API, montadas em /api/v1. Cadeia das rotas autenticadas
 * (Seção 6): authenticate → limite de 300/min por perfil → requirePasswordChanged (exceto E04 e
 * E05) → requirePermission → serviços com o escopo de req.auth.
 */
export function v1Router({ clock, prisma, logger, verifier, authAdmin, ipSecret }: V1Deps): Router {
  const router = Router();
  const authChain: RequestHandler[] = [
    authenticate({ verifier, prisma }),
    profileRateLimit({ windowMs: 60_000, limit: 300 }),
  ];

  router.use(healthRouter({ clock, prisma }));
  router.use(meRouter({ prisma, authAdmin, authChain, ipSecret }));

  const admin = Router();
  admin.use(...authChain, requirePasswordChanged);
  admin.use(usersRouter({ prisma, authAdmin, logger, clock, ipSecret }));
  admin.use(sectorsRouter({ prisma }));
  admin.use(auditLogsRouter({ prisma, clock }));
  router.use('/admin', admin);

  return router;
}
