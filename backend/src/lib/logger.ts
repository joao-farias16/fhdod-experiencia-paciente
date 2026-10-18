import { pino, type Logger, type LoggerOptions } from 'pino';

import type { Env } from '../config/env.js';

/**
 * Logs JSON estruturados (RNF19). Cabeçalhos sensíveis são removidos e nenhum corpo,
 * IP ou dado pessoal é registrado (Seção 7).
 */
export function createLogger(env: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>): Logger {
  const options: LoggerOptions = {
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    base: { service: 'fhdod-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'],
      censor: '[removido]',
    },
  };
  return pino(options);
}
