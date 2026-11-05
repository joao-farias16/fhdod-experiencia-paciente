/**
 * Middlewares e serviços da ET03 sem banco: 503 para MySQL indisponível (Tabela 18),
 * negativa de autorização sempre 403 mesmo se a auditoria falhar, rota pública no catálogo e
 * período padrão do E41 (RN25).
 */
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import type { Database } from '../../src/lib/database.js';
import { createLogger } from '../../src/lib/logger.js';
import type { SqlStatement } from '../../src/lib/sql.js';
import {
  auditAuthorizationDenials,
  requirePermission,
  authOf,
} from '../../src/modules/auth/auth.middleware.js';
import { errorHandler } from '../../src/middlewares/error-handler.js';
import { requestLogger } from '../../src/middlewares/request-logger.js';
import { listAuditLogsQuerySchema } from '../../src/modules/audit/audit.schemas.js';
import { AuthorizationDeniedError } from '../../src/utils/errors.js';
import { resolvePeriod } from '../../src/utils/validation.js';
import { errorOf } from '../support/app.js';

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
  const mysqlError = (code: string, message: string, extra: object = {}) =>
    Object.assign(new Error(message), { code, ...extra });

  it.each([
    ['conexão recusada', mysqlError('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:3306')],
    [
      'acesso negado',
      mysqlError('ER_ACCESS_DENIED_ERROR', "Access denied for user 'x'", { errno: 1045 }),
    ],
    [
      'banco inexistente',
      mysqlError('ER_BAD_DB_ERROR', "Unknown database 'fhdod'", { errno: 1049 }),
    ],
    ['conexão perdida', mysqlError('PROTOCOL_CONNECTION_LOST', 'Connection lost', { fatal: true })],
  ])('%s → 503 SERVICE_UNAVAILABLE sem detalhes internos', async (_case, error) => {
    const response = await request(appThatThrows(error)).get('/falha');
    expect(response.status).toBe(503);
    expect(errorOf(response).code).toBe('SERVICE_UNAVAILABLE');
    expect(response.text).not.toMatch(/ECONNREFUSED|Access denied|Unknown database|3306/);
  });

  it('violação de restrição não tratada continua 500 (sem a mensagem do MySQL)', async () => {
    const error = mysqlError('ER_DUP_ENTRY', "Duplicate entry 'x' for key 'sectors.y'", {
      errno: 1062,
    });
    const response = await request(appThatThrows(error)).get('/falha');
    expect(response.status).toBe(500);
    expect(response.text).not.toContain('Duplicate entry');
  });
});

describe('negativas de autorização', () => {
  function appWithDenial(auditFails: boolean) {
    const app = express();
    app.use(requestLogger(createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' })));
    app.use((req, _res, next) => {
      req.auth = {
        profileId: '00000000-0000-4000-8000-000000000001',
        sessionId: '00000000-0000-4000-8000-000000000002',
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
    const created: SqlStatement[] = [];
    const db = {
      execute: (statement: SqlStatement) => {
        if (auditFails) return Promise.reject(new Error('banco fora'));
        created.push(statement);
        return Promise.resolve({ affectedRows: 1, insertId: 1 });
      },
    } as unknown as Database;
    app.use(auditAuthorizationDenials({ db, ipSecret: undefined }));
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
    expect(created[0]?.text).toContain('INSERT INTO audit_logs');
    // Ordem dos valores: autor, perfil, ação, tipo, entidade, setor, detalhes, requestId, ipHash.
    expect(created[0]?.values.slice(2, 6)).toEqual([
      'AUTHORIZATION_DENIED',
      'endpoint',
      'E41',
      null,
    ]);
    expect(created[0]?.values.at(-1)).toBeNull();
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
