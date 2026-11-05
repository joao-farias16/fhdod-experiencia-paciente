/**
 * T12 — Autenticação administrativa (RF01, RF02, RF05) com a autenticação própria da Etapa 3
 * (bcrypt + JWT HS256 + sessões em auth_sessions), integração com MySQL real.
 * E04 sem token, malformado, adulterado, expirado e válido → 401, 401, 401, 401, 200; perfil
 * inexistente, conta desativada e sessão encerrada; E44 login, E45 renovação rotativa com
 * detecção de reutilização e E46 logout.
 */
import { createHash, randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/lib/database.js';
import { permissionsFor } from '../../src/modules/auth/permissions.js';
import { signAccessToken } from '../../src/modules/auth/tokens.js';
import { buildTestApp, databaseStub, errorOf, TEST_AUTH_CONFIG } from '../support/app.js';
import {
  type AuthScenario,
  buildAuthApp,
  createAuthScenario,
  DEFAULT_PASSWORD,
  openConnections,
} from '../support/auth-scenario.js';
import type { Db } from '../support/db.js';

let db: Db;
let database: Database;
let scenario: AuthScenario;
let app: ReturnType<typeof buildAuthApp>;

beforeAll(async () => {
  ({ db, database } = await openConnections());
  scenario = await createAuthScenario(db, database);
  app = buildAuthApp(database);
});

afterAll(async () => {
  await database.close();
  await db.end();
});

interface LoginData {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  expiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  user: { id: string; role: string; mustChangePassword: boolean; permissions: string[] };
}

const login = (email: string, password: string) =>
  request(app).post('/api/v1/auth/login').send({ email, password });

const me = (token: string) =>
  request(app).get('/api/v1/me').set('Authorization', `Bearer ${token}`);

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

  it('responde 401 com token expirado, assinado com outro segredo ou adulterado', async () => {
    const { sessionId } = await import('../../src/modules/auth/auth.service.js').then(
      async ({ createSession }) =>
        createSession(database, TEST_AUTH_CONFIG, scenario.users.sa.profileId, new Date()),
    );
    const claims = { profileId: scenario.users.sa.profileId, sessionId };
    const expired = signAccessToken(
      TEST_AUTH_CONFIG.jwtSecret,
      claims,
      new Date(Date.now() - 7_200_000),
      3600,
    ).token;
    const foreign = signAccessToken(
      'outro-segredo-qualquer-com-mais-de-32-caracteres',
      claims,
      new Date(),
      3600,
    ).token;
    const valid = signAccessToken(TEST_AUTH_CONFIG.jwtSecret, claims, new Date(), 3600).token;
    const [header, , signature] = valid.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({
        sub: scenario.users.sa2.profileId,
        sid: sessionId,
        iat: 1,
        exp: 4_102_444_800,
        typ: 'access',
      }),
    ).toString('base64url');

    expect((await me(valid)).status).toBe(200);
    for (const token of [expired, foreign, `${header ?? ''}.${forgedPayload}.${signature ?? ''}`]) {
      const response = await me(token);
      expect(response.status).toBe(401);
      expect(errorOf(response).code).toBe('UNAUTHENTICATED');
    }
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
    expect(JSON.stringify(data)).not.toMatch(/passwordHash|password_hash|\$2[aby]\$/);
  });

  it('responde 401 para token de sessão ou perfil inexistentes', async () => {
    const token = signAccessToken(
      TEST_AUTH_CONFIG.jwtSecret,
      { profileId: randomUUID(), sessionId: randomUUID() },
      new Date(),
      3600,
    ).token;
    const response = await me(token);

    expect(response.status).toBe(401);
    expect(errorOf(response).code).toBe('UNAUTHENTICATED');
    expect(response.text).not.toContain(token);
  });

  it('responde 403 ACCOUNT_DISABLED para perfil desativado com token válido', async () => {
    const response = await request(app)
      .get('/api/v1/me')
      .set('Authorization', scenario.bearer('disabled'));

    expect(response.status).toBe(403);
    expect(errorOf(response).code).toBe('ACCOUNT_DISABLED');
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
    expect((await request(app).post('/api/v1/auth/logout')).status).toBe(401);
  });

  it('responde 503 SERVICE_UNAVAILABLE quando o MySQL não responde', async () => {
    const response = await request(buildTestApp(databaseStub('down')))
      .get('/api/v1/me')
      .set('Authorization', scenario.bearer('sa'));

    expect(response.status).toBe(503);
    expect(errorOf(response).code).toBe('SERVICE_UNAVAILABLE');
  });
});

