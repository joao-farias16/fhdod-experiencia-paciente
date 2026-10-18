import { Router } from 'express';

import type { PrismaClient } from '../../lib/prisma.js';
import { ipRateLimit } from '../../middlewares/rate-limit.js';
import type { Clock } from '../../utils/clock.js';
import { HttpError } from '../../utils/http-error.js';

/** Tempo máximo de resposta do `SELECT 1` na verificação de saúde (E43). */
export const DATABASE_CHECK_TIMEOUT_MS = 2_000;

export interface HealthStatus {
  status: 'ok';
  service: 'fhdod-api';
  timestamp: string;
  uptimeSeconds: number;
}

export interface HealthDeps {
  clock: Clock;
  prisma: Pick<PrismaClient, '$queryRaw'>;
  databaseTimeoutMs?: number;
}

/** Executa `SELECT 1`; rejeita se o banco falhar ou não responder dentro do limite. */
async function checkDatabase(prisma: HealthDeps['prisma'], timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error('Tempo esgotado na verificação do banco'));
    }, timeoutMs);
  });
  try {
    await Promise.race([prisma.$queryRaw`SELECT 1`, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * E43 — GET /api/v1/health: verificação pública de saúde da API (RNF27).
 * Responde 503 SERVICE_UNAVAILABLE se `SELECT 1` falhar ou não responder em 2 s.
 */
export function healthRouter({
  clock,
  prisma,
  databaseTimeoutMs = DATABASE_CHECK_TIMEOUT_MS,
}: HealthDeps): Router {
  const router = Router();

  router.get('/health', ipRateLimit({ windowMs: 60_000, limit: 60 }), async (_req, res) => {
    try {
      await checkDatabase(prisma, databaseTimeoutMs);
    } catch {
      throw new HttpError(
        503,
        'SERVICE_UNAVAILABLE',
        'O serviço está temporariamente indisponível.',
      );
    }

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
