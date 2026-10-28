/**
 * T17 — Auditoria de operações sensíveis (RF10, RF11, RN16), integração com PostgreSQL real.
 * Procedimento da Seção 12: cada ação do catálogo → um registro; UPDATE e DELETE em audit_logs
 * falham; nenhum dado pessoal. Também: atomicidade (falha da auditoria desfaz a operação),
 * consulta E41 somente pelo SA, filtros, período e página de no máximo 100 itens.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../src/lib/prisma.js';
import { ACCESS_AUDIT_ACTIONS } from '../../src/services/audit.service.js';
import { localDateOf } from '../../src/utils/dates.js';
import { FakeSupabase } from '../fake-supabase.js';
import { errorOf } from '../helpers.js';
import {
  type AuditRow,
  type AuthScenario,
  auditRowsFor,
  buildAuthApp,
  createAuthScenario,
  openConnections,
} from './auth-support.js';
import { type Db, expectDbError } from './support.js';

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

const sa = () => scenario.bearer('sa');

/** Segredos e dados pessoais que nunca podem aparecer na trilha. */
const secrets: string[] = [];

function expectSingleRecord(rows: AuditRow[], requestId: string | undefined): AuditRow {
  expect(rows).toHaveLength(1);
  const row = rows[0] as AuditRow;
  expect(row.request_id).toBe(requestId);
  expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/);
  return row;
}

