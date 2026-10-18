/**
 * Middlewares e serviços da ET03 sem banco: 503 para banco ou Supabase indisponível (Tabela 18),
 * negativa de autorização sempre 403 mesmo se a auditoria falhar, rota pública no catálogo e
 * período padrão do E41 (RN25).
 */
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createLogger } from '../../src/lib/logger.js';
import { Prisma, type PrismaClient } from '../../src/lib/prisma.js';
import { auditAuthorizationDenials, requirePermission } from '../../src/middlewares/authorize.js';
import { errorHandler } from '../../src/middlewares/error-handler.js';
import { requestLogger } from '../../src/middlewares/request-logger.js';
import { listAuditLogsQuerySchema } from '../../src/modules/audit-logs/audit-logs.schemas.js';
import { resolvePeriod } from '../../src/modules/audit-logs/audit-logs.service.js';
import { AuthServiceUnavailableError } from '../../src/modules/auth/auth.types.js';
import { authOf } from '../../src/modules/auth/request-context.js';
import { AuthorizationDeniedError } from '../../src/utils/http-error.js';
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

describe('errorHandler — indisponibilidade (Tabela 18)', () => {
  it.each([
    ['Supabase Auth', new AuthServiceUnavailableError('getUser')],
    [
      'inicialização do Prisma',
      new Prisma.PrismaClientInitializationError('sem conexão', '7.10.1'),
    ],
    [
      'banco inacessível (P1001)',
      new Prisma.PrismaClientKnownRequestError('inacessível', {
        code: 'P1001',
        clientVersion: '7.10.1',
      }),
    ],
  ])('%s → 503 SERVICE_UNAVAILABLE sem detalhes internos', async (_case, error) => {
    const response = await request(appThatThrows(error)).get('/falha');
    expect(response.status).toBe(503);
    expect(errorOf(response).code).toBe('SERVICE_UNAVAILABLE');
    expect(response.text).not.toMatch(/inacessível|sem conexão|getUser/);
  });

  it('outro erro conhecido do Prisma continua 500', async () => {
    const error = new Prisma.PrismaClientKnownRequestError('único', {
      code: 'P2002',
      clientVersion: '7.10.1',
    });
    expect((await request(appThatThrows(error)).get('/falha')).status).toBe(500);
  });
});

describe('negativas de autorização', () => {
  function appWithDenial(auditFails: boolean) {
    const app = express();
    app.use(requestLogger(createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' })));
    app.use((req, _res, next) => {
      req.auth = {
        profileId: '00000000-0000-4000-8000-000000000001',
        authUserId: '00000000-0000-4000-8000-000000000002',
        hospitalId: '00000000-0000-4000-8000-000000000003',
        role: 'viewer',
        scope: { all: true },
        mustChangePassword: false,
      };
      next();
    });
    app.get('/publica', requirePermission('E43'), (_req, res) => {
      res.json({ data: 'ok' });
    });
    app.get('/restrita', requirePermission('E41'), (_req, res) => {
      res.json({ data: 'nunca' });
    });
    app.get('/ja-auditada', () => {
      const error = new AuthorizationDeniedError('FORBIDDEN', 'Negado.');
      error.audited = true;
      throw error;
    });
    const created: unknown[] = [];
    const prisma = {
      auditLog: {
        create: (args: unknown) => {
          if (auditFails) return Promise.reject(new Error('banco fora'));
          created.push(args);
          return Promise.resolve();
        },
      },
    } as unknown as Pick<PrismaClient, 'auditLog'>;
    app.use(auditAuthorizationDenials({ prisma, ipSecret: undefined }));
    app.use(errorHandler);
    return { app, created };
  }

  it('rota pública do catálogo não exige permissão', async () => {
    const { app } = appWithDenial(false);
    expect((await request(app).get('/publica')).status).toBe(200);
  });

  it('registra uma negativa por requisição; erro já auditado não é registrado de novo', async () => {
    const { app, created } = appWithDenial(false);
    expect((await request(app).get('/restrita')).status).toBe(403);
    expect((await request(app).get('/ja-auditada')).status).toBe(403);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      data: { action: 'AUTHORIZATION_DENIED', entityId: 'E41', ipHash: null },
    });
  });

  it('falha ao auditar não libera o acesso: continua 403', async () => {
    const { app } = appWithDenial(true);
    const response = await request(app).get('/restrita');
    expect(response.status).toBe(403);
    expect(errorOf(response).code).toBe('FORBIDDEN');
  });

  it('authOf sem autenticação montada → 500 (erro de configuração das rotas)', async () => {
    const app = express();
    app.use(requestLogger(createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' })));
    app.get('/sem-auth', (req, res) => {
      res.json({ data: authOf(req).profileId });
    });
    app.use(errorHandler);
    expect((await request(app).get('/sem-auth')).status).toBe(500);
  });
});

describe('E41 — período padrão (RN25)', () => {
  const now = new Date('2026-10-18T15:00:00Z');
  const parse = (query: Record<string, string>) => listAuditLogsQuerySchema.parse(query);

  it('sem datas: últimos 30 dias até hoje (fuso do hospital)', () => {
    expect(resolvePeriod(parse({}), now)).toEqual({ from: '2026-09-19', to: '2026-10-18' });
  });

  it('só "to": 30 dias terminando nele; só "from": 30 dias a partir dele, sem passar de hoje', () => {
    expect(resolvePeriod(parse({ to: '2026-06-30' }), now)).toEqual({
      from: '2026-06-01',
      to: '2026-06-30',
    });
    expect(resolvePeriod(parse({ from: '2026-01-01' }), now)).toEqual({
      from: '2026-01-01',
      to: '2026-01-30',
    });
    expect(resolvePeriod(parse({ from: '2026-10-10' }), now)).toEqual({
      from: '2026-10-10',
      to: '2026-10-18',
    });
  });
});
