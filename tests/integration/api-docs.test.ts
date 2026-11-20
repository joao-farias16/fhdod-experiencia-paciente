import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { Database } from '../../src/lib/database.js';
import { type UserRole, USER_ROLES } from '../../src/lib/domain-types.js';
import type { SqlStatement } from '../../src/lib/sql.js';
import { ENDPOINTS, hasPermission, type Permission } from '../../src/modules/auth/permissions.js';
import { signAccessToken } from '../../src/modules/auth/tokens.js';
import { openApiDocument } from '../../src/openapi/api-docs.routes.js';
import type { HttpMethod, OpenApiOperation } from '../../src/openapi/document.js';
import { ErrorResponse, HealthStatus } from '../../src/openapi/schemas.js';
import { buildTestApp, databaseStub, FIXED_NOW, TEST_AUTH_CONFIG } from '../support/app.js';

const PROFILE_ID = '5b7f4c1e-8a2d-4f3b-9c6e-1d2a3b4c5d6e';
const SESSION_ID = '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b';
const HOSPITAL_ID = '0f1e2d3c-4b5a-4968-8776-655443322110';
const SAMPLE_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

function unavailable(): Promise<never> {
  return Promise.reject(Object.assign(new Error('banco indisponível'), { code: 'ECONNREFUSED' }));
}

/**
 * Banco que só reconhece a sessão do token de teste (perfil `role`, escopo global); qualquer outra
 * consulta falha como banco indisponível (503). Assim a requisição atravessa a autenticação, o
 * limite por perfil, a troca de senha e a permissão e chega ao controlador real da rota — uma
 * rota inexistente responderia 404 ROUTE_NOT_FOUND.
 */
