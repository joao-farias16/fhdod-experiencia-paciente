/**
 * Ouvidoria — E35–E40 com PostgreSQL real (ET07):
 * T18: filtros, detalhe, transições válidas e inválidas, conclusão, updatedAt antigo e nota →
 * RN23; 422 e 409 nos inválidos. Lista e detalhe somente para OU e no escopo (RF44, RF45).
 * T19: E39 como OU e como GE; E40; E39 de novo → 200 no-store com auditoria; 403; 404 e evento
 * na linha do tempo.
 */
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../src/lib/prisma.js';
import { FakeSupabase } from '../fake-supabase.js';
import { errorOf } from '../helpers.js';
import {
  auditRowsFor,
  type AuthScenario,
  buildAuthApp,
  createAuthScenario,
  openConnections,
} from './auth-support.js';
import { type App, call, dataOf, submitResponse } from './et04-et06-support.js';
import type { Db } from './support.js';

let db: Db;
let prisma: PrismaClient;
let fake: FakeSupabase;
let scenario: AuthScenario;
let app: App;
/** Ouvidoria restrita ao setor B (criada neste teste). */
let ouB: { profileId: string; bearer: string };

interface Detail {
  id: string;
  protocol: string;
  status: string;
  priority: string;
  actionsTaken: string | null;
  resolvedAt: string | null;
  updatedAt: string;
  hasContact: boolean;
  description: string;
  allowedTransitions: string[];
  response: { npsScore: number; answers: { score: number; questionText: string }[] };
  timeline: {
    kind: string;
    fromValue: string | null;
    toValue: string | null;
    content: string | null;
    author: { fullName: string } | null;
  }[];
}
interface ListItem {
  id: string;
  protocol: string;
  excerpt: string;
  hasContact: boolean;
  status: string;
  sector: { id: string };
}

beforeAll(async () => {
  ({ db, prisma } = await openConnections());
  fake = new FakeSupabase();
  scenario = await createAuthScenario(db, fake);
  const { rows } = await db.query<{ id: string; auth_user_id: string }>(
    `INSERT INTO profiles (hospital_id, auth_user_id, full_name, email, role, all_sectors, must_change_password, created_by)
     VALUES ($1, gen_random_uuid(), 'Ouvidoria Fictícia B', $2, 'ombudsman', false, false, $3)
     RETURNING id, auth_user_id`,
    [
      scenario.fx.hospitalId,
      `oub.${Math.random().toString(36).slice(2, 8)}@example.com`,
      scenario.fx.adminId,
    ],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('Perfil OU B não criado.');
  await db.query('INSERT INTO profile_sectors (profile_id, sector_id) VALUES ($1, $2)', [
    row.id,
    scenario.fx.sectorB,
  ]);
  fake.register(row.auth_user_id, 'oub@example.com');
  ouB = { profileId: row.id, bearer: `Bearer ${fake.token(row.auth_user_id)}` };
});

beforeEach(() => {
  app = buildAuthApp(prisma, fake);
});

afterAll(async () => {
  await prisma.$disconnect();
  await db.end();
});

/** Avaliação (E02) e manifestação (E03) reais no setor informado. */
async function createManifestation(
  options: { sector?: 'A' | 'B'; contact?: object; description?: string; type?: string } = {},
): Promise<{ id: string; protocol: string }> {
  const versionId = options.sector === 'B' ? scenario.fx.versionB1 : scenario.fx.versionA2;
  const submitted = dataOf<{ responseId: string; manifestation: { token: string } }>(
    await submitResponse(app, {
      surveyVersionId: versionId,
      origin: 'link',
      npsScore: 3,
      answers: [
        {
          questionId: options.sector === 'B' ? await specificOfB() : scenario.fx.specificA,
          score: 2,
        },
      ],
    }),
  );
  const created = await request(app)
    .post('/api/v1/public/manifestations')
    .set('Idempotency-Key', crypto.randomUUID())
    .send({
      responseId: submitted.responseId,
      manifestationToken: submitted.manifestation.token,
      type: options.type ?? 'complaint',
      description:
        options.description ?? 'Demora no atendimento e falta de informação na recepção do setor.',
      ...(options.contact === undefined ? {} : { anonymous: false, contact: options.contact }),
    });
  expect(created.status).toBe(201);
  const { protocol } = dataOf<{ protocol: string }>(created);
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM manifestations WHERE protocol = $1',
    [protocol],
  );
  return { id: rows[0]?.id ?? '', protocol };
}

