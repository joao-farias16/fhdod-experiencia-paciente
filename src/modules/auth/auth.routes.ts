import { type RequestHandler, Router } from 'express';
import { z } from 'zod';

import { ipRateLimit, profileRateLimit } from '../../middlewares/rate-limit.js';
import { parseInput } from '../../utils/validation.js';
import { hashIp } from '../audit/audit.service.js';
import { auditContextOf, authOf, requirePermission } from './auth.middleware.js';
import {
  type AuthServiceDeps,
  changeOwnPassword,
  getMe,
  login,
  logout,
  refreshSession,
} from './auth.service.js';
import { PASSWORD_MAX_LENGTH, passwordSchema } from './password-policy.js';

export interface AuthRoutesDeps extends AuthServiceDeps {
  /** authenticate + limite por perfil; sem requirePasswordChanged (E04, E05 e E46 são exceções). */
  authChain: RequestHandler[];
  ipSecret: string | undefined;
}

const changePasswordSchema = z.strictObject({ newPassword: passwordSchema });

const loginSchema = z.strictObject({
  email: z
    .string({ error: 'Informe o e-mail.' })
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: 'Informe um e-mail válido.' }).max(254)),
  password: z
    .string({ error: 'Informe a senha.' })
    .min(1, 'Informe a senha.')
    .max(PASSWORD_MAX_LENGTH, 'Senha inválida.'),
});

const refreshSchema = z.strictObject({
  refreshToken: z.string({ error: 'Informe o token de renovação.' }).min(1).max(256),
});

/**
 * Autenticação (Etapa 3): E44 POST /auth/login, E45 POST /auth/refresh e E46 POST /auth/logout;
 * perfil E04 GET /me e troca de senha E05 POST /me/password (5 trocas a cada 15 min por perfil).
 * Login e renovação são públicos e limitados por IP (força bruta).
 */
export function authRouter(deps: AuthRoutesDeps): Router {
  const router = Router();
  const { authChain, ipSecret } = deps;

  const signIn: RequestHandler = async (req, res) => {
    const input = parseInput(loginSchema, req.body);
    const result = await login(deps, input, hashIp(req.ip, ipSecret));
    res.set('Cache-Control', 'no-store').status(200).json({ data: result });
  };

  const refresh: RequestHandler = async (req, res) => {
    const { refreshToken } = parseInput(refreshSchema, req.body);
    const tokens = await refreshSession(deps, refreshToken);
    res.set('Cache-Control', 'no-store').status(200).json({ data: tokens });
  };

  const signOut: RequestHandler = async (req, res) => {
    await logout(deps, authOf(req));
    res.status(204).end();
  };

  const show: RequestHandler = async (req, res) => {
    res.status(200).json({ data: await getMe(deps.db, authOf(req)) });
  };

  const changePassword: RequestHandler = async (req, res) => {
    const { newPassword } = parseInput(changePasswordSchema, req.body);
    await changeOwnPassword(deps, authOf(req), auditContextOf(req, ipSecret), newPassword);
    res.status(204).end();
  };

  router.post(
    '/auth/login',
    ipRateLimit({ windowMs: 15 * 60_000, limit: 30 }),
    requirePermission('E44'),
    signIn,
  );
  router.post(
    '/auth/refresh',
    ipRateLimit({ windowMs: 60_000, limit: 60 }),
    requirePermission('E45'),
    refresh,
  );
  router.post('/auth/logout', ...authChain, requirePermission('E46'), signOut);
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
