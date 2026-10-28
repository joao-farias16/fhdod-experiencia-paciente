/**
 * Dashboard — E28–E33 com PostgreSQL real (ET08):
 * T05: E28 com os conjuntos de referência (4,3,3) → 10,0 e (1,15,0) → 6,3, iguais a computeNps.
 * T11 (parte de API): nova resposta (E02) → E28 seguinte mostra total + 1 e NPS recalculado, sem
 * cache no servidor (RF61).
 * T36: E28, E29, E32 e E33 com dados de referência, comparação, filtro vazio e VI com 4 respostas
 * → valores esperados; nulos; suprimido.
 * T37: limites 00:00 e 23:59, 367 dias, from > to, filtros de turno e equipe → inclusivos; 400;
 * só atribuídas.
 *
 * Conjunto de referência (datas locais, America/Sao_Paulo = UTC−3), período P = 10 a 16/09/2026:
 * - setor A (v2): 4 promotores, 3 passivos, 3 detratores → NPS 10,0; 6 notas da pergunta específica
 *   [5, 4, 4, 3, 2, 1]; 2 respostas atribuídas à equipe A1 (manhã) e 1 à equipe A2 (noite);
 * - setor B (v1): 1 promotor e 15 passivos → NPS 6,3;
 * - total 26: 5 promotores, 18 passivos e 3 detratores → NPS 7,7; manifestações: 1 elogio,
 *   1 reclamação (setor A) e 1 sugestão (setor B);
 * - período anterior (03 a 09/09): setor A com notas 9 e 0 → NPS 0,0.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../src/lib/prisma.js';
import { computeNps } from '../../src/services/nps.js';
import { FakeSupabase } from '../fake-supabase.js';
import { errorOf } from '../helpers.js';
import {
  type AuthScenario,
  buildAuthApp,
  createAuthScenario,
  openConnections,
  type UserKey,
} from './auth-support.js';
import { type App, dataOf, submitResponse } from './et04-et06-support.js';
import { type Db, HASH } from './support.js';

let db: Db;
let prisma: PrismaClient;
let fake: FakeSupabase;
let scenario: AuthScenario;
let app: App;

const P = 'from=2026-09-10&to=2026-09-16';

interface Indicator {
  n: number | null;
  nps: number | null;
  promoters: number | null;
  passives: number | null;
  detractors: number | null;
  promotersPercent: number | null;
  detractorsPercent: number | null;
  suppressed: boolean;
}
interface Summary {
  period: { from: string; to: string };
  indicators: Indicator;
  distribution: { score: number; count: number; percent: number | null }[] | null;
  manifestations: {
    total: number | null;
    compliment: number | null;
    complaint: number | null;
    suggestion: number | null;
    suppressed: boolean;
  };
  coverage: { total: number | null; attributed: number | null; percent: number | null };
  comparison: {
    period: { from: string; to: string };
    indicators: Indicator;
    delta: number | null;
    noPreviousData: boolean;
  } | null;
}

interface Shift {
  id: string;
  teamId: string;
  period: 'morning' | 'night';
}

async function insertShift(
  teamId: string,
  period: Shift['period'],
  startsAt: string,
  endsAt: string,
): Promise<Shift> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO shifts (sector_id, team_id, period, starts_at, ends_at, source, created_by)
     VALUES ($1, $2, $3, $4, $5, 'manual', $6) RETURNING id`,
    [scenario.fx.sectorA, teamId, period, startsAt, endsAt, scenario.fx.adminId],
  );
  return { id: rows[0]?.id ?? '', teamId, period };
}

/** Resposta direta no banco (link sem atribuição, ou QR Code atribuído ao turno informado). */
async function addResponse(values: {
  sector: 'A' | 'B';
  nps: number;
  at: string;
  shift?: Shift;
  specific?: number;
}): Promise<string> {
  const versionId = values.sector === 'A' ? scenario.fx.versionA2 : scenario.fx.versionB1;
  const sectorId = values.sector === 'A' ? scenario.fx.sectorA : scenario.fx.sectorB;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO responses (survey_version_id, sector_id, origin, nps_score, low_score, submitted_at,
       attribution_status, shift_id, team_id, shift_period, idempotency_key, request_hash,
       manifestation_token_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8, $9, $10, gen_random_uuid(), $11,
       $6::timestamptz + interval '60 minutes')
     RETURNING id`,
    [
      versionId,
      sectorId,
      values.shift === undefined ? 'link' : 'qr_code',
      values.nps,
      values.nps <= 6 || (values.specific !== undefined && values.specific <= 2),
      values.at,
      values.shift === undefined ? 'not_qr_origin' : 'attributed',
      values.shift?.id ?? null,
      values.shift?.teamId ?? null,
      values.shift?.period ?? null,
      HASH,
    ],
  );
  const id = rows[0]?.id ?? '';
  if (values.specific !== undefined) {
    await db.query(
      `INSERT INTO response_answers (response_id, survey_version_id, survey_version_question_id, question_type, score)
       VALUES ($1, $2, $3, 'scale_1_5', $4)`,
      [id, versionId, scenario.fx.svqA2Specific, values.specific],
    );
  }
  return id;
}

async function addManifestation(responseId: string, sector: 'A' | 'B', type: string, at: string) {
  await db.query(
    `INSERT INTO manifestations (response_id, sector_id, type, description, is_anonymous,
       triggered_by_low_score, received_at, idempotency_key, request_hash)
     VALUES ($1, $2, $3, 'Descrição fictícia com mais de dez caracteres.', true, false, $4,
       gen_random_uuid(), $5)`,
    [responseId, sector === 'A' ? scenario.fx.sectorA : scenario.fx.sectorB, type, at, HASH],
  );
}

beforeAll(async () => {
  ({ db, prisma } = await openConnections());
  fake = new FakeSupabase();
  scenario = await createAuthScenario(db, fake);
  app = buildAuthApp(prisma, fake);

  // Turnos de 12/09 07:00–13:00 (A1, manhã) e 13/09 19:00–07:00 (A2, noite), horários locais.
  const morning = await insertShift(
    scenario.fx.teamA1,
    'morning',
    '2026-09-12T10:00:00Z',
    '2026-09-12T16:00:00Z',
  );
  const night = await insertShift(
    scenario.fx.teamA2,
    'night',
    '2026-09-13T22:00:00Z',
    '2026-09-14T10:00:00Z',
  );

  // Setor A: 4 promotores, 3 passivos e 3 detratores.
  const a = [
    { nps: 10, at: '2026-09-10T13:00:00Z', specific: 5 },
    { nps: 9, at: '2026-09-11T13:00:00Z', specific: 4 },
    { nps: 9, at: '2026-09-12T11:00:00Z', specific: 4, shift: morning },
    { nps: 10, at: '2026-09-12T12:00:00Z', specific: 3, shift: morning },
    { nps: 8, at: '2026-09-13T23:00:00Z', specific: 2, shift: night },
    { nps: 7, at: '2026-09-14T13:00:00Z', specific: 1 },
    { nps: 7, at: '2026-09-15T13:00:00Z' },
    { nps: 6, at: '2026-09-15T14:00:00Z' },
    { nps: 3, at: '2026-09-16T13:00:00Z' },
    { nps: 0, at: '2026-09-16T14:00:00Z' },
  ];
  const aIds: string[] = [];
  for (const item of a) aIds.push(await addResponse({ sector: 'A', ...item }));
  // Setor B: 1 promotor e 15 passivos.
  const bIds = [await addResponse({ sector: 'B', nps: 9, at: '2026-09-10T15:00:00Z' })];
  for (let index = 0; index < 15; index += 1) {
    bIds.push(
      await addResponse({
        sector: 'B',
        nps: index % 2 === 0 ? 7 : 8,
        at: `2026-09-1${index % 7}T16:00:00Z`,
      }),
    );
  }
  await addManifestation(aIds[8] ?? '', 'A', 'complaint', '2026-09-16T13:10:00Z');
  await addManifestation(aIds[0] ?? '', 'A', 'compliment', '2026-09-10T13:10:00Z');
  await addManifestation(bIds[1] ?? '', 'B', 'suggestion', '2026-09-10T16:10:00Z');

  // Período anterior (03 a 09/09): setor A com 9 e 0.
  await addResponse({ sector: 'A', nps: 9, at: '2026-09-05T13:00:00Z' });
  await addResponse({ sector: 'A', nps: 0, at: '2026-09-09T13:00:00Z' });

  // T37: limites do dia local 20/09 no setor B (00:00 e 23:59:59 dentro; vizinhos fora).
  for (const at of [
    '2026-09-20T02:59:59Z',
    '2026-09-20T03:00:00Z',
    '2026-09-21T02:59:59Z',
    '2026-09-21T03:00:00Z',
  ]) {
    await addResponse({ sector: 'B', nps: 10, at });
  }
  // RN21: 4 respostas no setor A em 25/09 e uma quinta em 26/09.
  for (const hour of [12, 13, 14, 15]) {
    await addResponse({ sector: 'A', nps: 9, at: `2026-09-25T${hour}:00:00Z` });
  }
  await addResponse({ sector: 'A', nps: 5, at: '2026-09-26T13:00:00Z' });
});

afterAll(async () => {
  await prisma.$disconnect();
  await db.end();
});

const get = (path: string, key: UserKey = 'ge') =>
  request(app).get(`/api/v1/dashboard${path}`).set('Authorization', scenario.bearer(key));

async function summary(query: string, key: UserKey = 'ge'): Promise<Summary> {
  const response = await get(`/summary?${query}`, key);
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  return dataOf<Summary>(response);
}

describe('T05 — NPS do E28 igual a computeNps nos conjuntos de referência', () => {
  it('(4,3,3) → 10,0 no setor A; (1,15,0) → 6,3 no setor B', async () => {
    const a = await summary(`${P}&sectorIds=${scenario.fx.sectorA}`);
    expect(a.indicators).toMatchObject({
      n: 10,
      promoters: 4,
      passives: 3,
      detractors: 3,
      nps: 10,
    });
    expect(a.indicators.nps).toBe(computeNps({ promoters: 4, passives: 3, detractors: 3 }));

    const b = await summary(`${P}&sectorIds=${scenario.fx.sectorB}`);
    expect(b.indicators).toMatchObject({
      n: 16,
      promoters: 1,
      passives: 15,
      detractors: 0,
      nps: 6.3,
    });
    expect(b.indicators.nps).toBe(computeNps({ promoters: 1, passives: 15, detractors: 0 }));
  });
});

describe('T36 — E28 resumo geral', () => {
  it('valores do conjunto de referência, distribuição, manifestações, cobertura e comparação', async () => {
    const data = await summary(`${P}&compare=previous_period`);
    expect(data.period).toEqual({ from: '2026-09-10', to: '2026-09-16' });
    expect(data.indicators).toMatchObject({
      n: 26,
      promoters: 5,
      passives: 18,
      detractors: 3,
      nps: 7.7,
      promotersPercent: 19.2,
      detractorsPercent: 11.5,
      suppressed: false,
    });
    // RF52: soma das quantidades igual ao total.
    const distribution = data.distribution ?? [];
    expect(distribution).toHaveLength(11);
    expect(distribution.reduce((sum, item) => sum + item.count, 0)).toBe(26);
    expect(distribution.find((item) => item.score === 7)).toEqual({
      score: 7,
      count: 10,
      percent: 38.5,
    });
    expect(distribution.find((item) => item.score === 1)).toEqual({
      score: 1,
      count: 0,
      percent: 0,
    });

    expect(data.manifestations).toEqual({
      total: 3,
      compliment: 1,
      complaint: 1,
      suggestion: 1,
      suppressed: false,
    });
    expect(data.coverage).toEqual({ total: 26, attributed: 3, percent: 11.5, suppressed: false });
    expect(data.comparison).toMatchObject({
      period: { from: '2026-09-03', to: '2026-09-09' },
      indicators: { n: 2, nps: 0 },
      delta: 7.7,
      noPreviousData: false,
    });
  });

  it('RF58: sem respostas no período anterior → variação nula e aviso', async () => {
    const data = await summary(`from=2026-09-25&to=2026-09-25&compare=previous_period`);
    expect(data.comparison).toMatchObject({
      delta: null,
      noPreviousData: true,
      indicators: { n: 0, nps: null },
    });
  });

  it('RF60: filtro sem dados → 200, total 0 e NPS nulo (nunca 0)', async () => {
    const data = await summary('from=2020-01-01&to=2020-01-31');
    expect(data.indicators).toMatchObject({
      n: 0,
      nps: null,
      promoters: 0,
      promotersPercent: null,
    });
    expect(data.distribution?.every((item) => item.count === 0 && item.percent === null)).toBe(
      true,
    );
    expect(data.manifestations.total).toBe(0);
    expect(data.coverage).toMatchObject({ total: 0, percent: null });
  });

  it('RN21: VI com 4 respostas → suprimido; com 5 → valores; GE vê os 4', async () => {
    const vi4 = await summary('from=2026-09-25&to=2026-09-25', 'vi');
    expect(vi4.indicators).toMatchObject({ n: null, nps: null, promoters: null, suppressed: true });
    expect(vi4.distribution).toBeNull();
    expect(vi4.coverage).toMatchObject({ total: null, suppressed: true });
    expect(JSON.stringify(vi4)).not.toMatch(/"n":4/);

    const ge4 = await summary(
      `from=2026-09-25&to=2026-09-25&sectorIds=${scenario.fx.sectorA}`,
      'ge',
    );
    expect(ge4.indicators).toMatchObject({ n: 4, nps: 100, suppressed: false });

    const vi5 = await summary('from=2026-09-25&to=2026-09-26', 'vi');
    expect(vi5.indicators).toMatchObject({ n: 5, nps: 60, suppressed: false });
  });
});

describe('T36 — E29 por setor, E32 tendência e E33 perguntas', () => {
  it('E29: setores do escopo ordenados por NPS; inativo sem respostas ausente; restrito vê só o seu', async () => {
    const response = await get(`/sectors?${P}`);
    expect(response.status).toBe(200);
    const sectors = dataOf<{ id: string; indicators: Indicator }[]>(response);
    expect(
      sectors.map((sector) => [sector.id, sector.indicators.n, sector.indicators.nps]),
    ).toEqual([
      [scenario.fx.sectorA, 10, 10],
      [scenario.fx.sectorB, 16, 6.3],
    ]);
    const own = dataOf<{ id: string }[]>(await get(`/sectors?${P}`, 'as'));
    expect(own.map((sector) => sector.id)).toEqual([scenario.fx.sectorA]);
  });

  it('E29: setor sem respostas no período fica ao final, com n = 0 e NPS nulo', async () => {
    const sectors = dataOf<{ id: string; indicators: Indicator }[]>(
      await get('/sectors?from=2026-09-20&to=2026-09-20'),
    );
    expect(
      sectors.map((sector) => [sector.id, sector.indicators.n, sector.indicators.nps]),
    ).toEqual([
      [scenario.fx.sectorB, 2, 100],
      [scenario.fx.sectorA, 0, null],
    ]);
  });

  it('E32: um ponto por dia, sem lacunas; soma igual ao total; NPS por computeNps', async () => {
    const response = await get(`/trends?${P}&granularity=day`);
    expect(response.status).toBe(200);
    const points =
      dataOf<{ start: string; end: string; n: number; nps: number | null }[]>(response);
    expect(points.map((point) => point.start)).toEqual([
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
    ]);
    expect(points.reduce((sum, point) => sum + point.n, 0)).toBe(26);
    // 16/09 local: notas 3 e 0 no setor A e 2 passivos do setor B.
    expect(points.at(-1)).toMatchObject({ start: '2026-09-16', n: 4 });
  });

  it('E32: granularidade automática semanal sem lacunas; dia com mais de 31 dias → 400', async () => {
    const response = await get('/trends?from=2026-09-01&to=2026-10-15');
    expect((response.body as { meta: { granularity: string } }).meta.granularity).toBe('week');
    const points = dataOf<{ start: string; end: string }[]>(response);
    expect(points).toHaveLength(7);
    for (let index = 1; index < points.length; index += 1) {
      expect((points[index]?.start ?? '') > (points[index - 1]?.end ?? '')).toBe(true);
    }
    expect(points.at(-1)?.end).toBe('2026-10-15');
    expect((await get('/trends?from=2026-09-01&to=2026-10-02&granularity=day')).status).toBe(400);
    expect((await get('/trends?from=2026-01-01&to=2026-08-31&granularity=month')).status).toBe(200);
  });

  it('E33: respostas, média com duas casas, distribuição 1–5 e % de notas 4 e 5', async () => {
    const response = await get(`/questions?${P}`);
    expect(response.status).toBe(200);
    const items = dataOf<
      {
        questionId: string;
        n: number;
        average: number;
        topTwoPercent: number;
        distribution: { score: number; count: number }[];
      }[]
    >(response);
    const question = items.find((item) => item.questionId === scenario.fx.specificA);
    expect(question).toMatchObject({ n: 6, average: 3.17, topTwoPercent: 50 });
    expect(question?.distribution.map((entry) => entry.count)).toEqual([1, 1, 1, 2, 1]);
    expect((response.body as { meta: { total: number } }).meta.total).toBe(26);
    // journeyStageId de outra etapa → nenhuma pergunta.
    const none = await get(`/questions?${P}&journeyStageId=${crypto.randomUUID()}`);
    expect(dataOf<unknown[]>(none)).toEqual([]);
  });

  it('E33 para VI: pergunta com 6 respostas visível; com menos de 5 → suprimida', async () => {
    const visible = dataOf<{ n: number | null; suppressed: boolean }[]>(
      await get(`/questions?${P}`, 'vi'),
    );
    expect(visible[0]).toMatchObject({ n: 6, suppressed: false });
    const few = dataOf<{ n: number | null; suppressed: boolean; average: number | null }[]>(
      await get('/questions?from=2026-09-12&to=2026-09-13', 'vi'),
    );
    expect(few[0]).toMatchObject({ n: null, average: null, suppressed: true });
  });
});

describe('T37 — filtros por período, turno e equipe', () => {
  it('limites 00:00 e 23:59 do dia local são inclusivos; vizinhos ficam fora', async () => {
    const data = await summary(`from=2026-09-20&to=2026-09-20&sectorIds=${scenario.fx.sectorB}`);
    expect(data.indicators.n).toBe(2);
  });

  it('367 dias ou from > to → 400; 366 dias → 200', async () => {
    const tooLong = await get('/summary?from=2025-09-10&to=2026-09-11');
    expect(tooLong.status).toBe(400);
    expect(errorOf(tooLong).details).toContainEqual(expect.objectContaining({ field: 'to' }));
    const inverted = await get('/summary?from=2026-09-16&to=2026-09-10');
    expect(inverted.status).toBe(400);
    expect(errorOf(inverted).details).toContainEqual(expect.objectContaining({ field: 'from' }));
    expect((await get('/summary?from=2025-09-11&to=2026-09-11')).status).toBe(200);
    expect((await get('/summary?from=2026-02-30')).status).toBe(400);
    expect((await get('/summary?desconhecido=1')).status).toBe(400);
  });

  it('turno e equipe: só respostas atribuídas; a cobertura não muda com o recorte', async () => {
    const morning = await summary(`${P}&period=morning`);
    expect(morning.indicators).toMatchObject({ n: 2, nps: 100 });
    expect(morning.coverage).toMatchObject({ total: 26, attributed: 3 });

    const teamA2 = await summary(`${P}&teamIds=${scenario.fx.teamA2}`);
    expect(teamA2.indicators).toMatchObject({ n: 1, passives: 1 });

    const shifts = await get(`/shifts?${P}`);
    expect(
      dataOf<{ period: string; indicators: Indicator }[]>(shifts).map((item) => [
        item.period,
        item.indicators.n,
      ]),
    ).toEqual([
      ['morning', 2],
      ['afternoon', 0],
      ['night', 1],
    ]);
    expect((shifts.body as { meta: { coverage: { percent: number } } }).meta.coverage.percent).toBe(
      11.5,
    );

    const teams = dataOf<{ id: string; indicators: Indicator }[]>(await get(`/teams?${P}`));
    expect(teams.map((team) => [team.id, team.indicators.n])).toEqual([
      [scenario.fx.teamA1, 2],
      [scenario.fx.teamA2, 1],
    ]);
  });

  it('escopo: AS só vê o setor A; setor, equipe ou pesquisa de outro setor → 403 SECTOR_OUT_OF_SCOPE', async () => {
    expect((await summary(P, 'as')).indicators.n).toBe(10);
    for (const query of [
      `sectorIds=${scenario.fx.sectorB}`,
      `teamIds=${scenario.fx.teamB1}`,
      `surveyId=${scenario.fx.surveyB}`,
    ]) {
      const response = await get(`/summary?${P}&${query}`, 'as');
      expect(response.status).toBe(403);
      expect(errorOf(response).code).toBe('SECTOR_OUT_OF_SCOPE');
    }
    expect((await summary(`${P}&surveyId=${scenario.fx.surveyB}`)).indicators.n).toBe(16);
    expect((await summary(P, 'asEmpty')).indicators.n).toBe(0);
  });
});

describe('T11 — atualização do dashboard após nova resposta (sem cache no servidor)', () => {
  it('E02 seguido de E28 → total + 1 e NPS recalculado', async () => {
    const before = await summary(`sectorIds=${scenario.fx.sectorB}`);
    const sent = await submitResponse(app, {
      surveyVersionId: scenario.fx.versionB1,
      origin: 'link',
      npsScore: 0,
      answers: [],
    });
    expect(sent.status).toBe(201);
    const after = await summary(`sectorIds=${scenario.fx.sectorB}`);
    expect(after.indicators.n).toBe((before.indicators.n ?? 0) + 1);
    expect(after.indicators.detractors).toBe((before.indicators.detractors ?? 0) + 1);
    expect(after.indicators.nps).toBe(
      computeNps({
        promoters: after.indicators.promoters ?? 0,
        passives: after.indicators.passives ?? 0,
        detractors: after.indicators.detractors ?? 0,
      }),
    );
  });
});