async function specificOfB(): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM questions WHERE survey_config_id = $1 AND type = 'scale_1_5'",
    [scenario.fx.surveyB],
  );
  return rows[0]?.id ?? '';
}

const ou = (method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: object) =>
  call(app, scenario, 'ou', method, `/ouvidoria${path}`, body);

async function detailOf(id: string): Promise<Detail> {
  const response = await ou('get', `/manifestations/${id}`);
  expect(response.status).toBe(200);
  return dataOf<Detail>(response);
}

const patch = async (id: string, body: object) => {
  const current = await detailOf(id);
  return ou('patch', `/manifestations/${id}`, { updatedAt: current.updatedAt, ...body });
};

describe('T18 — lista e filtros (E35)', () => {
  let withContact: { id: string; protocol: string };
  let sectorB: { id: string; protocol: string };

  beforeAll(async () => {
    app = buildAuthApp(prisma, fake);
    withContact = await createManifestation({
      description: `Texto longo ${'x'.repeat(200)}`,
      contact: { fullName: 'Contato Fictício 950', email: 'c950@example.com', consent: true },
    });
    sectorB = await createManifestation({ sector: 'B', type: 'suggestion' });
  });

  it('OU global vê os dois setores, com trecho de 120 caracteres e só a existência do contato', async () => {
    const response = await ou('get', '/manifestations?pageSize=100');
    expect(response.status).toBe(200);
    const items = dataOf<ListItem[]>(response);
    const found = items.find((item) => item.id === withContact.id);
    expect(found?.excerpt).toHaveLength(120);
    expect(found?.hasContact).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain('c950@example.com');
    expect(JSON.stringify(response.body)).not.toContain('Contato Fictício 950');
    expect(items.some((item) => item.id === sectorB.id)).toBe(true);
    expect((response.body as { meta: { total: number } }).meta.total).toBe(items.length);
  });

  it('filtros por protocolo, contato, tipo, status, setor e período', async () => {
    const byProtocol = dataOf<ListItem[]>(
      await ou('get', `/manifestations?protocol=${withContact.protocol.toLowerCase()}`),
    );
    expect(byProtocol.map((item) => item.id)).toEqual([withContact.id]);

    const contacts = dataOf<ListItem[]>(
      await ou('get', '/manifestations?hasContact=true&pageSize=100'),
    );
    expect(contacts.every((item) => item.hasContact)).toBe(true);
    expect(contacts.map((item) => item.id)).toContain(withContact.id);

    const suggestions = dataOf<ListItem[]>(
      await ou('get', `/manifestations?type=suggestion&sectorIds=${scenario.fx.sectorB}`),
    );
    expect(suggestions.map((item) => item.id)).toEqual([sectorB.id]);

    const received = dataOf<ListItem[]>(
      await ou('get', '/manifestations?status=received,in_review&pageSize=100'),
    );
    expect(received.every((item) => ['received', 'in_review'].includes(item.status))).toBe(true);

    const past = dataOf<ListItem[]>(
      await ou('get', '/manifestations?from=2020-01-01&to=2020-01-31'),
    );
    expect(past).toEqual([]);
  });

  it('filtros inválidos → 400 (período > 366 dias, from > to, status desconhecido)', async () => {
    for (const query of [
      'from=2025-01-01&to=2026-01-03',
      'from=2026-02-01&to=2026-01-01',
      'status=aberta',
      'protocol=123',
      'campo=1',
    ]) {
      expect((await ou('get', `/manifestations?${query}`)).status).toBe(400);
    }
  });

  it('OU restrita ao setor B: só o setor B; filtro do setor A → 403; detalhe do setor A → 404', async () => {
    const own = await request(app)
      .get('/api/v1/ouvidoria/manifestations?pageSize=100')
      .set('Authorization', ouB.bearer);
    expect(dataOf<ListItem[]>(own).every((item) => item.sector.id === scenario.fx.sectorB)).toBe(
      true,
    );

    const filter = await request(app)
      .get(`/api/v1/ouvidoria/manifestations?sectorIds=${scenario.fx.sectorA}`)
      .set('Authorization', ouB.bearer);
    expect(filter.status).toBe(403);
    expect(errorOf(filter).code).toBe('SECTOR_OUT_OF_SCOPE');

    const other = await request(app)
      .get(`/api/v1/ouvidoria/manifestations/${withContact.id}`)
      .set('Authorization', ouB.bearer);
    expect(other.status).toBe(404);
  });

  it('SA, AS, GE e VI → 403 FORBIDDEN em E35–E38 (RF44: somente OU)', async () => {
    for (const key of ['sa', 'as', 'ge', 'vi'] as const) {
      expect((await call(app, scenario, key, 'get', '/ouvidoria/manifestations')).status).toBe(403);
      expect(
        (await call(app, scenario, key, 'get', `/ouvidoria/manifestations/${withContact.id}`))
          .status,
      ).toBe(403);
      expect(
        (
          await call(
            app,
            scenario,
            key,
            'post',
            `/ouvidoria/manifestations/${withContact.id}/notes`,
            { content: 'x' },
          )
        ).status,
      ).toBe(403);
    }
  });
});