describe('T12 — E44 POST /api/v1/auth/login', () => {
  it('credenciais corretas → 200 com tokens, perfil e permissões; e-mail sem distinção de caixa', async () => {
    const response = await login(`  ${scenario.users.ge.email.toUpperCase()} `, DEFAULT_PASSWORD);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const data = (response.body as { data: LoginData }).data;
    expect(data.tokenType).toBe('Bearer');
    expect(data.expiresIn).toBe(TEST_AUTH_CONFIG.accessTokenTtlSeconds);
    expect(data.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(data.user).toMatchObject({ id: scenario.users.ge.profileId, role: 'management' });
    expect(data.user.permissions).toEqual(permissionsFor('management'));
    expect((await me(data.accessToken)).status).toBe(200);

    // A sessão guarda só o SHA-256 do token de renovação; o login atualiza last_login_at.
    const { rows } = await db.query<{ refresh_token_hash: string; last_login_at: Date | null }>(
      `SELECT s.refresh_token_hash, p.last_login_at
       FROM auth_sessions s JOIN profiles p ON p.id = s.profile_id
       WHERE s.refresh_token_hash = ?`,
      [createHash('sha256').update(data.refreshToken).digest('hex')],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.last_login_at).not.toBeNull();
    const stored = await db.query('SELECT 1 FROM auth_sessions WHERE refresh_token_hash = ?', [
      data.refreshToken,
    ]);
    expect(stored.rowCount).toBe(0);
  });

  it('senha errada e e-mail inexistente → mesma resposta 401 INVALID_CREDENTIALS', async () => {
    const wrong = await login(scenario.users.ge.email, 'SenhaErrada999');
    const unknown = await login(`ninguem.${Date.now()}@example.com`, DEFAULT_PASSWORD);

    for (const response of [wrong, unknown]) {
      expect(response.status).toBe(401);
      expect(errorOf(response).code).toBe('INVALID_CREDENTIALS');
      expect(errorOf(response).message).toBe('E-mail ou senha incorretos.');
      expect(response.text).not.toContain('SenhaErrada999');
    }
  });

  it('conta desativada com a senha correta → 403 ACCOUNT_DISABLED; com a senha errada → 401', async () => {
    const right = await login(scenario.users.disabled.email, DEFAULT_PASSWORD);
    expect(right.status).toBe(403);
    expect(errorOf(right).code).toBe('ACCOUNT_DISABLED');
    expect((await login(scenario.users.disabled.email, 'SenhaErrada999')).status).toBe(401);
  });

  it('troca pendente: o login é aceito, mas as rotas exigem a troca (403 PASSWORD_CHANGE_REQUIRED)', async () => {
    const response = await login(scenario.users.pending.email, DEFAULT_PASSWORD);
    expect(response.status).toBe(200);
    const data = (response.body as { data: LoginData }).data;
    expect(data.user.mustChangePassword).toBe(true);

    const blocked = await request(app)
      .get('/api/v1/admin/sectors')
      .set('Authorization', `Bearer ${data.accessToken}`);
    expect(blocked.status).toBe(403);
    expect(errorOf(blocked).code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await me(data.accessToken)).status).toBe(200);
  });

  it('corpo inválido → 400 VALIDATION_ERROR sem ecoar a senha', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nao-e-email', password: 'SenhaQualquer1', extra: true });
    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('VALIDATION_ERROR');
    expect(response.text).not.toContain('SenhaQualquer1');
  });
});

describe('T12 — E45 renovação e E46 logout', () => {
  it('renovação troca o par de tokens; o token de renovação anterior não serve mais', async () => {
    const first = (
      (await login(scenario.users.ou.email, DEFAULT_PASSWORD)).body as { data: LoginData }
    ).data;
    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken });
    expect(refreshed.status).toBe(200);
    const second = (refreshed.body as { data: LoginData }).data;
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect((await me(second.accessToken)).status).toBe(200);

    // Reapresentar o token já trocado logo em seguida (duas abas): recusado, sessão mantida.
    const reuse = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken });
    expect(reuse.status).toBe(401);
    expect((await me(second.accessToken)).status).toBe(200);
  });

  it('reutilização tardia de token já trocado revoga a sessão inteira (refresh_reuse)', async () => {
    const first = (
      (await login(scenario.users.ou.email, DEFAULT_PASSWORD)).body as { data: LoginData }
    ).data;
    const second = (
      (await request(app).post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken }))
        .body as { data: LoginData }
    ).data;
    // Simula a passagem da janela de 10 s desde a renovação.
    await db.query(
      'UPDATE auth_sessions SET last_refreshed_at = last_refreshed_at - INTERVAL 1 MINUTE WHERE refresh_token_hash = ?',
      [createHash('sha256').update(second.refreshToken).digest('hex')],
    );
    const reuse = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken });
    expect(reuse.status).toBe(401);
    expect((await me(second.accessToken)).status).toBe(401);
    const { rows } = await db.query<{ revoked_reason: string }>(
      'SELECT revoked_reason FROM auth_sessions WHERE refresh_token_hash = ?',
      [createHash('sha256').update(second.refreshToken).digest('hex')],
    );
    expect(rows[0]?.revoked_reason).toBe('refresh_reuse');
  });

  it('token de renovação desconhecido ou malformado → 401; conta desativada → 403', async () => {
    for (const refreshToken of ['x', 'A'.repeat(43)]) {
      const response = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
      expect(response.status).toBe(401);
    }
    const disabled = scenario.tokensOf('disabled');
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: disabled.refreshToken });
    expect(response.status).toBe(403);
    expect(errorOf(response).code).toBe('ACCOUNT_DISABLED');
  });

  it('após o logout, o mesmo token recebe 401 e nenhum dado; a renovação também falha (RF02)', async () => {
    const session = (
      (await login(scenario.users.vi.email, DEFAULT_PASSWORD)).body as { data: LoginData }
    ).data;
    expect((await me(session.accessToken)).status).toBe(200);

    const out = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${session.accessToken}`);
    expect(out.status).toBe(204);

    const after = await me(session.accessToken);
    expect(after.status).toBe(401);
    expect(after.body).not.toHaveProperty('data');
    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(refresh.status).toBe(401);
    // Outras sessões do mesmo usuário continuam válidas.
    expect(
      (await request(app).get('/api/v1/me').set('Authorization', scenario.bearer('vi'))).status,
    ).toBe(200);
  });

  it('as senhas ficam só como hash bcrypt (nunca em texto puro)', async () => {
    const { rows } = await db.query<{ password_hash: string }>(
      'SELECT password_hash FROM profiles WHERE hospital_id = ?',
      [scenario.fx.hospitalId],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.password_hash).toMatch(/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/);
      expect(row.password_hash).not.toContain(DEFAULT_PASSWORD);
    }
  });
});
