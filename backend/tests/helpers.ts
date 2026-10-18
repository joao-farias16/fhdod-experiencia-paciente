import { createApp } from '../src/app.js';
import { createLogger } from '../src/lib/logger.js';
import type { PrismaClient } from '../src/lib/prisma.js';
import type { Clock } from '../src/utils/clock.js';

export const FIXED_NOW = new Date('2026-10-10T17:25:03.120Z');
export const ALLOWED_ORIGIN = 'http://localhost:5173';

export const fixedClock: Clock = { now: () => FIXED_NOW };

export type DatabaseStub = Pick<PrismaClient, '$queryRaw'>;

/**
 * Dublê do cliente Prisma para os testes HTTP que não dependem do banco: `SELECT 1` responde
 * ('up'), falha ('down') ou nunca responde ('slow'). Os testes com PostgreSQL real ficam em tests/db.
 */
export function databaseStub(mode: 'up' | 'down' | 'slow' = 'up'): DatabaseStub {
  const queryRaw = (): Promise<unknown> => {
    if (mode === 'up') return Promise.resolve([{ ok: 1 }]);
    if (mode === 'down') return Promise.reject(new Error('banco indisponível'));
    return new Promise<never>(() => undefined);
  };
  return { $queryRaw: queryRaw } as unknown as DatabaseStub;
}

export function buildTestApp(prisma: DatabaseStub = databaseStub()) {
  return createApp({
    env: { CORS_ORIGIN: [ALLOWED_ORIGIN], TRUST_PROXY: 0 },
    logger: createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' }),
    prisma,
    clock: fixedClock,
  });
}

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details: { field: string; message: string }[];
    requestId: string;
  };
}

/** Lê o envelope de erro da API de uma resposta do Supertest. */
export function errorOf(response: { body: unknown }): ErrorBody['error'] {
  return (response.body as ErrorBody).error;
}