describe('T18 — detalhe, transições (RN23), concorrência e notas (E36–E38)', () => {
  it('detalhe com texto, resposta vinculada e linha do tempo, sem contato; consulta auditada', async () => {
    const created = await createManifestation({
      contact: { fullName: 'Contato Fictício 951', phone: '51900000951', consent: true },
    });
    const before = (await auditRowsFor(db, created.id, 'MANIFESTATION_VIEWED')).length;
    const detail = await detailOf(created.id);
    expect(detail.status).toBe('received');
    expect(detail.hasContact).toBe(true);
    expect(detail.response.npsScore).toBe(3);
    expect(detail.response.answers).toEqual([expect.objectContaining({ score: 2 })]);
    expect(detail.timeline.map((event) => event.kind)).toEqual(['created']);
    expect(detail.allowedTransitions).toEqual(['in_review', 'archived']);
    expect(JSON.stringify(detail)).not.toContain('51900000951');
    expect(JSON.stringify(detail)).not.toContain('Contato Fictício 951');

    const audit = await auditRowsFor(db, created.id, 'MANIFESTATION_VIEWED');
    expect(audit).toHaveLength(before + 1);
    expect(audit.at(-1)).toMatchObject({
      entity_type: 'manifestation',
      actor_role: 'ombudsman',
      details: {},
    });
  });

  it('fluxo válido: received → in_review → forwarded → resolved → in_review (reabertura)', async () => {
    const { id } = await createManifestation();
    expect((await patch(id, { status: 'in_review', priority: 'high' })).status).toBe(200);
    expect((await patch(id, { status: 'forwarded' })).status).toBe(200);

    const resolved = await patch(id, {
      status: 'resolved',
      actionsTaken: 'Equipe orientada e fluxo da recepção revisado.',
    });
    expect(resolved.status).toBe(200);
    const done = dataOf<Detail>(resolved);
    expect(done.status).toBe('resolved');
    expect(done.resolvedAt).not.toBeNull();

    const reopened = dataOf<Detail>(await patch(id, { status: 'in_review' }));
    expect(reopened.resolvedAt).toBeNull();
    expect(reopened.actionsTaken).toBe('Equipe orientada e fluxo da recepção revisado.');

    // Linha do tempo completa e ordenada, com autor nos eventos da Ouvidoria.
    expect(reopened.timeline.map((event) => [event.kind, event.fromValue, event.toValue])).toEqual([
      ['created', null, 'received'],
      ['priority_changed', 'medium', 'high'],
      ['status_changed', 'received', 'in_review'],
      ['status_changed', 'in_review', 'forwarded'],
      ['actions_updated', null, null],
      ['status_changed', 'forwarded', 'resolved'],
      ['status_changed', 'resolved', 'in_review'],
    ]);
    expect(reopened.timeline.slice(1).every((event) => event.author !== null)).toBe(true);
    expect((await auditRowsFor(db, id, 'MANIFESTATION_UPDATED')).length).toBe(4);
  });

  it('transições inválidas → 422 INVALID_STATUS_TRANSITION, sem alteração', async () => {
    const { id } = await createManifestation();
    for (const status of ['forwarded', 'resolved', 'received']) {
      const response = await patch(id, {
        status,
        actionsTaken: 'Providência suficiente para concluir.',
      });
      expect(response.status).toBe(422);
      expect(errorOf(response).code).toBe('INVALID_STATUS_TRANSITION');
    }
    expect((await detailOf(id)).status).toBe('received');
  });

  it('concluir sem providências de 10+ caracteres → 422 ACTIONS_REQUIRED', async () => {
    const { id } = await createManifestation();
    await patch(id, { status: 'in_review' });
    const without = await patch(id, { status: 'resolved' });
    expect(without.status).toBe(422);
    expect(errorOf(without).code).toBe('ACTIONS_REQUIRED');
    const short = await patch(id, { status: 'resolved', actionsTaken: 'Feito.' });
    expect(short.status).toBe(422);
    expect(errorOf(short).code).toBe('ACTIONS_REQUIRED');
  });

  it('arquivar exige nota com o motivo (422 NOTE_REQUIRED); com nota → evento note e status', async () => {
    const { id } = await createManifestation();
    const without = await patch(id, { status: 'archived' });
    expect(without.status).toBe(422);
    expect(errorOf(without).code).toBe('NOTE_REQUIRED');
    const archived = dataOf<Detail>(
      await patch(id, { status: 'archived', note: 'Sem elementos suficientes para apuração.' }),
    );
    expect(archived.status).toBe('archived');
    expect(archived.timeline.slice(-2).map((event) => event.kind)).toEqual([
      'note',
      'status_changed',
    ]);
  });

  it('updatedAt antigo → 409 STALE_RESOURCE; patch vazio → 400', async () => {
    const { id } = await createManifestation();
    const old = (await detailOf(id)).updatedAt;
    expect(
      (await ou('patch', `/manifestations/${id}`, { updatedAt: old, priority: 'low' })).status,
    ).toBe(200);
    const stale = await ou('patch', `/manifestations/${id}`, { updatedAt: old, priority: 'high' });
    expect(stale.status).toBe(409);
    expect(errorOf(stale).code).toBe('STALE_RESOURCE');
    expect((await detailOf(id)).priority).toBe('low');

    const empty = await ou('patch', `/manifestations/${id}`, {
      updatedAt: (await detailOf(id)).updatedAt,
    });
    expect(empty.status).toBe(400);
  });

  it('nota interna (E38): 201 com autor e data; vazia ou > 2.000 → 400; auditada', async () => {
    const { id } = await createManifestation();
    const response = await ou('post', `/manifestations/${id}/notes`, {
      content: 'Contato com a chefia.',
    });
    expect(response.status).toBe(201);
    expect(
      dataOf<{ kind: string; author: { fullName: string }; createdAt: string }>(response),
    ).toMatchObject({
      kind: 'note',
      author: { fullName: expect.any(String) as string },
      createdAt: expect.any(String) as string,
    });
    expect((await ou('post', `/manifestations/${id}/notes`, { content: '   ' })).status).toBe(400);
    expect(
      (await ou('post', `/manifestations/${id}/notes`, { content: 'x'.repeat(2001) })).status,
    ).toBe(400);
    expect(await auditRowsFor(db, id, 'MANIFESTATION_NOTE_ADDED')).toHaveLength(1);
  });

  it('manifestação inexistente → 404 em E36, E37 e E38', async () => {
    const missing = crypto.randomUUID();
    expect((await ou('get', `/manifestations/${missing}`)).status).toBe(404);
    expect(
      (
        await ou('patch', `/manifestations/${missing}`, {
          updatedAt: new Date().toISOString(),
          priority: 'low',
        })
      ).status,
    ).toBe(404);
    expect(
      (await ou('post', `/manifestations/${missing}/notes`, { content: 'Nota.' })).status,
    ).toBe(404);
  });
});

