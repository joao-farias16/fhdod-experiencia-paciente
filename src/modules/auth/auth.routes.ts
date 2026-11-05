import { type RequestHandler, Router } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../../lib/prisma.js';
import { profileRateLimit } from '../../middlewares/rate-limit.js';
import { parseInput } from '../../utils/validation.js';
import { auditContextOf, authOf, requirePermission } from './auth.middleware.js';
import { changeOwnPassword, getMe } from './auth.service.js';
import type { AuthAdmin } from './auth.types.js';
import { passwordSchema } from './password-policy.js';

export interface AuthRoutesDeps {
  prisma: PrismaClient;
  authAdmin: AuthAdmin;
  /** authenticate + limite por perfil; sem requirePasswordChanged (E04 e E05 são exceções). */
  authChain: RequestHandler[];
  ipSecret: string | undefined;
}

const changePasswordSchema = z.strictObject({ newPassword: passwordSchema });

/** E04 — GET /me e E05 — POST /me/password (5 trocas a cada 15 minutos por perfil). */
export function authRouter({ prisma, authAdmin, authChain, ipSecret }: AuthRoutesDeps): Router {
  const router = Router();

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

  router.get('/me', ...authChain, requirePermission('E04'), show);
  router.post(
    '/me/password',
    ...authChain,
    profileRateLimit({ windowMs: 15 * 60_000, limit: 5 }),
    requirePermission('E05'),
    changePassword,
  );
  return router;
}
