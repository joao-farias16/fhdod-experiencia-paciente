import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { ALLOWED_ORIGIN, buildTestApp, errorOf, FIXED_NOW } from '../helpers.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('GET /api/v1/health (E43)', () => {
  it('responde 200 com o estado da API no envelope { data }', async () => {
    const response = await request(buildTestApp()).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      data: {
        status: 'ok',
        service: 'fhdod-api',
        timestamp: FIXED_NOW.toISOString(),
        uptimeSeconds: expect.any(Number) as number,
      },
    });
  });

  it('aplica limitação de 60 requisições por minuto por IP com Retry-After (RNF13)', async () => {
    const app = buildTestApp();
    for (let i = 0; i < 60; i += 1) {
      const ok = await request(app).get('/api/v1/health');
      expect(ok.status).toBe(200);
    }

    const limited = await request(app).get('/api/v1/health');

    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(errorOf(limited).code).toBe('RATE_LIMITED');
  });
});

describe('cabeçalhos e rastreabilidade', () => {
  it('envia cabeçalhos de segurança e oculta X-Powered-By (Seção 10)', async () => {
    const response = await request(buildTestApp()).get('/api/v1/health');

    expect(response.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('gera um X-Request-Id UUID para cada requisição', async () => {
    const response = await request(buildTestApp()).get('/api/v1/health');

    expect(response.headers['x-request-id']).toMatch(UUID);
  });

  it('reaproveita um X-Request-Id válido e ignora um inválido', async () => {
    const app = buildTestApp();
    const valid = '0d9c2b7e-3f4a-4c1e-9b8d-6a5f4e3d2c1b';

    const reused = await request(app).get('/api/v1/health').set('X-Request-Id', valid);
    const replaced = await request(app).get('/api/v1/health').set('X-Request-Id', 'abc<script>');

    expect(reused.headers['x-request-id']).toBe(valid);
    expect(replaced.headers['x-request-id']).toMatch(UUID);
    expect(replaced.headers['x-request-id']).not.toBe('abc<script>');
  });
});

describe('CORS restrito a CORS_ORIGIN', () => {
  it('libera a origem configurada', async () => {
    const response = await request(buildTestApp())
      .get('/api/v1/health')
      .set('Origin', ALLOWED_ORIGIN);

    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
  });

  it('não libera origens não autorizadas', async () => {
    const response = await request(buildTestApp())
      .get('/api/v1/health')
      .set('Origin', 'https://site-malicioso.example');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('responde ao preflight com os cabeçalhos previstos', async () => {
    const response = await request(buildTestApp())
      .options('/api/v1/health')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Idempotency-Key');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-headers']).toContain('Idempotency-Key');
  });
});

describe('padrão de erros (Tabela 18)', () => {
  it('responde 404 ROUTE_NOT_FOUND para rota inexistente', async () => {
    const response = await request(buildTestApp()).get('/api/v1/nao-existe');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: 'O recurso solicitado não existe.',
        details: [],
        requestId: response.headers['x-request-id'],
      },
    });
  });

  it('responde 400 MALFORMED_JSON para JSON inválido', async () => {
    const response = await request(buildTestApp())
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"npsScore": ');

    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('MALFORMED_JSON');
  });

  it('responde 413 PAYLOAD_TOO_LARGE para corpo acima de 32 KB (RNF11)', async () => {
    const response = await request(buildTestApp())
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ texto: 'x'.repeat(33 * 1024) }));

    expect(response.status).toBe(413);
    expect(errorOf(response).code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('aceita corpo dentro do limite e segue para o 404 da rota', async () => {
    const response = await request(buildTestApp())
      .post('/api/v1/health')
      .send({ texto: 'x'.repeat(1024) });

    expect(response.status).toBe(404);
    expect(errorOf(response).code).toBe('ROUTE_NOT_FOUND');
  });
});
