/**
 * Manifestação pública — E03 com PostgreSQL real (ET07):
 * T07 (parte de API): NPS 3 e NPS 8 com específica 2 → lowScore e protocolo após o envio; NPS 10 →
 * sem nota baixa e nenhuma manifestação criada sem a ação do respondente (RN04, RN05).
 * T08: manifestação na opção padrão → is_anonymous sem contato; anonymous: true com contato → 400.
 * T09: contato só com e-mail ou só com telefone → 201; nenhum, sem aceite ou telefone de 9 dígitos
 * → 400.
 * T10 (E03): mesma chave e corpo → mesmo protocolo (200); corpo diferente → 409; 5 envios
 * concorrentes → uma linha. RF41: segunda manifestação para a resposta → 409; token expirado → 422;
 * token de outra resposta → 403.
 */
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../src/lib/prisma.js';
import { FakeSupabase } from '../fake-supabase.js';
import { errorOf } from '../helpers.js';
import {
  type AuthScenario,
  buildAuthApp,
  createAuthScenario,
  openConnections,
} from './auth-support.js';
import {
  adjustableClock,
  type App,
  countRows,
  dataOf,
  submitResponse,
} from './et04-et06-support.js';
import type { Db } from './support.js';

let db: Db;
let prisma: PrismaClient;
let fake: FakeSupabase;
let scenario: AuthScenario;
let app: App;
const clock = adjustableClock();

interface Submitted {
  responseId: string;
  lowScore: boolean;
  manifestation: { token: string; expiresAt: string };
}
interface Created {
  protocol: string;
  receivedAt: string;
}

beforeAll(async () => {
  ({ db, prisma } = await openConnections());
  fake = new FakeSupabase();
  scenario = await createAuthScenario(db, fake);
});

// Limites por IP (E02 30/min, E03 10/min) ficam na memória de cada aplicação: uma por teste.
beforeEach(() => {
  app = buildAuthApp(prisma, fake, clock);
});

afterAll(async () => {
  await prisma.$disconnect();
  await db.end();
});

/** Avaliação real pelo E02 na versão vigente (v2) do setor A. */
async function evaluate(npsScore: number, specific?: number): Promise<Submitted> {
  clock.set(new Date());
  const response = await submitResponse(app, {
    surveyVersionId: scenario.fx.versionA2,
    origin: 'link',
    npsScore,
    answers: specific === undefined ? [] : [{ questionId: scenario.fx.specificA, score: specific }],
  });
  expect(response.status).toBe(201);
  return dataOf<Submitted>(response);
}

function manifest(body: object, key: string = crypto.randomUUID()) {
  return request(app).post('/api/v1/public/manifestations').set('Idempotency-Key', key).send(body);
}

const bodyFor = (submitted: Submitted, extra: object = {}) => ({
  responseId: submitted.responseId,
  manifestationToken: submitted.manifestation.token,
  type: 'complaint',
  description: 'A espera na recepção passou de duas horas sem informação.',
  ...extra,
});

const manifestationsOf = (responseId: string) =>
  countRows(db, 'SELECT 1 FROM manifestations WHERE response_id = $1', [responseId]);
const contactsOf = (responseId: string) =>
  countRows(
    db,
    `SELECT 1 FROM manifestation_contacts c JOIN manifestations m ON m.id = c.manifestation_id
     WHERE m.response_id = $1`,
    [responseId],
  );