function sessionOnlyDatabase(role: UserRole): Database {
  return {
    query: <T extends object>(statement: SqlStatement): Promise<T[]> => {
      if (statement.text.includes('FROM auth_sessions s JOIN profiles p')) {
        const row = {
          id: PROFILE_ID,
          hospital_id: HOSPITAL_ID,
          role,
          all_sectors: true,
          is_active: true,
          must_change_password: false,
        };
        return Promise.resolve([row] as unknown as T[]);
      }
      if (statement.text.includes('FROM profile_sectors')) return Promise.resolve([]);
      return unavailable();
    },
    execute: unavailable,
    transaction: unavailable,
    ping: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
}

const accessToken = signAccessToken(
  TEST_AUTH_CONFIG.jwtSecret,
  { profileId: PROFILE_ID, sessionId: SESSION_ID },
  FIXED_NOW,
  TEST_AUTH_CONFIG.accessTokenTtlSeconds,
).token;

const document = openApiDocument();

interface DocumentedOperation {
  method: HttpMethod;
  path: string;
  operation: OpenApiOperation;
}

const operations: DocumentedOperation[] = Object.entries(document.paths).flatMap(([path, item]) =>
  (['get', 'post', 'patch', 'delete'] as const).flatMap((method) => {
    const operation = item[method];
    return operation === undefined ? [] : [{ method, path, operation }];
  }),
);

function urlOf(path: string): string {
  const concrete = path.replace('{id}', SAMPLE_ID).replace('{slug}', 'pronto-atendimento');
  return `/api/v1${concrete}${path === '/reports/export' ? '?type=responses' : ''}`;
}

/** Permissão exigida pela rota (E34 com type=responses). */
function permissionOf(operationId: string): Permission | 'public' {
  if (operationId === 'E34') return ENDPOINTS['E34-respostas'].access;
  return ENDPOINTS[operationId as keyof typeof ENDPOINTS].access;
}

function send(app: ReturnType<typeof buildTestApp>, { method, path }: DocumentedOperation) {
  const pending = request(app)[method](urlOf(path));
  return method === 'get' ? pending : pending.send({});
}

describe('GET /api-docs (Swagger UI)', () => {
  it('redireciona /api-docs para /api-docs/', async () => {
    const response = await request(buildTestApp()).get('/api-docs');

    expect(response.status).toBe(301);
    expect(response.headers.location).toBe('/api-docs/');
  });

  it('serve a página do Swagger UI sem scripts inline, compatível com a CSP do helmet', async () => {
    const response = await request(buildTestApp()).get('/api-docs/');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.text).toContain('<title>API FHDOD — Swagger</title>');
    expect(response.text).toContain('<div id="swagger-ui"></div>');
    expect(response.text).toContain('src="./swagger-ui-bundle.js"');
    expect(response.text).toContain('src="./swagger-ui-init.js"');
    expect(response.text).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(response.headers['content-security-policy']).toContain("script-src 'self'");
    expect(response.headers['x-request-id']).toBeDefined();
  });

  it('dispensa upgrade-insecure-requests somente nas páginas da documentação (Safari em HTTP local)', async () => {
    const app = buildTestApp();

    const docs = await request(app).get('/api-docs/');
    const api = await request(app).get('/api/v1/health');

    expect(docs.headers['content-security-policy']).toContain("default-src 'self'");
    expect(docs.headers['content-security-policy']).toContain("object-src 'none'");
    expect(docs.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
    expect(api.headers['content-security-policy']).toContain('upgrade-insecure-requests');
  });

  it('serve os arquivos do Swagger UI e a inicialização com o documento da API', async () => {
    const app = buildTestApp();

    const init = await request(app).get('/api-docs/swagger-ui-init.js');
    expect(init.status).toBe(200);
    expect(init.headers['content-type']).toMatch(/application\/javascript/);
    expect(init.text).toContain('"openapi": "3.1.0"');
    expect(init.text).toContain('"validatorUrl": null');

    for (const asset of ['swagger-ui-bundle.js', 'swagger-ui-standalone-preset.js']) {
      const file = await request(app).get(`/api-docs/${asset}`);
      expect(file.status, asset).toBe(200);
      expect(file.headers['content-type'], asset).toMatch(/javascript/);
    }
    const css = await request(app).get('/api-docs/swagger-ui.css');
    expect(css.status).toBe(200);
    expect(css.headers['content-type']).toMatch(/text\/css/);
  });

  it('não expõe o package.json do swagger-ui-dist', async () => {
    const response = await request(buildTestApp()).get('/api-docs/package.json');

    expect(response.status).toBe(404);
  });
});

describe('GET /api-docs/openapi.json', () => {
  it('devolve o documento OpenAPI 3.1 em JSON', async () => {
    const response = await request(buildTestApp()).get('/api-docs/openapi.json');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual(JSON.parse(JSON.stringify(document)));
    expect(response.body).toMatchObject({ openapi: '3.1.0', servers: [{ url: '/api/v1' }] });
  });

  it('não interfere nas rotas inexistentes (404 ROUTE_NOT_FOUND no envelope padrão)', async () => {
    const response = await request(buildTestApp()).get('/api/v1/nao-existe');

    expect(response.status).toBe(404);
    expect(ErrorResponse.parse(response.body).error.code).toBe('ROUTE_NOT_FOUND');
  });
});

describe('operações documentadas × rotas reais do Express (T35)', () => {
  it('documenta 46 operações', () => {
    expect(operations).toHaveLength(46);
  });

  it('rotas protegidas recusam requisição sem token com 401 documentado; públicas não pedem token', async () => {
    const app = buildTestApp();

    for (const operation of operations) {
      const label = `${operation.method.toUpperCase()} ${operation.path}`;
      const response = await send(app, operation);
      const documented = Object.keys(operation.operation.responses);

      expect(documented, label).toContain(String(response.status));
      if (operation.operation.security.length > 0) {
        expect(response.status, label).toBe(401);
        expect(ErrorResponse.parse(response.body).error.code, label).toBe('UNAUTHENTICATED');
      } else {
        expect(response.status, label).not.toBe(401);
      }
    }
  });

  it('cada operação existe na API e responde com um status documentado', async () => {
    for (const operation of operations) {
      const label = `${operation.method.toUpperCase()} ${operation.path}`;
      const permission = permissionOf(operation.operation.operationId);
      const role =
        permission === 'public'
          ? undefined
          : USER_ROLES.find((candidate) => hasPermission(candidate, permission));
      const app = buildTestApp(role === undefined ? databaseStub() : sessionOnlyDatabase(role));

      let pending = send(app, operation);
      if (role !== undefined) pending = pending.set('Authorization', `Bearer ${accessToken}`);
      const response = await pending;

      expect(String(response.status), label).toMatch(/^\d{3}$/);
      expect(Object.keys(operation.operation.responses), label).toContain(String(response.status));
      if (response.status >= 400) {
        const { error } = ErrorResponse.parse(response.body);
        expect(error.code, label).not.toBe('ROUTE_NOT_FOUND');
        expect([401, 403], label).not.toContain(response.status);
        expect(error.requestId, label).toBe(response.headers['x-request-id']);
      }
    }
  });

  it('a resposta 200 de E43 segue o esquema documentado', async () => {
    const response = await request(buildTestApp()).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(() => z.strictObject({ data: HealthStatus }).parse(response.body)).not.toThrow();
  });
});