describe('T17 — catálogo: exatamente um registro por operação', () => {
  let createdId = '';

  it('USER_CREATED (E07)', async () => {
    const email = `auditoria.${Date.now()}@example.com`;
    const response = await request(app)
      .post('/api/v1/admin/users')
      .set('Authorization', sa())
      .send({
        fullName: 'Pessoa Auditada Fictícia',
        email,
        role: 'sector_admin',
        sectorIds: [scenario.fx.sectorA],
      });
    expect(response.status).toBe(201);
    const { user, temporaryPassword } = (
      response.body as { data: { user: { id: string }; temporaryPassword: string } }
    ).data;
    createdId = user.id;
    secrets.push(email, 'Pessoa Auditada Fictícia', temporaryPassword);

    const row = expectSingleRecord(
      await auditRowsFor(db, createdId, 'USER_CREATED'),
      response.headers['x-request-id'],
    );
    expect(row).toMatchObject({
      entity_type: 'profile',
      actor_profile_id: scenario.users.sa.profileId,
      actor_role: 'superadmin',
      details: { role: 'sector_admin', allSectors: false, sectorIds: [scenario.fx.sectorA] },
    });
  });

  it('USER_UPDATED (E08: nome e perfil)', async () => {
    const response = await request(app)
      .patch(`/api/v1/admin/users/${createdId}`)
      .set('Authorization', sa())
      .send({ fullName: 'Nome Novo Fictício', role: 'management', allSectors: true });
    expect(response.status).toBe(200);
    secrets.push('Nome Novo Fictício');
    const row = expectSingleRecord(
      await auditRowsFor(db, createdId, 'USER_UPDATED'),
      response.headers['x-request-id'],
    );
    expect(row.details).toEqual({
      changedFields: ['fullName', 'role', 'scope'],
      roleFrom: 'sector_admin',
      roleTo: 'management',
      allSectors: true,
      sectorIdsAdded: [],
      sectorIdsRemoved: [scenario.fx.sectorA],
    });
  });

  it('USER_DEACTIVATED e USER_REACTIVATED (E08: isActive)', async () => {
    for (const [isActive, action] of [
      [false, 'USER_DEACTIVATED'],
      [true, 'USER_REACTIVATED'],
    ] as const) {
      const response = await request(app)
        .patch(`/api/v1/admin/users/${createdId}`)
        .set('Authorization', sa())
        .send({ isActive });
      expect(response.status).toBe(200);
      expectSingleRecord(
        await auditRowsFor(db, createdId, action),
        response.headers['x-request-id'],
      );
    }
  });

  it('USER_PASSWORD_RESET (E09)', async () => {
    const response = await request(app)
      .post(`/api/v1/admin/users/${createdId}/reset-password`)
      .set('Authorization', sa());
    expect(response.status).toBe(200);
    secrets.push((response.body as { data: { temporaryPassword: string } }).data.temporaryPassword);
    expectSingleRecord(
      await auditRowsFor(db, createdId, 'USER_PASSWORD_RESET'),
      response.headers['x-request-id'],
    );
  });

  it('PASSWORD_CHANGED (E05)', async () => {
    const newPassword = 'SenhaDefinitiva2026'; // gitleaks:allow — senha fictícia de teste
    secrets.push(newPassword);
    const response = await request(app)
      .post('/api/v1/me/password')
      .set('Authorization', scenario.bearer('ou'))
      .send({ newPassword });
    expect(response.status).toBe(204);
    expectSingleRecord(
      await auditRowsFor(db, scenario.users.ou.profileId, 'PASSWORD_CHANGED'),
      response.headers['x-request-id'],
    );
  });

  it('AUTHORIZATION_DENIED (negativa de permissão)', async () => {
    const response = await request(app)
      .get('/api/v1/admin/audit-logs')
      .set('Authorization', scenario.bearer('ge'));
    expect(response.status).toBe(403);
    const rows = await db.query<AuditRow>(
      "SELECT request_id::text, ip_hash, details FROM audit_logs WHERE action = 'AUTHORIZATION_DENIED' AND request_id = $1",
      [response.headers['x-request-id']],
    );
    expectSingleRecord(rows.rows, response.headers['x-request-id']);
  });

  it('o catálogo da ET03 foi exercitado por completo', async () => {
    const { rows } = await db.query<{ action: string }>(
      `SELECT DISTINCT action FROM audit_logs a JOIN profiles p ON p.id = a.actor_profile_id
       WHERE p.hospital_id = $1 ORDER BY action`,
      [scenario.fx.hospitalId],
    );
    expect(rows.map((row) => row.action)).toEqual([...ACCESS_AUDIT_ACTIONS].sort());
  });

  it('nenhum dado pessoal, senha, token ou segredo na trilha', async () => {
    const { rows } = await db.query(
      `SELECT a.* FROM audit_logs a JOIN profiles p ON p.id = a.actor_profile_id WHERE p.hospital_id = $1`,
      [scenario.fx.hospitalId],
    );
    const serialized = JSON.stringify(rows);
    expect(rows.length).toBeGreaterThanOrEqual(ACCESS_AUDIT_ACTIONS.length);
    for (const secret of [...secrets, ...Object.values(scenario.users).map((u) => u.email)]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toMatch(/Bearer|eyJ|127\.0\.0\.1|::ffff/);
  });
});

describe('T17 — atomicidade: falha da auditoria impede a operação', () => {
  /** Cliente Prisma cujas transações falham ao gravar em audit_logs. */
  function prismaWithFailingAudit(real: PrismaClient): PrismaClient {
    const failingTx = (tx: object) =>
      new Proxy(tx, {
        get(target, property) {
          if (property === 'auditLog') {
            return {
              create: () => Promise.reject(new Error('falha simulada ao gravar a auditoria')),
            };
          }
          return Reflect.get(target, property) as unknown;
        },
      });
    return new Proxy(real, {
      get(target, property) {
        if (property === '$transaction') {
          return (fn: (tx: object) => Promise<unknown>, options?: object) =>
            target.$transaction((tx) => fn(failingTx(tx)), options);
        }
        const value = Reflect.get(target, property) as unknown;
        return typeof value === 'function'
          ? (value as (...a: unknown[]) => unknown).bind(target)
          : value;
      },
    });
  }

  let failing: ReturnType<typeof buildAuthApp>;
  beforeAll(() => {
    failing = buildAuthApp(prismaWithFailingAudit(prisma), fake);
  });

  it('E07: sem perfil gravado e conta do Supabase Auth compensada (excluída)', async () => {
    const email = `atomicidade.${Date.now()}@example.com`;
    const response = await request(failing)
      .post('/api/v1/admin/users')
      .set('Authorization', sa())
      .send({ fullName: 'Pessoa Fictícia', email, role: 'viewer', allSectors: true });

    expect(response.status).toBe(500);
    expect(errorOf(response).code).toBe('INTERNAL_ERROR');
    expect(response.text).not.toContain('falha simulada');
    expect((await db.query('SELECT 1 FROM profiles WHERE email = $1', [email])).rowCount).toBe(0);
    expect([...fake.users.values()].some((user) => user.email === email)).toBe(false);
  });

  it('E08: nome e situação inalterados; nenhum bloqueio no Supabase', async () => {
    const target = scenario.users.vi;
    const before = (
      await db.query('SELECT full_name, is_active, updated_at FROM profiles WHERE id = $1', [
        target.profileId,
      ])
    ).rows;
    const bans = fake.calls.filter((call) => call.operation === 'setBanned').length;

    const response = await request(failing)
      .patch(`/api/v1/admin/users/${target.profileId}`)
      .set('Authorization', sa())
      .send({ fullName: 'Não deve gravar', isActive: false });

    expect(response.status).toBe(500);
    expect(
      (
        await db.query('SELECT full_name, is_active, updated_at FROM profiles WHERE id = $1', [
          target.profileId,
        ])
      ).rows,
    ).toEqual(before);
    expect(fake.calls.filter((call) => call.operation === 'setBanned')).toHaveLength(bans);
  });

  it('E09 e E05: senha não alterada no Supabase e flag preservada', async () => {
    const target = scenario.users.as;
    const password = fake.users.get(target.authUserId)?.password;

    expect(
      (
        await request(failing)
          .post(`/api/v1/admin/users/${target.profileId}/reset-password`)
          .set('Authorization', sa())
      ).status,
    ).toBe(500);
    expect(
      (
        await request(failing)
          .post('/api/v1/me/password')
          .set('Authorization', scenario.bearer('as'))
          .send({ newPassword: 'NaoDeveGravar123' })
      ).status,
    ).toBe(500);

    expect(fake.users.get(target.authUserId)?.password).toBe(password);
    const { rows } = await db.query<{ must_change_password: boolean }>(
      'SELECT must_change_password FROM profiles WHERE id = $1',
      [target.profileId],
    );
    expect(rows[0]?.must_change_password).toBe(false);
  });
});

describe('T17 — imutabilidade de audit_logs no próprio banco', () => {
  it('UPDATE, DELETE e TRUNCATE são rejeitados pelo PostgreSQL', async () => {
    const { rows } = await db.query<{ id: string }>(
      'SELECT id::text FROM audit_logs WHERE actor_profile_id = $1 ORDER BY id LIMIT 1',
      [scenario.users.sa.profileId],
    );
    const id = rows[0]?.id;
    expect(id).toBeDefined();
    await db.query('BEGIN');
    try {
      await expectDbError(db, "UPDATE audit_logs SET action = 'ALTERADO' WHERE id = $1", [id], {
        code: '23000',
        constraint: 'audit_logs_insert_only',
      });
      await expectDbError(db, 'DELETE FROM audit_logs WHERE id = $1', [id], {
        code: '23000',
        constraint: 'audit_logs_insert_only',
      });
      await expectDbError(db, 'TRUNCATE audit_logs', [], { code: '23000' });
    } finally {
      await db.query('ROLLBACK');
    }
    const after = await db.query('SELECT action FROM audit_logs WHERE id = $1', [id]);
    expect(after.rowCount).toBe(1);
  });
});

describe('T17 — E41 GET /api/v1/admin/audit-logs (RF11)', () => {
  const entityId = `teste-paginacao-${Date.now()}`;
  const today = localDateOf(new Date());

  beforeAll(async () => {
    // 105 eventos recentes e 1 antigo (40 dias) para a mesma entidade fictícia.
    await db.query(
      `INSERT INTO audit_logs (occurred_at, actor_profile_id, actor_role, action, entity_type, entity_id, details)
       SELECT now() - make_interval(secs => g), $1, 'superadmin', 'USER_UPDATED', 'profile', $2, '{}'::jsonb
       FROM generate_series(1, 105) AS g`,
      [scenario.users.sa.profileId, entityId],
    );
    await db.query(
      `INSERT INTO audit_logs (occurred_at, actor_profile_id, actor_role, action, entity_type, entity_id, details)
       VALUES (now() - interval '40 days', $1, 'superadmin', 'USER_CREATED', 'profile', $2, '{}'::jsonb)`,
      [scenario.users.sa.profileId, entityId],
    );
  });

  const list = (query: string, key: 'sa' | 'as' | 'ge' | 'ou' | 'vi' = 'sa') =>
    request(app)
      .get(`/api/v1/admin/audit-logs?${query}`)
      .set('Authorization', scenario.bearer(key));

  it.each(['as', 'ge', 'ou', 'vi'] as const)('perfil %s → 403 FORBIDDEN', async (key) => {
    const response = await list('', key);
    expect(response.status).toBe(403);
    expect(errorOf(response).code).toBe('FORBIDDEN');
  });

  it('página de no máximo 100 itens, em ordem decrescente, com meta', async () => {
    const page1 = await list(`entityId=${entityId}&pageSize=100`);
    expect(page1.status).toBe(200);
    const body = page1.body as {
      data: { id: string; occurredAt: string }[];
      meta: Record<string, unknown>;
    };
    expect(body.data).toHaveLength(100);
    expect(body.meta).toMatchObject({ page: 1, pageSize: 100, total: 105, to: today });
    const instants = body.data.map((item) => item.occurredAt);
    expect([...instants].sort().reverse()).toEqual(instants);

    const page2 = await list(`entityId=${entityId}&pageSize=100&page=2`);
    expect((page2.body as { data: unknown[] }).data).toHaveLength(5);

    const tooLarge = await list(`entityId=${entityId}&pageSize=101`);
    expect(tooLarge.status).toBe(400);
  });

  it('o padrão é a página de 50 itens dos últimos 30 dias; o período explícito inclui eventos antigos', async () => {
    const standard = await list(`entityId=${entityId}`);
    expect((standard.body as { meta: { total: number; pageSize: number } }).meta).toMatchObject({
      total: 105,
      pageSize: 50,
    });

    const from = localDateOf(new Date(Date.now() - 45 * 86_400_000));
    const wide = await list(`entityId=${entityId}&from=${from}&to=${today}`);
    expect((wide.body as { meta: { total: number } }).meta.total).toBe(106);
  });

  it('filtra por autor, ação e entidade', async () => {
    const byAction = await list(
      `entityId=${entityId}&action=USER_CREATED&from=2026-01-01&to=${today}`,
    );
    expect((byAction.body as { data: { action: string }[] }).data.map((i) => i.action)).toEqual([
      'USER_CREATED',
    ]);

    const byActor = await list(`actorProfileId=${scenario.users.ge.profileId}&entityType=endpoint`);
    const items = (
      byActor.body as {
        data: { actor: { id: string; role: string } | null; entityType: string; action: string }[];
      }
    ).data;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item).toMatchObject({
        actor: { id: scenario.users.ge.profileId, role: 'management' },
        entityType: 'endpoint',
        action: 'AUTHORIZATION_DENIED',
      });
    }
  });

  it('SA de outro hospital não vê estes eventos', async () => {
    const otherFake = new FakeSupabase();
    const other = await createAuthScenario(db, otherFake);
    const otherApp = buildAuthApp(prisma, otherFake);
    const response = await request(otherApp)
      .get(`/api/v1/admin/audit-logs?entityId=${entityId}`)
      .set('Authorization', other.bearer('sa'));
    expect(response.status).toBe(200);
    expect((response.body as { meta: { total: number } }).meta.total).toBe(0);
  });

  it('não devolve o HMAC do IP', async () => {
    const response = await list(`entityId=${entityId}&pageSize=1`);
    expect(JSON.stringify(response.body)).not.toMatch(/ipHash|ip_hash/);
  });

  it.each([
    ['from posterior a to', 'from=2026-10-10&to=2026-10-01'],
    ['período de 367 dias', 'from=2025-01-01&to=2026-01-02'],
    ['data inexistente', 'from=2026-02-30&to=2026-03-01'],
    ['formato brasileiro', 'from=01/10/2026'],
    ['autor inválido', 'actorProfileId=123'],
    ['parâmetro desconhecido', 'ip=1'],
  ])('%s → 400 VALIDATION_ERROR', async (_case, query) => {
    const response = await list(query);
    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('VALIDATION_ERROR');
  });

  it('366 dias é aceito (limite inclusivo da RN25)', async () => {
    expect((await list('from=2025-01-01&to=2026-01-01')).status).toBe(200);
  });
});
