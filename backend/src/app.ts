import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';

import type { Env } from './config/env.js';
import type { PrismaClient } from './lib/prisma.js';
import { auditAuthorizationDenials } from './middlewares/authorize.js';
import { errorHandler } from './middlewares/error-handler.js';
import { notFoundHandler } from './middlewares/not-found.js';
import { requestLogger } from './middlewares/request-logger.js';
import type { AuthAdmin, TokenVerifier } from './modules/auth/auth.types.js';
import { v1Router } from './routes/v1.js';
import { systemClock, type Clock } from './utils/clock.js';

/** Limite do corpo JSON (RNF11). */
export const JSON_BODY_LIMIT = '32kb';

/**
 * Dependências externas da aplicação: configuração, logger, relógio, cliente Prisma (ET02) e,
 * desde a ET03, o verificador de token e as operações administrativas do Supabase Auth — o que
 * permite testar a API sem Supabase (Seção 7).
 */
export interface AppDeps {
  env: Pick<Env, 'CORS_ORIGIN' | 'TRUST_PROXY' | 'AUDIT_IP_SECRET'>;
  logger: Logger;
  prisma: PrismaClient;
  auth: { verifier: TokenVerifier; admin: AuthAdmin };
  clock?: Clock;
}

export function createApp({ env, logger, prisma, auth, clock = systemClock }: AppDeps): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestLogger(logger));
  // Cabeçalhos de segurança: HSTS, nosniff, Referrer-Policy, CSP restritiva (Seção 10).
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'Retry-After', 'Idempotent-Replayed'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: JSON_BODY_LIMIT, strict: true }));

  app.use(
    '/api/v1',
    v1Router({
      clock,
      prisma,
      logger,
      verifier: auth.verifier,
      authAdmin: auth.admin,
      ipSecret: env.AUDIT_IP_SECRET,
    }),
  );

  app.use(notFoundHandler);
  app.use(auditAuthorizationDenials({ prisma, ipSecret: env.AUDIT_IP_SECRET }));
  app.use(errorHandler);

  return app;
}
