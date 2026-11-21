/**
 * TV Wall (E42) — complemento de T30/T31 com MySQL real (ET11): limiares de supressão em todos os
 * níveis (setor com 0, 1, 4, 5 e 6 respostas; total com 0, 1, 4, 5 e 6), banco sem respostas,
 * fronteiras de período no fuso America/Sao_Paulo (00:00 e 23:59:59 locais), isolamento entre
 * hospitais e falha real do banco (pool encerrado).
 *
 * Relógio fixo: NOW = 15/12/2026 12:00 em America/Sao_Paulo (15:00 UTC); janela de 7 dias =
 * 09/12 a 15/12 locais. A resposta do cenário mínimo (01/09) fica fora de qualquer janela.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import type { Database } from '../../src/lib/database.js';
import { createDatabase } from '../../src/lib/database.js';
import { createLogger } from '../../src/lib/logger.js';
import type { Clock } from '../../src/utils/dates.js';
import { ALLOWED_ORIGIN, errorOf, TEST_AUTH_CONFIG } from '../support/app.js';
import { dataOf } from '../support/api.js';
import {
  connect,
  createFixture,
  createTestDatabase,
  testDatabaseEnv,
  type Db,
  type Fixture,
  insertResponse,
} from '../support/db.js';

const NOW = '2026-12-15T15:00:00.000Z';
const clock: Clock = { now: () => new Date(NOW) };

interface TvWall {
  overall: {
    n: number | null;
    nps: number | null;
    promotersPercent: number | null;
    detractorsPercent: number | null;
    suppressed: boolean;
  };
  trend: { points: { start: string; n: number | null; nps: number | null; suppressed: boolean }[] };
  sectors: { name: string; n: number; nps: number }[];
}

let db: Db;
let database: Database;

function appFor(shortName: string, target: Database = database) {
  return createApp({
    env: {
      CORS_ORIGIN: [ALLOWED_ORIGIN],
      TRUST_PROXY: 0,
      AUDIT_IP_SECRET: undefined,
      TV_WALL_HOSPITAL_SHORT_NAME: shortName,
    },
    logger: createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' }),
    db: target,
    auth: TEST_AUTH_CONFIG,
    clock,
  });
}

/** Cada chamada usa uma instância nova (o limite por IP é por instância do app). */
async function tvWall(shortName: string, query = '?period=7d'): Promise<TvWall> {
  const response = await request(appFor(shortName))
    .get(`/api/v1/tv-wall/summary${query}`)
    .set('Origin', ALLOWED_ORIGIN);
  expect(response.status).toBe(200);
  return dataOf<TvWall>(response);
}

async function shortNameOf(fx: Fixture): Promise<string> {
  const { rows } = await db.query<{ short_name: string }>(
    'SELECT short_name FROM hospitals WHERE id = ?',
    [fx.hospitalId],
  );
  return rows[0]?.short_name ?? '';
}

async function add(fx: Fixture, sector: 'A' | 'B', count: number, at: string, nps = 10) {
  for (let index = 0; index < count; index += 1) {
    await insertResponse(db, {
      versionId: sector === 'A' ? fx.versionA1 : fx.versionB1,
      sectorId: sector === 'A' ? fx.sectorA : fx.sectorB,
      npsScore: nps,
      submittedAt: at,
    });
  }
}

beforeAll(async () => {
  db = await connect();
  database = createTestDatabase();
});

afterAll(async () => {
  await database.close();
  await db.end();
});

