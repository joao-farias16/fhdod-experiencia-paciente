/**
 * T15 — Restrição por setor (RF08, RF13, RN10, RN18), integração com PostgreSQL real.
 * Procedimento da Seção 12: AS e GE restritos em E10, E22, E28, E34 e E23 de outro setor → só o
 * escopo; 403 SECTOR_OUT_OF_SCOPE em filtro; 404 em recurso.
 *
 * Todos os endpoints são os reais: E10 (ET03/ET04), E22/E23 (ET05), E28/E29 (ET08) e E34 (ET09).
 * As rotas-sonda usadas até a ET06 para E28 e E34 foram substituídas pelas rotas definitivas.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../src/lib/prisma.js';
import { FakeSupabase } from '../fake-supabase.js';
import { errorOf } from '../helpers.js';
import {
  type AuthScenario,
  buildAuthApp,
  createAuthScenario,
  deniedRowsOf,
  openConnections,
  type UserKey,
} from './auth-support.js';
import { type Db, insertResponse } from './support.js';

let db: Db;
let prisma: PrismaClient;
let fake: FakeSupabase;
let scenario: AuthScenario;
let app: ReturnType<typeof buildAuthApp>;

beforeAll(async () => {
  ({ db, prisma } = await openConnections());
  fake = new FakeSupabase();
  scenario = await createAuthScenario(db, fake);
  // Uma resposta também no setor B (o cenário da ET02 só tem resposta no setor A).
  await insertResponse(db, { versionId: scenario.fx.versionB1, sectorId: scenario.fx.sectorB });
  await insertResponse(db, { versionId: scenario.fx.versionB1, sectorId: scenario.fx.sectorB });
  app = buildAuthApp(prisma, fake);
});

afterAll(async () => {
  await prisma.$disconnect();
  await db.end();
});

const get = (target: typeof app, path: string, key: UserKey) =>
  request(target).get(path).set('Authorization', scenario.bearer(key));

async function expectOutOfScope(response: request.Response, key: UserKey, deniedBefore: number) {
  expect(response.status).toBe(403);
  expect(errorOf(response).code).toBe('SECTOR_OUT_OF_SCOPE');
  expect(response.body).not.toHaveProperty('data');
  const denied = await deniedRowsOf(db, scenario.users[key].profileId);
  expect(denied).toHaveLength(deniedBefore + 1);
  expect(denied.at(-1)?.details).toMatchObject({ code: 'SECTOR_OUT_OF_SCOPE' });
}

describe('T15 — E10 GET /admin/sectors (endpoint real)', () => {
  const codesOf = (response: request.Response) =>
    (response.body as { data: { code: string }[] }).data.map((sector) => sector.code);

  it('AS restrito ao setor A vê somente o setor A, com contagens', async () => {
    const response = await get(app, '/api/v1/admin/sectors', 'as');
    expect(response.status).toBe(200);
    expect((response.body as { data: unknown[] }).data).toEqual([
      expect.objectContaining({
        id: scenario.fx.sectorA,
        code: 'SETOR-A',
        isActive: true,
        activeTeams: 2,
        activeSurveys: 1,
      }),
    ]);
  });

  it('GE restrito ao setor B vê somente o setor B', async () => {
    expect(codesOf(await get(app, '/api/v1/admin/sectors', 'geB'))).toEqual(['SETOR-B']);
  });

  it('perfis globais veem todos os setores do hospital, inclusive inativos (histórico)', async () => {
    expect(codesOf(await get(app, '/api/v1/admin/sectors', 'ge'))).toEqual([
      'SETOR-A',
      'SETOR-B',
      'SETOR-C',
    ]);
    expect(codesOf(await get(app, '/api/v1/admin/sectors', 'sa'))).toEqual([
      'SETOR-A',
      'SETOR-B',
      'SETOR-C',
    ]);
    expect(codesOf(await get(app, '/api/v1/admin/sectors?isActive=true', 'ge'))).toEqual([
      'SETOR-A',
      'SETOR-B',
    ]);
  });

  it('escopo vazio → lista vazia (nada fora do escopo)', async () => {
    const response = await get(app, '/api/v1/admin/sectors', 'asEmpty');
    expect(response.status).toBe(200);
    expect((response.body as { data: unknown[] }).data).toEqual([]);
  });

  it('setor inativo associado continua visível como inativo', async () => {
    const response = await get(app, '/api/v1/admin/sectors', 'asInactiveSector');
    expect((response.body as { data: unknown[] }).data).toEqual([
      expect.objectContaining({ code: 'SETOR-C', isActive: false }),
    ]);
  });

  it('filtros inválidos → 400', async () => {
    expect((await get(app, '/api/v1/admin/sectors?isActive=sim', 'sa')).status).toBe(400);
    expect((await get(app, '/api/v1/admin/sectors?outro=1', 'sa')).status).toBe(400);
  });
});

describe('T15 — E22 e E23 (endpoints reais de pesquisas)', () => {
  it('AS sem filtro: somente pesquisas do setor A', async () => {
    const response = await get(app, '/api/v1/admin/surveys', 'as');
    expect(response.status).toBe(200);
    expect((response.body as { data: { id: string }[] }).data.map((s) => s.id)).toEqual([
      scenario.fx.surveyA,
    ]);
  });

  it('AS com filtro do setor B → 403 SECTOR_OUT_OF_SCOPE, auditado', async () => {
    const before = (await deniedRowsOf(db, scenario.users.as.profileId)).length;
    await expectOutOfScope(
      await get(app, `/api/v1/admin/surveys?sectorId=${scenario.fx.sectorB}`, 'as'),
      'as',
      before,
    );
  });

  it('E23 de pesquisa de outro setor → 404, indistinguível de inexistente', async () => {
    const other = await get(app, `/api/v1/admin/surveys/${scenario.fx.surveyB}`, 'as');
    const missing = await get(app, `/api/v1/admin/surveys/${crypto.randomUUID()}`, 'as');
    expect(other.status).toBe(404);
    expect(missing.status).toBe(404);
    const withoutRequestId = (error: ReturnType<typeof errorOf>) => ({
      code: error.code,
      message: error.message,
      details: error.details,
    });
    expect(withoutRequestId(errorOf(other))).toEqual(withoutRequestId(errorOf(missing)));
    expect((await get(app, `/api/v1/admin/surveys/${scenario.fx.surveyA}`, 'as')).status).toBe(200);
  });

  it('GE (restrito ou global) não acessa pesquisas: 403 FORBIDDEN pela matriz', async () => {
    for (const key of ['geB', 'ge'] as const) {
      const response = await get(app, `/api/v1/admin/surveys/${scenario.fx.surveyB}`, key);
      expect(response.status).toBe(403);
      expect(errorOf(response).code).toBe('FORBIDDEN');
    }
  });

  it('escopo vazio: lista vazia e qualquer filtro → 403', async () => {
    const list = await get(app, '/api/v1/admin/surveys', 'asEmpty');
    expect((list.body as { data: unknown[] }).data).toEqual([]);
    const before = (await deniedRowsOf(db, scenario.users.asEmpty.profileId)).length;
    await expectOutOfScope(
      await get(app, `/api/v1/admin/surveys?sectorId=${scenario.fx.sectorA}`, 'asEmpty'),
      'asEmpty',
      before,
    );
  });
});

describe('T15 — E28, E29 e E34 (endpoints reais desde a ET08 e a ET09)', () => {
  const DAY = 'from=2026-09-01&to=2026-09-01';
  const nOf = (response: request.Response) =>
    (response.body as { data: { indicators: { n: number | null } } }).data.indicators.n;

  it('consultas devolvem apenas dados do escopo autorizado', async () => {
    expect(nOf(await get(app, `/api/v1/dashboard/summary?${DAY}`, 'as'))).toBe(1); // setor A
    expect(nOf(await get(app, `/api/v1/dashboard/summary?${DAY}`, 'geB'))).toBe(2); // setor B
    expect(nOf(await get(app, `/api/v1/dashboard/summary?${DAY}`, 'ge'))).toBe(3); // global
    expect(
      nOf(
        await get(app, `/api/v1/dashboard/summary?${DAY}&sectorIds=${scenario.fx.sectorB}`, 'ge'),
      ),
    ).toBe(2);
    expect(nOf(await get(app, `/api/v1/dashboard/summary?${DAY}`, 'asEmpty'))).toBe(0);
    // VI restrito ao setor A: só o setor A no E29 (com 1 resposta, suprimido pela RN21).
    const sectors = await get(app, `/api/v1/dashboard/sectors?${DAY}`, 'vi');
    expect(
      (sectors.body as { data: { id: string; indicators: { suppressed: boolean } }[] }).data,
    ).toEqual([
      expect.objectContaining({
        id: scenario.fx.sectorA,
        indicators: expect.objectContaining({ suppressed: true }) as unknown,
      }),
    ]);
  });

  it('GE restrito filtrando outro setor no E28 → 403 SECTOR_OUT_OF_SCOPE', async () => {
    const before = (await deniedRowsOf(db, scenario.users.geB.profileId)).length;
    await expectOutOfScope(
      await get(app, `/api/v1/dashboard/summary?sectorIds=${scenario.fx.sectorA}`, 'geB'),
      'geB',
      before,
    );
  });

  it('E34: GE e AS restritos filtrando outro setor → 403; sem filtro, só o escopo', async () => {
    const geBefore = (await deniedRowsOf(db, scenario.users.geB.profileId)).length;
    await expectOutOfScope(
      await get(
        app,
        `/api/v1/reports/export?type=responses&sectorIds=${scenario.fx.sectorA}`,
        'geB',
      ),
      'geB',
      geBefore,
    );
    const asBefore = (await deniedRowsOf(db, scenario.users.as.profileId)).length;
    await expectOutOfScope(
      await get(
        app,
        `/api/v1/reports/export?type=responses&sectorIds=${scenario.fx.sectorB}`,
        'as',
      ),
      'as',
      asBefore,
    );

    const own = await get(app, `/api/v1/reports/export?type=responses&${DAY}`, 'geB');
    expect(own.status).toBe(200);
    const { rows } = await db.query<{ details: { sectorIds: string[]; rows: number } }>(
      `SELECT details FROM audit_logs WHERE action = 'REPORT_EXPORTED' AND actor_profile_id = $1
       ORDER BY id DESC LIMIT 1`,
      [scenario.users.geB.profileId],
    );
    expect(rows[0]?.details).toMatchObject({ sectorIds: [scenario.fx.sectorB], rows: 2 });
    const ou = await get(app, '/api/v1/reports/export?type=responses', 'ou');
    expect(ou.status).toBe(403);
    expect(errorOf(ou).code).toBe('FORBIDDEN');
  });
});

describe('T15 — administração do escopo (E07 e E08)', () => {
  const patch = (key: UserKey, id: string, body: object) =>
    request(app)
      .patch(`/api/v1/admin/users/${id}`)
      .set('Authorization', scenario.bearer(key))
      .send(body);

  async function linksOf(profileId: string): Promise<string[]> {
    const { rows } = await db.query<{ sector_id: string }>(
      'SELECT sector_id FROM profile_sectors WHERE profile_id = $1 ORDER BY sector_id',
      [profileId],
    );
    return rows.map((row) => row.sector_id);
  }

  it('tentativa de ampliar o próprio escopo: AS → 403; SA (para si) → 422', async () => {
    const asTry = await patch('as', scenario.users.as.profileId, {
      sectorIds: [scenario.fx.sectorA, scenario.fx.sectorB],
    });
    expect(asTry.status).toBe(403);
    expect(await linksOf(scenario.users.as.profileId)).toEqual([scenario.fx.sectorA]);

    const saTry = await patch('sa', scenario.users.sa.profileId, {
      role: 'management',
      allSectors: true,
    });
    expect(saTry.status).toBe(422);
    expect(errorOf(saTry).code).toBe('SELF_MODIFICATION_FORBIDDEN');

    const ownName = await patch('sa', scenario.users.sa.profileId, {
      fullName: 'Administrador Renomeado',
    });
    expect(ownName.status).toBe(200);
  });

  it('associação a setor inativo → 422 SECTOR_INACTIVE; inexistente → 422 INVALID_SCOPE', async () => {
    const create = await request(app)
      .post('/api/v1/admin/users')
      .set('Authorization', scenario.bearer('sa'))
      .send({
        fullName: 'Pessoa Fictícia',
        email: `inativo.${Date.now()}@example.com`,
        role: 'sector_admin',
        sectorIds: [scenario.sectorC],
      });
    expect(create.status).toBe(422);
    expect(errorOf(create).code).toBe('SECTOR_INACTIVE');
    expect(fake.calls.filter((c) => c.operation === 'createUser')).toHaveLength(0);

    const add = await patch('sa', scenario.users.geB.profileId, {
      sectorIds: [scenario.fx.sectorB, scenario.sectorC],
    });
    expect(add.status).toBe(422);
    expect(errorOf(add).code).toBe('SECTOR_INACTIVE');

    const unknown = await patch('sa', scenario.users.geB.profileId, {
      sectorIds: [crypto.randomUUID()],
    });
    expect(unknown.status).toBe(422);
    expect(errorOf(unknown).code).toBe('INVALID_SCOPE');
    expect(await linksOf(scenario.users.geB.profileId)).toEqual([scenario.fx.sectorB]);
  });

  it('vínculo existente com setor que foi desativado pode ser mantido', async () => {
    const id = scenario.users.asInactiveSector.profileId;
    const keep = await patch('sa', id, {
      fullName: 'Admin com setor inativo',
      sectorIds: [scenario.sectorC],
    });
    expect(keep.status).toBe(200);
    const extend = await patch('sa', id, { sectorIds: [scenario.sectorC, scenario.fx.sectorA] });
    expect(extend.status).toBe(200);
    expect(await linksOf(id)).toEqual([scenario.sectorC, scenario.fx.sectorA].sort());
  });

  // "A" é substituído pelo id real do setor A do cenário.
  it.each<[string, { role: string; allSectors?: boolean; sectorIds?: 'A'[] }, string]>([
    ['AS sem setor', { role: 'sector_admin', sectorIds: [] }, 'sectorIds'],
    ['AS com escopo global', { role: 'sector_admin', allSectors: true }, 'allSectors'],
    ['GE sem escopo', { role: 'management', allSectors: false }, 'sectorIds'],
    [
      'VI com global e setores',
      { role: 'viewer', allSectors: true, sectorIds: ['A'] },
      'sectorIds',
    ],
    ['SA restrito', { role: 'superadmin', allSectors: false }, 'allSectors'],
  ])('E07 — %s → 400 (RN18)', async (_case, scope, field) => {
    const body = {
      fullName: 'Pessoa Fictícia',
      email: `rn18.${Math.random().toString(36).slice(2, 8)}@example.com`,
      ...scope,
      ...(scope.sectorIds === undefined
        ? {}
        : { sectorIds: scope.sectorIds.map(() => scenario.fx.sectorA) }),
    };
    const response = await request(app)
      .post('/api/v1/admin/users')
      .set('Authorization', scenario.bearer('sa'))
      .send(body);
    expect(response.status).toBe(400);
    expect(errorOf(response).details.map((d) => d.field)).toContain(field);
  });

  it('E08 — trocar GE global por AS sem setores → 400; alteração de escopo vale na requisição seguinte', async () => {
    const invalid = await patch('sa', scenario.users.ge.profileId, { role: 'sector_admin' });
    expect(invalid.status).toBe(400);

    const moved = await patch('sa', scenario.users.vi.profileId, {
      sectorIds: [scenario.fx.sectorB],
    });
    expect(moved.status).toBe(200);
    const sectors = await get(app, '/api/v1/admin/sectors', 'vi');
    expect((sectors.body as { data: { id: string }[] }).data.map((s) => s.id)).toEqual([
      scenario.fx.sectorB,
    ]);
  });
});
