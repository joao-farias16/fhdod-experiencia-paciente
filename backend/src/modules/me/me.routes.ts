import { type RequestHandler, Router } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../../lib/prisma.js';
import { requirePermission } from '../../middlewares/authorize.js';
import { profileRateLimit } from '../../middlewares/rate-limit.js';
import { parseInput } from '../../utils/validation.js';
import type { AuthAdmin } from '../auth/auth.types.js';
import { passwordSchema } from '../auth/password-policy.js';
import { auditContextOf, authOf } from '../auth/request-context.js';
import { changeOwnPassword, getMe } from './me.service.js';

export interface MeRoutesDeps {
  prisma: PrismaClient;
  authAdmin: AuthAdmin;
  /** authenticate + limite por perfil; sem requirePasswordChanged (E04 e E05 são exceções). */
  authChain: RequestHandler[];
  ipSecret: string | undefined;
}

const changePasswordSchema = z.strictObject({ newPassword: passwordSchema });

/** Controladores de E04 e E05: só validam a entrada, chamam o serviço e formatam a resposta. */
function meController({ prisma, authAdmin, ipSecret }: Omit<MeRoutesDeps, 'authChain'>) {
  const show: RequestHandler = async (req, res) => {
    res.status(200).json({ data: await getMe(prisma, authOf(req)) });
  };
  const changePassword: RequestHandler = async (req, res) => {
    const { newPassword } = parseInput(changePasswordSchema, req.body);
    await changeOwnPassword(
      { prisma, authAdmin },
      authOf(req),
      auditContextOf(req, ipSecret),
      newPassword,
    );
    res.status(204).end();
  };
  return { show, changePassword };
}

/** E04 — GET /me e E05 — POST /me/password (5 trocas a cada 15 minutos por perfil). */
export function meRouter(deps: MeRoutesDeps): Router {
  const router = Router();
  const controller = meController(deps);
  router.get('/me', ...deps.authChain, requirePermission('E04'), controller.show);
  router.post(
    '/me/password',
    ...deps.authChain,
    profileRateLimit({ windowMs: 15 * 60_000, limit: 5 }),
    requirePermission('E05'),
    controller.changePassword,
  );
  return router;
}
