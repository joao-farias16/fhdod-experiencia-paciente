import { createApp } from '../../src/app.js';
import type { Database } from '../../src/lib/database.js';
import { createLogger } from '../../src/lib/logger.js';
import type { AuthConfig } from '../../src/modules/auth/auth.types.js';
import type { Clock } from '../../src/utils/dates.js';

export const FIXED_NOW = new Date('2026-10-10T17:25:03.120Z');
export const ALLOWED_ORIGIN = 'http://localhost:5173';

export const fixedClock: Clock = { now: () => FIXED_NOW };

/**
 * Configuração da autenticação nos testes: bcrypt com custo 4 (rápido) e validades longas, para
 * que os relógios ajustáveis dos cenários (RN19, RN26, RF24) não expirem os tokens emitidos.
 */
export const TEST_AUTH_CONFIG: AuthConfig = {
  jwtSecret: 'segredo-de-teste-dos-tokens-com-mais-de-32-caracteres',
  accessTokenTtlSeconds: 10 * 365 * 86_400,
  refreshTokenTtlDays: 3650,
  bcryptRounds: 4,
};

function unavailable(): Promise<never> {
  return Promise.reject(Object.assign(new Error('banco indisponível'), { code: 'ECONNREFUSED' }));
}

/**
 * Dublê do banco para os testes HTTP que não dependem do MySQL: `SELECT 1` (ping) responde
 * ('up'), falha ('down') ou nunca responde ('slow'); consultas comuns falham como banco
 * indisponível. Os testes com MySQL real ficam em tests/db.
 */
export function databaseStub(mode: 'up' | 'down' | 'slow' = 'up'): Database {
  return {
    query: unavailable,
    execute: unavailable,
    transaction: unavailable,
    ping: () => {
      if (mode === 'up') return Promise.resolve();
      if (mode === 'down') return unavailable();
      return new Promise<never>(() => undefined);
    },
    close: () => Promise.resolve(),
  };
}

export function buildTestApp(db: Database = databaseStub(), clock: Clock = fixedClock) {
  return createApp({
    env: { CORS_ORIGIN: [ALLOWED_ORIGIN], TRUST_PROXY: 0 },
    logger: createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' }),
    db,
    auth: TEST_AUTH_CONFIG,
    clock,
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
