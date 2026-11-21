/**
 * TV Wall (E42) sem banco: período, validação da query, lista explícita de campos da resposta
 * (RF72) e comportamento HTTP com o banco indisponível (RF69: a falha nunca é armazenada em cache,
 * para que a tela mantenha os últimos dados válidos) e com parâmetros inválidos.
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import {
  tvWallQuerySchema,
  tvWallSummarySchema,
} from '../../src/modules/tv-wall/tv-wall.schemas.js';
import { tvWallPeriod } from '../../src/modules/tv-wall/tv-wall.service.js';
import { buildTestApp, databaseStub, errorOf } from '../support/app.js';

const validSummary = {
  period: { key: '7d', from: '2026-10-14', to: '2026-10-20' },
  generatedAt: '2026-10-20T15:00:00.000Z',
  suppressionThreshold: 5,
  overall: { n: 9, nps: 66.7, promotersPercent: 77.8, detractorsPercent: 11.1, suppressed: false },
  trend: {
    granularity: 'day',
    points: [{ start: '2026-10-14', end: '2026-10-14', n: null, nps: null, suppressed: true }],
  },
  sectors: [{ name: 'Setor A', n: 5, nps: 40, promotersPercent: 60, detractorsPercent: 20 }],
};

describe('tvWallPeriod — dias locais inclusivos terminando hoje (RN25)', () => {
  it('7, 30 e 90 dias no fuso America/Sao_Paulo', () => {
    const now = new Date('2026-10-20T15:00:00Z');
    expect(tvWallPeriod('7d', now)).toEqual({ from: '2026-10-14', to: '2026-10-20' });
    expect(tvWallPeriod('30d', now)).toEqual({ from: '2026-09-21', to: '2026-10-20' });
    expect(tvWallPeriod('90d', now)).toEqual({ from: '2026-07-23', to: '2026-10-20' });
  });

  it('usa a data local: 01:30 UTC ainda é o dia anterior em São Paulo', () => {
    expect(tvWallPeriod('7d', new Date('2026-10-21T01:30:00Z'))).toEqual({
      from: '2026-10-14',
      to: '2026-10-20',
    });
  });
});

describe('tvWallQuerySchema — somente period (7d, 30d, 90d)', () => {
  it('padrão 30d', () => {
    expect(tvWallQuerySchema.parse({})).toEqual({ period: '30d' });
  });

  it.each([
    { period: '1d' },
    { period: '365d' },
    { period: '' },
    { sectorId: 'x' },
    { from: '2026-01-01' },
  ])('rejeita %o', (query) => {
    expect(tvWallQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe('tvWallSummarySchema — lista explícita de campos (RF72)', () => {
  it('aceita a resposta prevista', () => {
    expect(tvWallSummarySchema.safeParse(validSummary).success).toBe(true);
  });

  it.each([
    ['protocolo na raiz', { ...validSummary, protocol: 'FHD-2026-000001' }],
    ['e-mail no total', { ...validSummary, overall: { ...validSummary.overall, email: 'a@b.c' } }],
    ['equipe no setor', { ...validSummary, sectors: [{ ...validSummary.sectors[0], team: 'A1' }] }],
    ['id do setor', { ...validSummary, sectors: [{ ...validSummary.sectors[0], id: 'x' }] }],
    [
      'turno no ponto',
      {
        ...validSummary,
        trend: {
          ...validSummary.trend,
          points: [{ ...validSummary.trend.points[0], shiftPeriod: 'morning' }],
        },
      },
    ],
    ['link administrativo', { ...validSummary, links: ['/admin'] }],
  ])('recusa campo fora da lista: %s', (_name, value) => {
    expect(tvWallSummarySchema.safeParse(value).success).toBe(false);
  });

  it('recusa setor com menos de 5 respostas e mais de 8 setores', () => {
    const sector = validSummary.sectors[0];
    expect(
      tvWallSummarySchema.safeParse({ ...validSummary, sectors: [{ ...sector, n: 4 }] }).success,
    ).toBe(false);
    expect(
      tvWallSummarySchema.safeParse({
        ...validSummary,
        sectors: Array.from({ length: 9 }, (_, index) => ({ ...sector, name: `S${index}` })),
      }).success,
    ).toBe(false);
  });
});

describe('GET /api/v1/tv-wall/summary (E42) sem banco', () => {
  it('banco indisponível → 503 SERVICE_UNAVAILABLE com no-store e sem dados (RF69)', async () => {
    const response = await request(buildTestApp(databaseStub('down'))).get(
      '/api/v1/tv-wall/summary',
    );
    expect(response.status).toBe(503);
    expect(response.headers['cache-control']).toBe('no-store');
    const error = errorOf(response);
    expect(error.code).toBe('SERVICE_UNAVAILABLE');
    expect(error.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.body).not.toHaveProperty('data');
    expect(JSON.stringify(response.body)).not.toMatch(/ECONNREFUSED|stack|at \w+ \(/);
  });

  it.each(['?period=1d', '?period=30d&sectorId=1', '?from=2026-01-01', '?period=30d&period=7d'])(
    'parâmetro inválido %s → 400 VALIDATION_ERROR com no-store',
    async (query) => {
      const response = await request(buildTestApp()).get(`/api/v1/tv-wall/summary${query}`);
      expect(response.status).toBe(400);
      expect(errorOf(response).code).toBe('VALIDATION_ERROR');
      expect(response.headers['cache-control']).toBe('no-store');
    },
  );

  it('somente GET: POST na mesma rota → 404 ROUTE_NOT_FOUND', async () => {
    const response = await request(buildTestApp()).post('/api/v1/tv-wall/summary').send({});
    expect(response.status).toBe(404);
    expect(errorOf(response).code).toBe('ROUTE_NOT_FOUND');
  });

  it('não exige nem aceita autenticação: o token é ignorado e não há cookies', async () => {
    const response = await request(buildTestApp(databaseStub('down')))
      .get('/api/v1/tv-wall/summary')
      .set('Authorization', 'Bearer token-qualquer');
    // Sem banco, 503 — e não 401: a rota é pública (Tabela 13).
    expect(response.status).toBe(503);
    expect(response.headers['set-cookie']).toBeUndefined();
  });
});
