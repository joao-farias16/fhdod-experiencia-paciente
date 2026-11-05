import { randomUUID } from 'node:crypto';

import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Gera ou reaproveita o requestId (somente se for um UUID válido), devolve-o no cabeçalho
 * X-Request-Id e registra cada requisição sem corpo, IP, cabeçalhos ou query string.
 */
export function requestLogger(logger: Logger) {
  return pinoHttp({
    logger,
    genReqId(req, res) {
      const received = req.headers['x-request-id'];
      const id =
        typeof received === 'string' && UUID_PATTERN.test(received) ? received : randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    serializers: {
      req(req: { id: unknown; method: string; url: string }) {
        return { id: req.id, method: req.method, path: req.url.split('?')[0] };
      },
      res(res: { statusCode: number }) {
        return { statusCode: res.statusCode };
      },
    },
    customLogLevel(_req, res, err) {
      if (err !== undefined || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  });
}
