import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';

import type { Env } from './config/env.js';
import type { PrismaClient } from './lib/prisma.js';
import { errorHandler } from './middlewares/error-handler.js';
import { notFoundHandler } from './middlewares/not-found.js';
import { requestLogger } from './middlewares/request-logger.js';
import { v1Router } from './routes/v1.js';
import { systemClock, type Clock } from './utils/clock.js';

/** Limite do corpo JSON (RNF11). */
export const JSON_BODY_LIMIT = '32kb';

/**
 * Dependências externas da aplicação: configuração, logger, relógio e cliente Prisma (ET02).
 * Na ET03 recebe também o verificador de token, permitindo testes sem Supabase (Seção 7).
 * O cliente é tipado pelo subconjunto usado, para que os testes possam injetar dublês.
 */
export interface AppDeps {
  env: Pick<Env, 'CORS_ORIGIN' | 'TRUST_PROXY'>;
  logger: Logger;
  prisma: Pick<PrismaClient, '$queryRaw'>;
  clock?: Clock;
}

export function createApp({ env, logger, prisma, clock = systemClock }: AppDeps): Express {
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

  app.use('/api/v1', v1Router({ clock, prisma }));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
