import { createApp } from '../src/app.js';
import { createLogger } from '../src/lib/logger.js';
import type { Clock } from '../src/utils/clock.js';

export const FIXED_NOW = new Date('2026-10-10T17:25:03.120Z');
export const ALLOWED_ORIGIN = 'http://localhost:5173';

export const fixedClock: Clock = { now: () => FIXED_NOW };

export function buildTestApp() {
  return createApp({
    env: { CORS_ORIGIN: [ALLOWED_ORIGIN], TRUST_PROXY: 0 },
    logger: createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' }),
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
