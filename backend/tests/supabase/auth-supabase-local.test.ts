/**
 * T12, T13 e T16 contra o Supabase Auth LOCAL real (Supabase CLI) e o PostgreSQL de teste.
 * Executado por `npm run test:supabase -w backend` (não faz parte de `npm test`, pois exige o
 * Supabase local em execução). Cria somente contas fictícias @example.com e as exclui ao final.
 * Recusa qualquer URL que não seja local (scripts/db/guard.ts).
 */
import { createClient } from '@supabase/supabase-js';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assertLocalTargets } from '../../scripts/db/guard.js';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/lib/logger.js';
import { createPrismaClient, type PrismaClient } from '../../src/lib/prisma.js';
import { createSupabaseAuth } from '../../src/lib/supabase.js';
import { ALLOWED_ORIGIN, errorOf } from '../helpers.js';
import { connect, createFixture, type Db, type Fixture } from '../db/support.js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? '';
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? '';
const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false } } as const;

let db: Db;
let prisma: PrismaClient;
let admin: ReturnType<typeof clientWith>;
let fx: Fixture;
let app: ReturnType<typeof createApp>;
const createdAuthUsers: string[] = [];
const suffix = Math.random().toString(36).slice(2, 8);

function clientWith(key: string) {
  return createClient(SUPABASE_URL, key, OPTIONS);
}

function publicClient() {
  return clientWith(PUBLISHABLE_KEY);
}

async function signIn(email: string, password: string) {
  return publicClient().auth.signInWithPassword({ email, password });
}

async function accessToken(email: string, password: string): Promise<string> {
  const { data, error } = await signIn(email, password);
  if (error !== null) throw new Error(`Login falhou: ${error.code ?? error.message}`);
  return data.session.access_token;
}

/** Cria a conta no Auth local e o perfil no banco de teste. */
async function createAccount(key: string, role: string, password: string) {
  const email = `supabase-${key}.${suffix}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error !== null) throw error;
  createdAuthUsers.push(data.user.id);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO profiles (hospital_id, auth_user_id, full_name, email, role, all_sectors, must_change_password)
     VALUES ($1, $2, $3, $4, $5, true, false) RETURNING id`,
    [fx.hospitalId, data.user.id, `Conta Fictícia ${key}`, email, role],
  );
  return { email, password, profileId: rows[0]?.id ?? '', authUserId: data.user.id };
}

let sa: Awaited<ReturnType<typeof createAccount>>;
let sa2: Awaited<ReturnType<typeof createAccount>>;

beforeAll(async () => {
  if (SUPABASE_URL === '' || SECRET_KEY === '' || PUBLISHABLE_KEY === '') {
    throw new Error(
      'Defina SUPABASE_URL, SUPABASE_SECRET_KEY e SUPABASE_PUBLISHABLE_KEY (npx supabase status -o env).',
    );
  }
  assertLocalTargets(
    { SUPABASE_URL, TEST_DATABASE_URL: process.env.TEST_DATABASE_URL },
    'Testes com Supabase local',
  );
  db = await connect();
  prisma = createPrismaClient(process.env.TEST_DATABASE_URL ?? '');
  admin = clientWith(SECRET_KEY);
  fx = await createFixture(db);
  sa = await createAccount('sa', 'superadmin', 'SenhaDoSa2026x');
  sa2 = await createAccount('sa2', 'superadmin', 'SenhaDoSa2026y');
  app = createApp({
    env: { CORS_ORIGIN: [ALLOWED_ORIGIN], TRUST_PROXY: 0, AUDIT_IP_SECRET: 'h'.repeat(40) },
    logger: createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' }),
    prisma,
    auth: createSupabaseAuth({ SUPABASE_URL, SUPABASE_SECRET_KEY: SECRET_KEY }),
  });
});

afterAll(async () => {
  // Remove somente as contas criadas por estes testes no Auth local.
  for (const id of createdAuthUsers) await admin.auth.admin.deleteUser(id);
  await prisma.$disconnect();
  await db.end();
});

const me = (token: string) =>
  request(app).get('/api/v1/me').set('Authorization', `Bearer ${token}`);

describe('T12 com Supabase Auth real', () => {
  it('E04: sem token, malformado e adulterado → 401; válido → 200', async () => {
    expect((await request(app).get('/api/v1/me')).status).toBe(401);
    expect((await me('nao.e.jwt')).status).toBe(401);

    const token = await accessToken(sa.email, sa.password);
    const [header, payload, signature] = token.split('.') as [string, string, string];
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<
      string,
      unknown
    >;
    const tampered = `${header}.${Buffer.from(JSON.stringify({ ...claims, exp: 4_102_444_800 })).toString('base64url')}.${signature}`;
    const forged = await me(tampered);
    expect(forged.status).toBe(401);
    expect(errorOf(forged).code).toBe('UNAUTHENTICATED');

    const valid = await me(token);
    expect(valid.status).toBe(200);
    expect((valid.body as { data: { id: string } }).data.id).toBe(sa.profileId);
  });

  it('credenciais inválidas não autenticam (o Supabase não revela se o e-mail existe)', async () => {
    const wrong = await signIn(sa.email, 'SenhaErrada2026');
    const unknown = await signIn(`inexistente.${suffix}@example.com`, 'SenhaErrada2026');
    expect(wrong.error?.code).toBe('invalid_credentials');
    expect(unknown.error?.code).toBe('invalid_credentials');
  });

  it('após signOut, o access token anterior recebe 401 e o refresh é revogado (RF02)', async () => {
    const client = publicClient();
    const { data } = await client.auth.signInWithPassword({
      email: sa2.email,
      password: sa2.password,
    });
    const session = data.session;
    if (session === null) throw new Error('Sessão não criada.');
    expect((await me(session.access_token)).status).toBe(200);

    const { error } = await client.auth.signOut({ scope: 'local' });
    expect(error).toBeNull();

    expect((await me(session.access_token)).status).toBe(401);
    const refresh = await publicClient().auth.refreshSession({
      refresh_token: session.refresh_token,
    });
    expect(refresh.error).not.toBeNull();
  });

  it('conta do Auth sem perfil → 401', async () => {
    const email = `sem-perfil.${suffix}@example.com`;
    const { data } = await admin.auth.admin.createUser({
      email,
      password: 'SemPerfil2026',
      email_confirm: true,
    });
    createdAuthUsers.push(data.user?.id ?? '');
    expect((await me(await accessToken(email, 'SemPerfil2026'))).status).toBe(401);
  });
});

