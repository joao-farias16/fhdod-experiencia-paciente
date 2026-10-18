import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createLogger } from '../../src/lib/logger.js';
import { errorHandler } from '../../src/middlewares/error-handler.js';
import { requestLogger } from '../../src/middlewares/request-logger.js';
import { healthRouter } from '../../src/modules/health/health.routes.js';
import { databaseStub, errorOf, fixedClock } from '../helpers.js';

describe('healthRouter (E43)', () => {
  it('responde 503 quando o banco não responde dentro do limite (2 s em produção)', async () => {
    const app = express();
    app.use(requestLogger(createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' })));
    app.use(
      healthRouter({ clock: fixedClock, prisma: databaseStub('slow'), databaseTimeoutMs: 50 }),
    );
    app.use(errorHandler);

    const startedAt = Date.now();
    const response = await request(app).get('/health');

    expect(response.status).toBe(503);
    expect(errorOf(response).code).toBe('SERVICE_UNAVAILABLE');
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });
});