describe('T07 — manifestação após nota baixa (API)', () => {
  it('NPS 3 → nota baixa; a manifestação devolve protocolo FHD-AAAA-NNNNNN e status received', async () => {
    const submitted = await evaluate(3);
    expect(submitted.lowScore).toBe(true);
    const response = await manifest(bodyFor(submitted));
    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const created = dataOf<Created>(response);
    expect(created.protocol).toMatch(/^FHD-\d{4}-\d{6}$/);

    const { rows } = await db.query<{
      status: string;
      triggered_by_low_score: boolean;
      is_anonymous: boolean;
      sector_id: string;
    }>(
      'SELECT status, triggered_by_low_score, is_anonymous, sector_id FROM manifestations WHERE protocol = $1',
      [created.protocol],
    );
    expect(rows).toEqual([
      {
        status: 'received',
        triggered_by_low_score: true,
        is_anonymous: true,
        sector_id: scenario.fx.sectorA,
      },
    ]);
    // Linha do tempo começa com o evento "created" sem autor.
    const events = await db.query<{ kind: string; author_id: string | null; to_value: string }>(
      `SELECT n.kind, n.author_id, n.to_value FROM manifestation_notes n
       JOIN manifestations m ON m.id = n.manifestation_id WHERE m.protocol = $1`,
      [created.protocol],
    );
    expect(events.rows).toEqual([{ kind: 'created', author_id: null, to_value: 'received' }]);
  });

  it('NPS 8 com específica 2 → nota baixa (RN05); NPS 10 → sem nota baixa e nada criado', async () => {
    const withSpecific = await evaluate(8, 2);
    expect(withSpecific.lowScore).toBe(true);
    expect((await manifest(bodyFor(withSpecific, { type: 'suggestion' }))).status).toBe(201);

    const high = await evaluate(10);
    expect(high.lowScore).toBe(false);
    // RN04: a avaliação não depende da manifestação; nada é criado sem o envio do E03.
    expect(await manifestationsOf(high.responseId)).toBe(0);
  });

  it('F05: elogio sem nota baixa também é aceito, com triggered_by_low_score = false', async () => {
    const high = await evaluate(10);
    const response = await manifest(
      bodyFor(high, { type: 'compliment', description: 'Equipe muito atenciosa e gentil.' }),
    );
    expect(response.status).toBe(201);
    const { rows } = await db.query<{ triggered_by_low_score: boolean; type: string }>(
      'SELECT triggered_by_low_score, type FROM manifestations WHERE response_id = $1',
      [high.responseId],
    );
    expect(rows).toEqual([{ triggered_by_low_score: false, type: 'compliment' }]);
  });

  it('descrição fora de 10 a 2.000 caracteres ou tipo inválido → 400 sem gravação', async () => {
    const submitted = await evaluate(2);
    for (const extra of [
      { description: 'curta' },
      { description: '          espaços     ' },
      { description: 'x'.repeat(2001) },
      { type: 'denuncia' },
      { extra: 'campo desconhecido' },
    ]) {
      const response = await manifest(bodyFor(submitted, extra));
      expect(response.status).toBe(400);
      expect(errorOf(response).code).toBe('VALIDATION_ERROR');
    }
    expect(await manifestationsOf(submitted.responseId)).toBe(0);
  });
});

describe('T08 — avaliação e manifestação anônimas', () => {
  it('opção padrão (sem "anonymous") → is_anonymous e nenhuma linha em manifestation_contacts', async () => {
    const submitted = await evaluate(4);
    expect((await manifest(bodyFor(submitted))).status).toBe(201);
    const { rows } = await db.query<{ is_anonymous: boolean }>(
      'SELECT is_anonymous FROM manifestations WHERE response_id = $1',
      [submitted.responseId],
    );
    expect(rows).toEqual([{ is_anonymous: true }]);
    expect(await contactsOf(submitted.responseId)).toBe(0);
  });

  it('anonymous: true com contato → 400 e nada gravado', async () => {
    const submitted = await evaluate(4);
    const response = await manifest(
      bodyFor(submitted, {
        anonymous: true,
        contact: { fullName: 'Contato Fictício 900', email: 'c900@example.com', consent: true },
      }),
    );
    expect(response.status).toBe(400);
    expect(errorOf(response).details).toContainEqual(expect.objectContaining({ field: 'contact' }));
    expect(await manifestationsOf(submitted.responseId)).toBe(0);
  });
});

describe('T09 — contato opcional', () => {
  const contact = (extra: object) => ({
    anonymous: false,
    contact: { fullName: 'Contato Fictício 901', consent: true, ...extra },
  });

  it('só e-mail → 201 com contato segregado e aceite registrado (finalidade v1)', async () => {
    const submitted = await evaluate(5);
    expect(
      (await manifest(bodyFor(submitted, contact({ email: 'C901@Example.com' })))).status,
    ).toBe(201);
    const { rows } = await db.query<{
      email: string;
      phone: string | null;
      purpose_text_version: string;
      is_anonymous: boolean;
    }>(
      `SELECT c.email, c.phone, c.purpose_text_version, m.is_anonymous
       FROM manifestation_contacts c JOIN manifestations m ON m.id = c.manifestation_id
       WHERE m.response_id = $1`,
      [submitted.responseId],
    );
    expect(rows).toEqual([
      { email: 'c901@example.com', phone: null, purpose_text_version: 'v1', is_anonymous: false },
    ]);
  });

  it('só telefone (com máscara) → 201, gravado somente com dígitos', async () => {
    const submitted = await evaluate(5);
    expect((await manifest(bodyFor(submitted, contact({ phone: '(51) 90000-0901' })))).status).toBe(
      201,
    );
    const { rows } = await db.query<{ phone: string; email: string | null }>(
      `SELECT c.phone, c.email FROM manifestation_contacts c
       JOIN manifestations m ON m.id = c.manifestation_id WHERE m.response_id = $1`,
      [submitted.responseId],
    );
    expect(rows).toEqual([{ phone: '51900000901', email: null }]);
  });

  it.each([
    ['nem telefone nem e-mail', contact({})],
    [
      'sem aceite',
      {
        anonymous: false,
        contact: { fullName: 'Contato Fictício 902', email: 'c902@example.com' },
      },
    ],
    ['aceite false', contact({ email: 'c902@example.com', consent: false })],
    ['telefone de 9 dígitos', contact({ phone: '519000009' })],
    ['e-mail inválido', contact({ email: 'sem-arroba' })],
    ['não anônima sem contato', { anonymous: false }],
  ])('%s → 400 sem gravação', async (_case, extra) => {
    const submitted = await evaluate(5);
    const response = await manifest(bodyFor(submitted, extra));
    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('VALIDATION_ERROR');
    expect(await manifestationsOf(submitted.responseId)).toBe(0);
  });
});