describe('T13 e RF06 com Supabase Auth real', () => {
  it('E07 cria a conta real; o usuário entra com a temporária e precisa trocá-la', async () => {
    const saToken = await accessToken(sa.email, sa.password);
    const email = `criado.${suffix}@example.com`;
    const response = await request(app)
      .post('/api/v1/admin/users')
      .set('Authorization', `Bearer ${saToken}`)
      .send({ fullName: 'Pessoa Criada Fictícia', email, role: 'viewer', allSectors: true });
    expect(response.status).toBe(201);
    const { temporaryPassword } = (response.body as { data: { temporaryPassword: string } }).data;
    const { rows } = await db.query<{ auth_user_id: string }>(
      'SELECT auth_user_id FROM profiles WHERE email = $1',
      [email],
    );
    createdAuthUsers.push(rows[0]?.auth_user_id ?? '');

    const token = await accessToken(email, temporaryPassword);
    expect((await me(token)).body).toMatchObject({ data: { mustChangePassword: true } });
    const blocked = await request(app)
      .get('/api/v1/admin/sectors')
      .set('Authorization', `Bearer ${token}`);
    expect(errorOf(blocked).code).toBe('PASSWORD_CHANGE_REQUIRED');

    const duplicate = await request(app)
      .post('/api/v1/admin/users')
      .set('Authorization', `Bearer ${saToken}`)
      .send({ fullName: 'Duplicado', email, role: 'viewer', allSectors: true });
    expect(duplicate.status).toBe(409);
  });

  it('E09: a senha anterior deixa de autenticar; E05 fraca → 400, válida → 204', async () => {
    const target = await createAccount('vi', 'viewer', 'SenhaOriginal2026');
    const saToken = await accessToken(sa.email, sa.password);

    const reset = await request(app)
      .post(`/api/v1/admin/users/${target.profileId}/reset-password`)
      .set('Authorization', `Bearer ${saToken}`);
    expect(reset.status).toBe(200);
    const { temporaryPassword } = (reset.body as { data: { temporaryPassword: string } }).data;

    expect((await signIn(target.email, target.password)).error?.code).toBe('invalid_credentials');
    await new Promise((resolve) => setTimeout(resolve, 1_100)); // iat posterior à redefinição
    const token = await accessToken(target.email, temporaryPassword);

    const weak = await request(app)
      .post('/api/v1/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ newPassword: 'fraca' });
    expect(weak.status).toBe(400);
    const valid = await request(app)
      .post('/api/v1/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ newPassword: 'SenhaDefinitiva2026' }); // gitleaks:allow — senha fictícia de teste
    expect(valid.status).toBe(204);

    expect((await signIn(target.email, temporaryPassword)).error?.code).toBe('invalid_credentials');
    const fresh = await accessToken(target.email, 'SenhaDefinitiva2026');
    expect(
      (await request(app).get('/api/v1/admin/sectors').set('Authorization', `Bearer ${fresh}`))
        .status,
    ).toBe(200);
  });
});

describe('T16 com Supabase Auth real', () => {
  it('desativação: token ainda válido → 403 ACCOUNT_DISABLED e login bloqueado; reativação libera', async () => {
    const target = await createAccount('ge', 'management', 'SenhaGestao2026');
    const token = await accessToken(target.email, target.password);
    const saToken = await accessToken(sa.email, sa.password);
    expect((await me(token)).status).toBe(200);

    const off = await request(app)
      .patch(`/api/v1/admin/users/${target.profileId}`)
      .set('Authorization', `Bearer ${saToken}`)
      .send({ isActive: false });
    expect(off.status).toBe(200);

    const blocked = await me(token);
    expect(blocked.status).toBe(403);
    expect(errorOf(blocked).code).toBe('ACCOUNT_DISABLED');
    expect((await signIn(target.email, target.password)).error?.code).toBe('user_banned');

    const on = await request(app)
      .patch(`/api/v1/admin/users/${target.profileId}`)
      .set('Authorization', `Bearer ${saToken}`)
      .send({ isActive: true });
    expect(on.status).toBe(200);
    expect((await me(await accessToken(target.email, target.password))).status).toBe(200);
  });
});
