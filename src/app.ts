import { randomBytes } from 'node:crypto';

import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';

import type { Database } from './lib/database.js';
import type { Env } from './lib/env.js';
import { errorHandler, notFoundHandler } from './middlewares/error-handler.js';
import { requestLogger } from './middlewares/request-logger.js';
import { auditAuthorizationDenials } from './modules/auth/auth.middleware.js';
import type { AuthConfig } from './modules/auth/auth.types.js';
import { v1Router } from './routes.js';
import { type Clock, systemClock } from './utils/dates.js';

/** Limite do corpo JSON (RNF11). */
export const JSON_BODY_LIMIT = '32kb';

/**
 * Dependências externas da aplicação: configuração, logger, relógio, banco MySQL (pool do
 * mysql2) e a configuração da autenticação própria (Etapa 3). PUBLIC_APP_URL (links e QR Code) e
 * MANIFESTATION_TOKEN_SECRET (token devolvido por E02) entram nas ET05 e ET06.
 */
export interface AppDeps {
  env: Pick<Env, 'CORS_ORIGIN' | 'TRUST_PROXY' | 'AUDIT_IP_SECRET'> &
    Partial<Pick<Env, 'PUBLIC_APP_URL' | 'MANIFESTATION_TOKEN_SECRET'>>;
  logger: Logger;
  db: Database;
  auth: AuthConfig;
  clock?: Clock;
}

export function createApp({ env, logger, db, auth, clock = systemClock }: AppDeps): Express {
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
      exposedHeaders: ['X-Request-Id', 'Retry-After', 'Idempotent-Replayed', 'Content-Disposition'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: JSON_BODY_LIMIT, strict: true }));

  app.use(
    '/api/v1',
    v1Router({
      clock,
      db,
      authConfig: auth,
      ipSecret: env.AUDIT_IP_SECRET,
      publicAppUrl: env.PUBLIC_APP_URL ?? 'http://localhost:5173',
      // Fora de produção, sem segredo configurado, o token vale só enquanto o processo rodar
      // (loadEnv exige MANIFESTATION_TOKEN_SECRET em produção).
      manifestationTokenSecret: env.MANIFESTATION_TOKEN_SECRET ?? randomBytes(32).toString('hex'),
    }),
  );

  app.use(notFoundHandler);
  app.use(auditAuthorizationDenials({ db, ipSecret: env.AUDIT_IP_SECRET }));
  app.use(errorHandler);

  return app;
}