describe('T19 — consulta e eliminação de contato (E39, E40)', () => {
  it('OU → 200 no-store com auditoria a cada consulta; GE → 403', async () => {
    const { id } = await createManifestation({
      contact: {
        fullName: 'Contato Fictício 960',
        email: 'c960@example.com',
        phone: '5190000960',
        consent: true,
      },
    });
    const first = await ou('get', `/manifestations/${id}/contact`);
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(
      dataOf<{ fullName: string; email: string; phone: string; purposeText: string }>(first),
    ).toMatchObject({
      fullName: 'Contato Fictício 960',
      email: 'c960@example.com',
      phone: '5190000960',
      purposeText: expect.stringContaining('somente pela Ouvidoria') as string,
    });
    await ou('get', `/manifestations/${id}/contact`);
    const views = await auditRowsFor(db, id, 'MANIFESTATION_CONTACT_VIEWED');
    expect(views).toHaveLength(2);
    // Auditoria sem dados pessoais (Seção 10).
    expect(JSON.stringify(views)).not.toContain('c960@example.com');

    const ge = await call(app, scenario, 'ge', 'get', `/ouvidoria/manifestations/${id}/contact`);
    expect(ge.status).toBe(403);
    expect(errorOf(ge).code).toBe('FORBIDDEN');
    expect(await auditRowsFor(db, id, 'MANIFESTATION_CONTACT_VIEWED')).toHaveLength(2);
  });

  it('E40 → 204; E39 de novo → 404; evento contact_deleted com o motivo; manifestação mantida', async () => {
    const { id, protocol } = await createManifestation({
      contact: { fullName: 'Contato Fictício 961', email: 'c961@example.com', consent: true },
    });
    const invalid = await ou('delete', `/manifestations/${id}/contact`, { reason: 'porque sim' });
    expect(invalid.status).toBe(400);

    const deleted = await ou('delete', `/manifestations/${id}/contact`, {
      reason: 'holder_request',
    });
    expect(deleted.status).toBe(204);
    expect((await ou('get', `/manifestations/${id}/contact`)).status).toBe(404);
    expect((await ou('delete', `/manifestations/${id}/contact`, { reason: 'other' })).status).toBe(
      404,
    );

    const detail = await detailOf(id);
    expect(detail.protocol).toBe(protocol);
    expect(detail.hasContact).toBe(false);
    expect(detail.timeline.at(-1)).toMatchObject({
      kind: 'contact_deleted',
      toValue: 'holder_request',
    });
    const { rows } = await db.query(
      'SELECT 1 FROM manifestation_contacts WHERE manifestation_id = $1',
      [id],
    );
    expect(rows).toHaveLength(0);
    expect(await auditRowsFor(db, id, 'MANIFESTATION_CONTACT_DELETED')).toEqual([
      expect.objectContaining({ details: { reason: 'holder_request' } }),
    ]);
  });

  it('manifestação anônima → E39 404; GE → E40 403', async () => {
    const { id } = await createManifestation();
    expect((await ou('get', `/manifestations/${id}/contact`)).status).toBe(404);
    const ge = await call(
      app,
      scenario,
      'ge',
      'delete',
      `/ouvidoria/manifestations/${id}/contact`,
      {
        reason: 'other',
      },
    );
    expect(ge.status).toBe(403);
  });
});
