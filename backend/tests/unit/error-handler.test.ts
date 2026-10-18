import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { errorHandler } from '../../src/middlewares/error-handler.js';
import { requestLogger } from '../../src/middlewares/request-logger.js';
import { createLogger } from '../../src/lib/logger.js';
import { HttpError } from '../../src/utils/http-error.js';
import { errorOf } from '../helpers.js';

function appThatThrows(error: unknown) {
  const app = express();
  app.use(requestLogger(createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' })));
  app.get('/falha', () => {
    throw error;
  });
  app.use(errorHandler);
  return app;
}

describe('errorHandler', () => {
  it('responde 500 INTERNAL_ERROR sem stack trace nem mensagem interna (RNF19)', async () => {
    const response = await request(appThatThrows(new Error('detalhe interno sigiloso'))).get(
      '/falha',
    );

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Ocorreu um erro inesperado. Tente novamente.',
        details: [],
        requestId: response.headers['x-request-id'],
      },
    });
    expect(response.text).not.toContain('sigiloso');
    expect(response.text).not.toContain('at ');
  });

  it('preserva status, código e detalhes de um HttpError', async () => {
    const error = new HttpError(400, 'VALIDATION_ERROR', 'Os dados enviados são inválidos.', [
      { field: 'npsScore', message: 'A nota deve estar entre 0 e 10.' },
    ]);

    const response = await request(appThatThrows(error)).get('/falha');

    expect(response.status).toBe(400);
    expect(errorOf(response)).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ field: 'npsScore', message: 'A nota deve estar entre 0 e 10.' }],
    });
  });

  it('trata valores lançados que não são Error', async () => {
    const response = await request(appThatThrows('texto solto')).get('/falha');

    expect(response.status).toBe(500);
    expect(errorOf(response).code).toBe('INTERNAL_ERROR');
  });
});
