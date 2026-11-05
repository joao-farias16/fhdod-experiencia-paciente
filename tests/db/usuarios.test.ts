/**
 * Administração de usuários (RF06–RF08; E06, E07 e E08), integração com MySQL real:
 * filtros e paginação, cadastro com senha temporária (hash bcrypt), e-mail duplicado e regras de
 * edição. Complementa T14–T17.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/lib/database.js';
import { isPasswordCompliant } from '../../src/modules/auth/password-policy.js';
import { errorOf } from '../support/app.js';
import {
  type AuthScenario,
  buildAuthApp,
  createAuthScenario,
  openConnections,
} from '../support/auth-scenario.js';
import type { Db } from '../support/db.js';

let db: Db;
let database: Database;
let scenario: AuthScenario;
let other: AuthScenario;
let app: ReturnType<typeof buildAuthApp>;

interface UserBody {
  id: string;
  fullName: string;
  email: string;
  role: string;
  allSectors: boolean;
  sectors: { id: string }[];
  isActive: boolean;
  mustChangePassword: boolean;
}

beforeAll(async () => {
  ({ db, database } = await openConnections());
  scenario = await createAuthScenario(db, database);
  other = await createAuthScenario(db, database); // outro hospital: não pode aparecer nem ser editado
  app = buildAuthApp(database);
});

afterAll(async () => {
  await database.close();
  await db.end();
});

const sa = () => scenario.bearer('sa');
const list = (query = '') =>
  request(app).get(`/api/v1/admin/users${query}`).set('Authorization', sa());
const usersOf = (response: request.Response) => (response.body as { data: UserBody[] }).data;

describe('E06 — GET /admin/users', () => {
  it('lista somente os usuários do hospital, ordenados por nome, com meta', async () => {
    const response = await list();
    expect(response.status).toBe(200);
    const body = response.body as {
      data: UserBody[];
      meta: { page: number; pageSize: number; total: number };
    };
    expect(body.meta).toEqual({ page: 1, pageSize: 20, total: 11 });
    const ids = body.data.map((user) => user.id);
    expect(ids).toContain(scenario.users.sa.profileId);
    expect(ids).not.toContain(other.users.sa.profileId);
    const names = body.data.map((user) => user.fullName);
    expect([...names].sort((a, b) => a.localeCompare(b, 'pt-BR'))).toEqual(names);
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|password_hash|\$2[aby]\$/);
  });

  it('filtra por perfil, situação, setor e busca (nome ou e-mail)', async () => {
    expect(usersOf(await list('?role=sector_admin')).map((u) => u.role)).toEqual([
      'sector_admin',
      'sector_admin',
      'sector_admin',
    ]);
    expect(usersOf(await list('?isActive=false')).map((u) => u.id)).toEqual([
      scenario.users.disabled.profileId,
    ]);
    expect(usersOf(await list(`?sectorId=${scenario.fx.sectorB}`)).map((u) => u.id)).toEqual([
      scenario.users.geB.profileId,
    ]);
    expect(usersOf(await list('?search=fict%C3%ADcio%20geb')).map((u) => u.id)).toEqual([
      scenario.users.geB.profileId,
    ]);
    expect(
      usersOf(
        await list(`?search=${encodeURIComponent(scenario.users.ou.email.toUpperCase())}`),
      ).map((u) => u.id),
    ).toEqual([scenario.users.ou.profileId]);
  });

  it('pagina com pageSize entre 1 e 100', async () => {
    const page = await list('?pageSize=5&page=3');
    expect(usersOf(page)).toHaveLength(1);
    expect((page.body as { meta: object }).meta).toEqual({ page: 3, pageSize: 5, total: 11 });
    for (const query of [
      '?pageSize=101',
      '?pageSize=0',
      '?page=0',
      '?role=paciente',
      '?isActive=1',
      '?sectorId=x',
      '?ordem=nome',
    ]) {
      expect((await list(query)).status).toBe(400);
    }
  });
});

describe('E07 — POST /admin/users', () => {
  const create = (body: object) =>
    request(app).post('/api/v1/admin/users').set('Authorization', sa()).send(body);

  it('cria conta e perfil; o usuário autentica com a senha temporária e deve trocá-la', async () => {
    const response = await create({
      fullName: '  Maria Fictícia de Teste  ',
      email: `  Maria.Nova.${Date.now()}@Example.com `,
      role: 'management',
      sectorIds: [scenario.fx.sectorA, scenario.fx.sectorB],
    });
    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const { user, temporaryPassword } = (
      response.body as { data: { user: UserBody; temporaryPassword: string } }
    ).data;
    expect(user).toMatchObject({
      fullName: 'Maria Fictícia de Teste',
      role: 'management',
      allSectors: false,
      isActive: true,
      mustChangePassword: true,
    });
    expect(user.email).toBe(user.email.toLowerCase());
    expect(user.sectors.map((s) => s.id).sort()).toEqual(
      [scenario.fx.sectorA, scenario.fx.sectorB].sort(),
    );
    expect(temporaryPassword).toHaveLength(16);
    expect(isPasswordCompliant(temporaryPassword)).toBe(true);

    const signIn = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: temporaryPassword });
    expect(signIn.status).toBe(200);
    const token = (signIn.body as { data: { accessToken: string } }).data.accessToken;
    const stored = await db.query<{ password_hash: string }>(
      'SELECT password_hash FROM profiles WHERE id = ?',
      [user.id],
    );
    expect(stored.rows[0]?.password_hash).toMatch(/^\$2[aby]\$/);
    expect(stored.rows[0]?.password_hash).not.toContain(temporaryPassword);
    const me = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${token}`);
    expect((me.body as { data: { mustChangePassword: boolean } }).data.mustChangePassword).toBe(
      true,
    );
    const blocked = await request(app)
      .get('/api/v1/admin/sectors')
      .set('Authorization', `Bearer ${token}`);
    expect(errorOf(blocked).code).toBe('PASSWORD_CHANGE_REQUIRED');

    const { rows } = await db.query('SELECT created_by FROM profiles WHERE id = ?', [user.id]);
    expect(rows[0]).toEqual({ created_by: scenario.users.sa.profileId });
  });

  it('SA recebe escopo global por padrão', async () => {
    const response = await create({
      fullName: 'Outro Superadmin',
      email: `sa.novo.${Date.now()}@example.com`,
      role: 'superadmin',
    });
    expect(response.status).toBe(201);
    expect((response.body as { data: { user: UserBody } }).data.user).toMatchObject({
      allSectors: true,
      sectors: [],
    });
  });

  it('e-mail já cadastrado → 409 sem gravar outro perfil', async () => {
    const before = await db.query('SELECT 1 FROM profiles');
    const response = await create({
      fullName: 'Duplicado',
      email: scenario.users.ge.email.toUpperCase(),
      role: 'viewer',
      allSectors: true,
    });
    expect(response.status).toBe(409);
    expect(errorOf(response).code).toBe('CONFLICT');
    expect((await db.query('SELECT 1 FROM profiles')).rowCount).toBe(before.rowCount);
  });

  it('banco indisponível → 503 e nenhum perfil', async () => {
    const { buildTestApp, databaseStub } = await import('../support/app.js');
    const response = await request(buildTestApp(databaseStub('down')))
      .post('/api/v1/admin/users')
      .set('Authorization', sa())
      .send({
        fullName: 'Pessoa Fictícia',
        email: 'x@example.com',
        role: 'viewer',
        allSectors: true,
      });
    expect(response.status).toBe(503);
    expect(errorOf(response).code).toBe('SERVICE_UNAVAILABLE');
  });

  it.each([
    ['campo desconhecido', { password: 'x' }, 'password'],
    ['e-mail inválido', { email: 'nao-e-email' }, 'email'],
    ['nome curto', { fullName: 'Al' }, 'fullName'],
    ['perfil inexistente', { role: 'patient' }, 'role'],
    [
      'setores repetidos',
      {
        role: 'viewer',
        allSectors: false,
        sectorIds: ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'],
      },
      'sectorIds',
    ],
  ])('%s → 400 VALIDATION_ERROR', async (_case, change, field) => {
    const response = await create({
      fullName: 'Pessoa Fictícia',
      email: `v.${Date.now()}@example.com`,
      role: 'viewer',
      allSectors: true,
      ...change,
    });
    expect(response.status).toBe(400);
    expect(errorOf(response).details.map((d) => d.field)).toContain(field);
  });
});

describe('E08 — PATCH /admin/users/:id', () => {
  const patch = (id: string, body: object) =>
    request(app).patch(`/api/v1/admin/users/${id}`).set('Authorization', sa()).send(body);

  it('GE restrito passa a global sem informar setores (vínculos removidos)', async () => {
    const response = await patch(scenario.users.geB.profileId, { allSectors: true });
    expect(response.status).toBe(200);
    expect((response.body as { data: UserBody }).data).toMatchObject({
      allSectors: true,
      sectors: [],
    });
  });

  it('VI global passa a restrito ao informar setores', async () => {
    const response = await patch(scenario.users.pending.profileId, {
      sectorIds: [scenario.fx.sectorA],
    });
    expect(response.status).toBe(200);
    expect((response.body as { data: UserBody }).data).toMatchObject({
      allSectors: false,
      sectors: [{ id: scenario.fx.sectorA }],
    });
  });

  it('usuário de outro hospital ou inexistente → 404', async () => {
    expect((await patch(other.users.vi.profileId, { fullName: 'Invasão' })).status).toBe(404);
    expect((await patch(crypto.randomUUID(), { fullName: 'Ninguém' })).status).toBe(404);
    const { rows } = await db.query('SELECT full_name FROM profiles WHERE id = ?', [
      other.users.vi.profileId,
    ]);
    expect(rows[0]).toEqual({ full_name: 'Usuário Fictício vi' });
  });

  it('corpo vazio → 400', async () => {
    expect((await patch(scenario.users.vi.profileId, {})).status).toBe(400);
  });
});
