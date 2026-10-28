/**
 * T14 — Permissões por perfil (RF05–RF07), integração com PostgreSQL real.
 * 1. A matriz inteira da Seção 6 (Tabela 13 × Tabela 19), transcrita aqui de forma independente
 *    do código, é comparada com a política do backend em cada combinação perfil × endpoint.
 * 2. Os endpoints E04–E10, E41 e as consultas E13, E16, E17 e E22 são chamados diretamente pela API com
 *    cada perfil: permitido → código do contrato; negado → 403 FORBIDDEN, sem efeito colateral e
 *    com exatamente um registro AUTHORIZATION_DENIED.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../src/lib/prisma.js';
import {
  ENDPOINTS,
  type EndpointId,
  hasPermission,
  PERMISSIONS,
  permissionsFor,
} from '../../src/modules/auth/permissions.js';
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
import type { Db } from './support.js';

type Role = 'superadmin' | 'sector_admin' | 'management' | 'ombudsman' | 'viewer';
const ROLES: Role[] = ['superadmin', 'sector_admin', 'management', 'ombudsman', 'viewer'];
const SA: Role[] = ['superadmin'];
const SA_AS: Role[] = ['superadmin', 'sector_admin'];
const ALL = ROLES;

/** Tabela 13 transcrita do PDF: perfis autorizados por endpoint ("–" = ausente). */
const MATRIX: Record<EndpointId, Role[] | 'public'> = {
  E01: 'public',
  E02: 'public',
  E03: 'public',
  E04: ALL, // Próprio perfil e senha: CA para todos
  E05: ALL,
  E06: SA, // Usuários e senha temporária: SA (C I A D S)
  E07: SA,
  E08: SA,
  E09: SA,
  E10: ALL, // Setores: SA CIAD; demais C*
  E11: SA,
  E12: SA,
  E13: ALL, // Equipes: SA CIAD; AS C* I* A* D*; GE, OU, VI C*
  E14: SA_AS,
  E15: SA_AS,
  E16: SA_AS, // Etapas da jornada: SA C, AS C
  E17: SA_AS, // Turnos e importação: SA C I D; AS C* I* D*
  E18: SA_AS,
  E19: SA_AS,
  E20: SA_AS,
  E21: SA_AS,
  E22: SA_AS, // Pesquisas, perguntas, publicação e QR Code: SA CIAD; AS C* I* A* D*
  E23: SA_AS,
  E24: SA_AS,
  E25: SA_AS,
  E26: SA_AS,
  E27: SA_AS,
  E28: ALL, // Indicadores do dashboard: todos (VI com supressão)
  E29: ALL,
  E30: ALL,
  E31: ALL,
  E32: ALL,
  E33: ALL,
  'E34-respostas': ['superadmin', 'sector_admin', 'management'], // X, X*, X*, –, –
  'E34-indicadores': ['superadmin', 'sector_admin', 'management'],
  'E34-manifestacoes': ['ombudsman'], // –, –, –, X*, –
  E35: ['ombudsman'], // Manifestações, notas e providências: só OU
  E36: ['ombudsman'],
  E37: ['ombudsman'],
  E38: ['ombudsman'],
  E39: ['ombudsman'], // Contato: OU S* D*
  E40: ['ombudsman'],
  E41: SA, // Auditoria: SA C
  E42: 'public',
  E43: 'public',
};