describe('T10 e RF41 — idempotência, uso único e validade do token', () => {
  it('mesma chave e corpo → mesmo protocolo (200, Idempotent-Replayed); corpo diferente → 409', async () => {
    const submitted = await evaluate(1);
    const key = crypto.randomUUID();
    const first = await manifest(bodyFor(submitted), key);
    const again = await manifest(bodyFor(submitted), key);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(dataOf<Created>(again)).toEqual(dataOf<Created>(first));

    const changed = await manifest(bodyFor(submitted, { type: 'suggestion' }), key);
    expect(changed.status).toBe(409);
    expect(errorOf(changed).code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await manifestationsOf(submitted.responseId)).toBe(1);
  });

  it('5 envios concorrentes com a mesma chave → uma linha e o mesmo protocolo', async () => {
    const submitted = await evaluate(0);
    const key = crypto.randomUUID();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => manifest(bodyFor(submitted), key)),
    );
    expect(results.map((result) => result.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(results.map((result) => dataOf<Created>(result).protocol)).size).toBe(1);
    expect(await manifestationsOf(submitted.responseId)).toBe(1);
  });

  it('segunda manifestação para a mesma resposta (nova chave) → 409', async () => {
    const submitted = await evaluate(2);
    expect((await manifest(bodyFor(submitted))).status).toBe(201);
    const second = await manifest(bodyFor(submitted, { description: 'Outra descrição qualquer.' }));
    expect(second.status).toBe(409);
    expect(errorOf(second).code).toBe('MANIFESTATION_ALREADY_EXISTS');
    expect(await manifestationsOf(submitted.responseId)).toBe(1);
  });

  it('token expirado (61 min depois) → 422; token da resposta preservado sem uso', async () => {
    const submitted = await evaluate(3);
    clock.set(new Date(Date.parse(submitted.manifestation.expiresAt) + 60_000));
    const response = await manifest(bodyFor(submitted));
    expect(response.status).toBe(422);
    expect(errorOf(response).code).toBe('MANIFESTATION_TOKEN_EXPIRED');
    expect(await manifestationsOf(submitted.responseId)).toBe(0);
    const { rows } = await db.query<{ used: Date | null }>(
      'SELECT manifestation_token_used_at AS used FROM responses WHERE id = $1',
      [submitted.responseId],
    );
    expect(rows[0]?.used).toBeNull();
  });

  it('token de outra resposta, adulterado ou de resposta inexistente → 403 sem gravação', async () => {
    const first = await evaluate(3);
    const second = await evaluate(3);
    for (const body of [
      bodyFor(first, { manifestationToken: second.manifestation.token }),
      bodyFor(first, { manifestationToken: `${first.manifestation.token.slice(0, -2)}xx` }),
      bodyFor(first, { responseId: crypto.randomUUID() }),
    ]) {
      const response = await manifest(body);
      expect(response.status).toBe(403);
      expect(errorOf(response).code).toBe('MANIFESTATION_TOKEN_INVALID');
    }
    expect(await manifestationsOf(first.responseId)).toBe(0);
  });

  it('sem Idempotency-Key ou fora do formato UUID v4 → 400', async () => {
    const submitted = await evaluate(3);
    const missing = await request(app)
      .post('/api/v1/public/manifestations')
      .send(bodyFor(submitted));
    expect(missing.status).toBe(400);
    expect(errorOf(missing).code).toBe('IDEMPOTENCY_KEY_INVALID');
    expect((await manifest(bodyFor(submitted), 'nao-e-uuid')).status).toBe(400);
  });

  it('T41: texto com <script> e aspas SQL é gravado literalmente', async () => {
    const submitted = await evaluate(3);
    const description = "<script>alert('x')</script> ' OR 1=1 --";
    expect((await manifest(bodyFor(submitted, { description }))).status).toBe(201);
    const { rows } = await db.query<{ description: string }>(
      'SELECT description FROM manifestations WHERE response_id = $1',
      [submitted.responseId],
    );
    expect(rows[0]?.description).toBe(description);
  });
});
