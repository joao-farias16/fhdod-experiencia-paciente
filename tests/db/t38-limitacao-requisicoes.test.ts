/**
 * T38 — Limitação de requisições (RNF13, Seção 10), integração com MySQL real: exceder os limites
 * de E02 (30/min por IP), E03 (10/min por IP) e das rotas autenticadas (300/min por perfil) → 429
 * RATE_LIMITED com Retry-After, sem gravar nada além do permitido. E42 (30/min) está em
 * t29-t31-tv-wall.test.ts; E43 em tests/integration/app.test.ts; E05 e E34 nos testes T13 e T21.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/lib/database.js';
import { errorOf } from '../support/app.js';
import {
  type AuthScenario,
  buildAuthApp,
  createAuthScenario,
  openConnections,
} from '../support/auth-scenario.js';
import { countRows } from '../support/api.js';
import type { Db } from '../support/db.js';

let db: Db;
let database: Database;
let scenario: AuthScenario;

beforeAll(async () => {
  ({ db, database } = await openConnections());
  scenario = await createAuthScenario(db, database);
});

afterAll(async () => {
  await database.close();
  await db.end();
});

function expectRateLimited(response: request.Response) {
  expect(response.status).toBe(429);
  expect(errorOf(response).code).toBe('RATE_LIMITED');
  expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
  expect(response.body).not.toHaveProperty('data');
}

describe('T38 — limites por IP das rotas públicas de envio', () => {
  it('E02: 30 envios no minuto são processados; o 31º → 429 sem gravar resposta', async () => {
    const app = buildAuthApp(database);
    const responsesBefore = await countRows(db, 'SELECT 1 FROM responses WHERE sector_id = ?', [
      scenario.fx.sectorA,
    ]);
    // Corpo inválido (sem npsScore): cada envio passa pelo limitador e termina em 400, sem gravar.
    for (let index = 0; index < 30; index += 1) {
      const response = await request(app)
        .post('/api/v1/public/responses')
        .set('Idempotency-Key', crypto.randomUUID())
        .send({ surveyVersionId: scenario.fx.versionA2, origin: 'link', answers: [] });
      expect(response.status).toBe(400);
    }
    const limited = await request(app)
      .post('/api/v1/public/responses')
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ surveyVersionId: scenario.fx.versionA2, origin: 'link', npsScore: 9, answers: [] });
    expectRateLimited(limited);
    expect(
      await countRows(db, 'SELECT 1 FROM responses WHERE sector_id = ?', [scenario.fx.sectorA]),
    ).toBe(responsesBefore);
  });

  it('E03: 10 tentativas no minuto; a 11ª → 429 sem criar manifestação', async () => {
    const app = buildAuthApp(database);
    const before = await countRows(db, 'SELECT 1 FROM manifestations');
    for (let index = 0; index < 10; index += 1) {
      const response = await request(app)
        .post('/api/v1/public/manifestations')
        .set('Idempotency-Key', crypto.randomUUID())
        .send({});
      expect(response.status).toBe(400);
    }
    const limited = await request(app)
      .post('/api/v1/public/manifestations')
      .set('Idempotency-Key', crypto.randomUUID())
      .send({});
    expectRateLimited(limited);
    expect(await countRows(db, 'SELECT 1 FROM manifestations')).toBe(before);
  });
});

describe('T38 — limite por perfil das rotas autenticadas (300/min)', () => {
  it('a 301ª requisição do mesmo perfil → 429; outro perfil continua atendido', async () => {
    const app = buildAuthApp(database);
    for (let index = 0; index < 300; index += 1) {
      const response = await request(app)
        .get('/api/v1/me')
        .set('Authorization', scenario.bearer('ge'));
      expect(response.status).toBe(200);
    }
    const limited = await request(app)
      .get('/api/v1/me')
      .set('Authorization', scenario.bearer('ge'));
    expectRateLimited(limited);
    // A chave é o perfil, não o IP: o mesmo IP com outro perfil continua sendo atendido.
    const other = await request(app).get('/api/v1/me').set('Authorization', scenario.bearer('ou'));
    expect(other.status).toBe(200);
  });
});