describe('T30 — limiares de supressão (setor e total) com MySQL real', () => {
  let fx: Fixture;
  let name: string;

  beforeAll(async () => {
    fx = await createFixture(db);
    name = await shortNameOf(fx);
  });

  it('banco sem respostas na janela: n = 0, NPS nulo, sem setores e sem supressão', async () => {
    const tv = await tvWall(name);
    expect(tv.overall).toEqual({
      n: 0,
      nps: null,
      promotersPercent: null,
      detractorsPercent: null,
      suppressed: false,
    });
    expect(tv.sectors).toEqual([]);
    expect(tv.trend.points).toHaveLength(7);
    for (const point of tv.trend.points) {
      expect(point).toMatchObject({ n: 0, nps: null, suppressed: false });
    }
  });

  it('setor com 1 resposta (e o outro com 0): ambos ausentes; total 1 suprimido', async () => {
    await add(fx, 'A', 1, '2026-12-10T15:00:00Z');
    const tv = await tvWall(name);
    expect(tv.sectors).toEqual([]);
    expect(tv.overall).toEqual({
      n: null,
      nps: null,
      promotersPercent: null,
      detractorsPercent: null,
      suppressed: true,
    });
  });

  it('setor A com 4 e setor B com 0: ausentes; total 4 suprimido', async () => {
    await add(fx, 'A', 3, '2026-12-10T15:00:00Z');
    const tv = await tvWall(name);
    expect(tv.sectors).toEqual([]);
    expect(tv.overall.suppressed).toBe(true);
    expect(tv.overall.n).toBeNull();
    expect(tv.overall.nps).toBeNull();
  });

  it('setor A com exatamente 5 e B com 4: A presente, B ausente; total 9 exibido', async () => {
    await add(fx, 'A', 1, '2026-12-11T15:00:00Z', 3); // 5ª resposta de A (detratora)
    await add(fx, 'B', 4, '2026-12-11T15:00:00Z');
    const tv = await tvWall(name);
    // A: 4 promotores e 1 detrator em 5 → NPS 60; B (4) nunca aparece.
    expect(tv.sectors).toEqual([
      { name: 'Setor A', n: 5, nps: 60, promotersPercent: 80, detractorsPercent: 20 },
    ]);
    expect(JSON.stringify(tv)).not.toContain('Setor B');
    expect(tv.overall).toMatchObject({ n: 9, suppressed: false });
    expect(tv.overall.nps).toBe(77.8); // 8 promotores e 1 detrator em 9
  });

  it('setor com mais de 5 respostas (6) e B com 5: ambos presentes, em ordem de NPS', async () => {
    await add(fx, 'A', 1, '2026-12-12T15:00:00Z'); // A: 6 (5 promotores, 1 detrator)
    await add(fx, 'B', 1, '2026-12-12T15:00:00Z'); // B: 5 (todos promotores)
    const tv = await tvWall(name);
    expect(tv.sectors.map((sector) => [sector.name, sector.n, sector.nps])).toEqual([
      ['Setor B', 5, 100],
      ['Setor A', 6, 66.7],
    ]);
    expect(tv.overall).toMatchObject({ n: 11, suppressed: false });
  });

  it('total exatamente 5 com respostas de um único setor: exibido (não suprimido)', async () => {
    const other = await createFixture(db);
    await add(other, 'A', 5, '2026-12-13T15:00:00Z', 8);
    const tv = await tvWall(await shortNameOf(other));
    expect(tv.overall).toEqual({
      n: 5,
      nps: 0,
      promotersPercent: 0,
      detractorsPercent: 0,
      suppressed: false,
    });
  });
});

describe('E42 — fronteiras de período no fuso America/Sao_Paulo e isolamento entre hospitais', () => {
  it('inclui 00:00:00 do primeiro dia e 23:59:59 do último (locais); exclui 1 s antes e 1 s depois', async () => {
    const fx = await createFixture(db);
    // Janela de 7d: 09/12 00:00 local = 09/12 03:00Z até 16/12 03:00Z (exclusivo).
    await add(fx, 'A', 5, '2026-12-09T02:59:59Z'); // 08/12 23:59:59 local — fora
    await add(fx, 'A', 5, '2026-12-09T03:00:00Z'); // 09/12 00:00:00 local — dentro
    await add(fx, 'A', 5, '2026-12-16T02:59:59Z'); // 15/12 23:59:59 local — dentro
    await add(fx, 'A', 5, '2026-12-16T03:00:00Z'); // 16/12 00:00:00 local — fora
    const tv = await tvWall(await shortNameOf(fx));
    expect(tv.overall.n).toBe(10);
    expect(tv.sectors).toMatchObject([{ name: 'Setor A', n: 10 }]);
    expect(tv.trend.points[0]).toMatchObject({ start: '2026-12-09', n: 5 });
    expect(tv.trend.points[6]).toMatchObject({ start: '2026-12-15', n: 5 });
    for (const point of tv.trend.points.slice(1, 6)) expect(point.n).toBe(0);
  });

  it('respostas de outro hospital nunca entram nos números', async () => {
    const mine = await createFixture(db);
    const theirs = await createFixture(db);
    await add(mine, 'A', 5, '2026-12-12T15:00:00Z', 10);
    await add(theirs, 'A', 20, '2026-12-12T15:00:00Z', 0);
    const tv = await tvWall(await shortNameOf(mine));
    expect(tv.overall).toMatchObject({ n: 5, nps: 100, suppressed: false });
    expect(tv.sectors).toHaveLength(1);
  });
});

describe('T31 — banco realmente indisponível', () => {
  async function expectUnavailable(target: Database, shortName: string) {
    const response = await request(appFor(shortName, target))
      .get('/api/v1/tv-wall/summary')
      .set('Origin', ALLOWED_ORIGIN);
    expect(response.status).toBe(503);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(errorOf(response).code).toBe('SERVICE_UNAVAILABLE');
    expect(response.body).not.toHaveProperty('data');
    expect(JSON.stringify(response.body)).not.toMatch(/mysql|ECONN|pool|stack|SELECT/i);
  }

  it('conexão recusada (porta sem servidor, ECONNREFUSED real) → 503 sem dados nem detalhes', async () => {
    const refused = createDatabase({ ...testDatabaseEnv(), DB_HOST: '127.0.0.1', DB_PORT: 1 });
    try {
      await expectUnavailable(refused, 'qualquer');
    } finally {
      await refused.close();
    }
  });

  it('pool encerrado (desligamento da API) → 503, e não 500', async () => {
    const closed = createTestDatabase();
    await closed.close();
    await expectUnavailable(closed, 'qualquer');
  });
});