describe('T14 — matriz completa da Seção 6 × política do backend', () => {
  it('cobre exatamente os endpoints E01–E43 da Tabela 19 (E34 por tipo de relatório)', () => {
    expect(Object.keys(ENDPOINTS).sort()).toEqual(Object.keys(MATRIX).sort());
    const numbers = new Set(Object.keys(ENDPOINTS).map((id) => id.slice(0, 3)));
    expect(numbers.size).toBe(43);
  });

  const cases = (Object.keys(MATRIX) as EndpointId[]).flatMap((id) =>
    ROLES.map((role) => [id, role] as const),
  );

  it.each(cases)('%s × %s', (id, role) => {
    const expected = MATRIX[id];
    const { access } = ENDPOINTS[id];
    if (expected === 'public') {
      expect(access).toBe('public');
      return;
    }
    expect(access).not.toBe('public');
    if (access === 'public') return;
    expect(hasPermission(role, access)).toBe(expected.includes(role));
  });

  it('regras especiais: SA sem textos e contatos; GE sem Ouvidoria; VI só leitura', () => {
    const sa = permissionsFor('superadmin');
    expect(sa).not.toContain('manifestations:read');
    expect(sa).not.toContain('manifestation_contact:read');
    expect(sa).not.toContain('reports:export_manifestations');
    expect(sa).toContain('audit_logs:read');

    expect(permissionsFor('management')).not.toContain('reports:export_manifestations');
    expect(permissionsFor('ombudsman')).not.toContain('reports:export_responses');
    expect(permissionsFor('viewer')).toEqual([
      'profile:read',
      'profile:change_password',
      'sectors:read',
      'teams:read',
      'dashboard:read',
    ]);
    for (const role of ROLES.filter((r) => r !== 'superadmin')) {
      expect(
        permissionsFor(role).filter((p) => p.startsWith('users:') || p === 'audit_logs:read'),
      ).toEqual([]);
    }
  });

  it('toda permissão declarada é usada por algum endpoint', () => {
    const used = new Set(Object.values(ENDPOINTS).map((endpoint) => endpoint.access));
    expect(PERMISSIONS.filter((permission) => !used.has(permission))).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------
// Chamadas diretas à API
// -------------------------------------------------------------------------------------------

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

const ACTORS: { key: UserKey; role: Role }[] = [
  { key: 'sa', role: 'superadmin' },
  { key: 'as', role: 'sector_admin' },
  { key: 'ge', role: 'management' },
  { key: 'geB', role: 'management' },
  { key: 'ou', role: 'ombudsman' },
  { key: 'vi', role: 'viewer' },
];

interface Call {
  id: EndpointId;
  /** Código esperado quando o perfil é autorizado. */
  allowedStatus: number;
  send: (auth: string, actor: UserKey) => request.Test;
  /** Estado observável que não pode mudar quando a chamada é negada. */
  state: () => Promise<unknown>;
}

const uniqueEmail = (actor: string) =>
  `t14.${actor}.${Math.random().toString(36).slice(2, 8)}@example.com`;
const createdEmails: string[] = [];

const CALLS: Call[] = [
  {
    id: 'E04',
    allowedStatus: 200,
    send: (auth) => request(app).get('/api/v1/me').set('Authorization', auth),
    state: () => Promise.resolve(null),
  },
  {
    id: 'E05',
    // Senha fora da política: comprova a autorização (400) sem alterar a senha.
    allowedStatus: 400,
    send: (auth) =>
      request(app)
        .post('/api/v1/me/password')
        .set('Authorization', auth)
        .send({ newPassword: 'curta' }),
    state: () => Promise.resolve(fake.calls.filter((c) => c.operation === 'updatePassword').length),
  },
  {
    id: 'E06',
    allowedStatus: 200,
    send: (auth) => request(app).get('/api/v1/admin/users').set('Authorization', auth),
    state: () => Promise.resolve(null),
  },
  {
    id: 'E07',
    allowedStatus: 201,
    send: (auth, actor) => {
      const email = uniqueEmail(actor);
      createdEmails.push(email);
      return request(app)
        .post('/api/v1/admin/users')
        .set('Authorization', auth)
        .send({ fullName: 'Pessoa Fictícia T14', email, role: 'viewer', allSectors: true });
    },
    state: async () =>
      (
        await db.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM profiles WHERE email = ANY($1)',
          [createdEmails],
        )
      ).rows,
  },
  {
    id: 'E08',
    allowedStatus: 200,
    send: (auth, actor) =>
      request(app)
        .patch(`/api/v1/admin/users/${scenario.users.disabled.profileId}`)
        .set('Authorization', auth)
        .send({ fullName: `Nome alterado por ${actor}` }),
    state: async () =>
      (
        await db.query<{ full_name: string; updated_at: Date }>(
          'SELECT full_name, updated_at FROM profiles WHERE id = $1',
          [scenario.users.disabled.profileId],
        )
      ).rows,
  },
  {
    id: 'E09',
    allowedStatus: 200,
    send: (auth) =>
      request(app)
        .post(`/api/v1/admin/users/${scenario.users.asEmpty.profileId}/reset-password`)
        .set('Authorization', auth),
    state: async () => ({
      calls: fake.calls.filter((c) => c.operation === 'updatePassword').length,
      rows: (
        await db.query('SELECT must_change_password FROM profiles WHERE id = $1', [
          scenario.users.asEmpty.profileId,
        ])
      ).rows,
    }),
  },
  {
    id: 'E10',
    allowedStatus: 200,
    send: (auth) => request(app).get('/api/v1/admin/sectors').set('Authorization', auth),
    state: () => Promise.resolve(null),
  },
  // ET04 e ET05: consultas de equipes, etapas, escala e pesquisas (sem efeito colateral).
  {
    id: 'E13',
    allowedStatus: 200,
    send: (auth) => request(app).get('/api/v1/admin/teams').set('Authorization', auth),
    state: () => Promise.resolve(null),
  },
  {
    id: 'E16',
    allowedStatus: 200,
    send: (auth) => request(app).get('/api/v1/admin/journey-stages').set('Authorization', auth),
    state: () => Promise.resolve(null),
  },
  {
    id: 'E17',
    allowedStatus: 200,
    send: (auth) =>
      request(app)
        .get(`/api/v1/admin/shifts?sectorId=${scenario.fx.sectorA}&from=2026-09-01&to=2026-09-01`)
        .set('Authorization', auth),
    state: () => Promise.resolve(null),
  },
  {
    id: 'E22',
    allowedStatus: 200,
    send: (auth) => request(app).get('/api/v1/admin/surveys').set('Authorization', auth),
    state: () => Promise.resolve(null),
  },
  // ET07–ET09: Ouvidoria, dashboard e exportação (consultas sem efeito colateral nos dados).
  {
    id: 'E28',
    allowedStatus: 200,
    send: (auth) => request(app).get('/api/v1/dashboard/summary').set('Authorization', auth),
    state: () => Promise.resolve(null),
  },
  {
    id: 'E29',
    allowedStatus: 200,
    send: (auth) => request(app).get('/api/v1/dashboard/sectors').set('Authorization', auth),
    state: () => Promise.resolve(null),
  },
  {
    id: 'E33',
    allowedStatus: 200,
    send: (auth) => request(app).get('/api/v1/dashboard/questions').set('Authorization', auth),
    state: () => Promise.resolve(null),
  },
  {
    id: 'E34-respostas',
    allowedStatus: 200,
    send: (auth) =>
      request(app).get('/api/v1/reports/export?type=responses').set('Authorization', auth),
    state: () => Promise.resolve(null),
  },
  {
    id: 'E34-manifestacoes',
    allowedStatus: 200,
    send: (auth) =>
      request(app).get('/api/v1/reports/export?type=manifestations').set('Authorization', auth),
    state: () => Promise.resolve(null),
  },
  {
    id: 'E35',
    allowedStatus: 200,
    send: (auth) => request(app).get('/api/v1/ouvidoria/manifestations').set('Authorization', auth),
    state: () => Promise.resolve(null),
  },
  {
    id: 'E41',
    allowedStatus: 200,
    send: (auth) => request(app).get('/api/v1/admin/audit-logs').set('Authorization', auth),
    state: () => Promise.resolve(null),
  },
];

describe('T14 — chamadas diretas à API por perfil (ET03 e consultas das ET04, ET05 e ET07–ET09)', () => {
  const cases = CALLS.flatMap((call) =>
    ACTORS.map((actor) => [call.id, actor.key, call, actor] as const),
  );

  it.each(cases)('%s com %s', async (_id, _key, call, actor) => {
    const allowed = (MATRIX[call.id] as Role[]).includes(actor.role);
    const before = await call.state();
    const deniedBefore = (await deniedRowsOf(db, scenario.users[actor.key].profileId)).length;

    const response = await call.send(scenario.bearer(actor.key), actor.key);

    const denied = await deniedRowsOf(db, scenario.users[actor.key].profileId);
    if (allowed) {
      expect(response.status).toBe(call.allowedStatus);
      expect(denied).toHaveLength(deniedBefore);
      return;
    }
    expect(response.status).toBe(403);
    expect(errorOf(response).code).toBe('FORBIDDEN');
    expect(response.body).not.toHaveProperty('data');
    // Sem efeito colateral e com exatamente uma negativa auditada.
    expect(await call.state()).toEqual(before);
    expect(denied).toHaveLength(deniedBefore + 1);
    expect(denied.at(-1)).toMatchObject({
      entity_type: 'endpoint',
      entity_id: call.id,
      actor_role: actor.role,
      details: {
        code: 'FORBIDDEN',
        method: expect.any(String) as string,
        permission: ENDPOINTS[call.id].access,
      },
    });
  });

  it('o menu do frontend vem de E04, mas a rota oculta continua protegida (RF05)', async () => {
    const me = await request(app).get('/api/v1/me').set('Authorization', scenario.bearer('vi'));
    const permissions = (me.body as { data: { permissions: string[] } }).data.permissions;
    expect(permissions).not.toContain('audit_logs:read');

    const direct = await request(app)
      .get('/api/v1/admin/audit-logs?pageSize=100')
      .set('Authorization', scenario.bearer('vi'));
    expect(direct.status).toBe(403);
  });

  it('o novo perfil vale na requisição seguinte (RF07)', async () => {
    const target = scenario.users.geB;
    const asViewer = await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', scenario.bearer('geB'));
    expect(asViewer.status).toBe(403);

    const promote = await request(app)
      .patch(`/api/v1/admin/users/${target.profileId}`)
      .set('Authorization', scenario.bearer('sa'))
      .send({ role: 'superadmin' });
    expect(promote.status).toBe(200);

    const sameToken = await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', scenario.bearer('geB'));
    expect(sameToken.status).toBe(200);

    const demote = await request(app)
      .patch(`/api/v1/admin/users/${target.profileId}`)
      .set('Authorization', scenario.bearer('sa'))
      .send({ role: 'viewer', allSectors: false, sectorIds: [scenario.fx.sectorB] });
    expect(demote.status).toBe(200);
    const again = await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', scenario.bearer('geB'));
    expect(again.status).toBe(403);
  });
});
