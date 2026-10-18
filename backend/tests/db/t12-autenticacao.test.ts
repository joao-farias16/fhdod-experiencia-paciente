/**
 * T12 — Autenticação administrativa (RF01, RF02, RF05), integração com PostgreSQL real e
 * verificador de token falso. Procedimento da Seção 12: E04 sem token, malformado, expirado e
 * válido → 401, 401, 401, 200; mais usuário sem perfil, conta desativada e sessão encerrada.
 * O login inválido e o logout na interface estão em frontend (T12 de componentes e E2E).
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../src/lib/prisma.js';
import { AuthServiceUnavailableError } from '../../src/modules/auth/auth.types.js';
import { permissionsFor } from '../../src/modules/auth/permissions.js';
import { FakeSupabase } from '../fake-supabase.js';
import { errorOf } from '../helpers.js';
import {
  type AuthScenario,
  buildAuthApp,
  createAuthScenario,
  openConnections,
} from './auth-support.js';
import type { Db } from './support.js';

let db: Db;
let prisma: PrismaClient;
let fake: FakeSupabase;
let scenario: AuthScenario;
let app: ReturnType<typeof buildAuthApp>;

beforeAll(async () => {
  ({ db, prisma } = await openConnections());
  fake = new FakeSupabase();
  scenario = await createAuthScenario(db, fake);
  app = buildAuthApp(prisma, fake);
});

afterAll(async () => {
  await prisma.$disconnect();
  await db.end();
});

describe('T12 — E04 GET /api/v1/me', () => {
  it.each([
    ['sem cabeçalho Authorization', undefined],
    ['com esquema diferente de Bearer', 'Basic dXN1YXJpbzpzZW5oYQ=='],
    ['com Bearer vazio', 'Bearer '],
    ['com token malformado', 'Bearer nao-e-um-jwt'],
    ['com token de três partes inválidas', 'Bearer a.b'],
  ])('responde 401 UNAUTHENTICATED %s', async (_case, header) => {
    const call = request(app).get('/api/v1/me');
    const response = await (header === undefined ? call : call.set('Authorization', header));

    expect(response.status).toBe(401);
    expect(errorOf(response).code).toBe('UNAUTHENTICATED');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).not.toHaveProperty('data');
  });

  it('responde 401 com token expirado', async () => {
    const past = Math.floor(Date.now() / 1000) - 7200;
    const token = fake.token(scenario.users.sa.authUserId, { iat: past, exp: past + 3600 });

    const response = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(errorOf(response).code).toBe('UNAUTHENTICATED');
  });

  it('responde 200 com token válido: perfil, escopo e permissões da Seção 6 (RF05)', async () => {
    const response = await request(app)
      .get('/api/v1/me')
      .set('Authorization', scenario.bearer('as'));

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const { data } = response.body as {
      data: {
        id: string;
        email: string;
        role: string;
        allSectors: boolean;
        sectors: { id: string; code: string }[];
        mustChangePassword: boolean;
        permissions: string[];
      };
    };
    expect(data).toMatchObject({
      id: scenario.users.as.profileId,
      email: scenario.users.as.email,
      role: 'sector_admin',
      allSectors: false,
      mustChangePassword: false,
    });
    expect(data.sectors.map((sector) => sector.id)).toEqual([scenario.fx.sectorA]);
    expect(data.permissions).toEqual(permissionsFor('sector_admin'));
    expect(data.permissions).not.toContain('users:read');
    expect(JSON.stringify(data)).not.toContain(scenario.users.as.authUserId);
  });

  it('responde 401 para conta do Supabase Auth sem perfil na aplicação', async () => {
    const response = await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${fake.token(scenario.orphanAuthUserId)}`);

    expect(response.status).toBe(401);
    expect(errorOf(response).code).toBe('UNAUTHENTICATED');
  });

  it('responde 403 ACCOUNT_DISABLED para perfil desativado com token válido', async () => {
    const response = await request(app)
      .get('/api/v1/me')
      .set('Authorization', scenario.bearer('disabled'));

    expect(response.status).toBe(403);
    expect(errorOf(response).code).toBe('ACCOUNT_DISABLED');
  });

  it('responde 403 ACCOUNT_DISABLED quando o Supabase Auth indica bloqueio (ban)', async () => {
    fake.setBannedState(scenario.users.ge.authUserId, true);
    try {
      const response = await request(app)
        .get('/api/v1/me')
        .set('Authorization', scenario.bearer('ge'));
      expect(response.status).toBe(403);
      expect(errorOf(response).code).toBe('ACCOUNT_DISABLED');
    } finally {
      fake.setBannedState(scenario.users.ge.authUserId, false);
    }
  });

  it('após o logout (signOut), o mesmo token recebe 401 e nenhum dado (RF02)', async () => {
    const token = fake.token(scenario.users.vi.authUserId);
    const before = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${token}`);
    expect(before.status).toBe(200);

    fake.revoke(token);
    const after = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${token}`);

    expect(after.status).toBe(401);
    expect(after.body).not.toHaveProperty('data');
  });

  it('não registra o token nem o perfil em resposta de erro', async () => {
    const token = fake.token(scenario.orphanAuthUserId);
    const response = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${token}`);

    expect(response.text).not.toContain(token);
    expect(response.text).not.toContain(scenario.orphanAuthUserId);
  });

  it('protege rotas administrativas sem token (401) antes de qualquer outra verificação', async () => {
    for (const path of [
      '/api/v1/admin/users',
      '/api/v1/admin/audit-logs',
      '/api/v1/admin/sectors',
    ]) {
      const response = await request(app).get(path);
      expect(response.status).toBe(401);
      expect(errorOf(response).code).toBe('UNAUTHENTICATED');
    }
    const post = await request(app)
      .post('/api/v1/me/password')
      .send({ newPassword: 'Valida12345' });
    expect(post.status).toBe(401);
  });

  it('responde 503 SERVICE_UNAVAILABLE quando o Supabase Auth não responde', async () => {
    const unavailable = buildAuthApp(prisma, {
      admin: fake.admin,
      verifier: { verify: () => Promise.reject(new AuthServiceUnavailableError('getUser')) },
    });

    const response = await request(unavailable)
      .get('/api/v1/me')
      .set('Authorization', scenario.bearer('sa'));

    expect(response.status).toBe(503);
    expect(errorOf(response).code).toBe('SERVICE_UNAVAILABLE');
  });
});
