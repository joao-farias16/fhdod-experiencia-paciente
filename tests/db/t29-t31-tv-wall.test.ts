/**
 * TV Wall — E42 com MySQL real (ET10):
 * T29 (parte de API): JSON do E42 validado contra a lista de campos permitidos; nenhum telefone,
 * e-mail, protocolo, texto de manifestação, nome de contato, equipe, turno, usuário, identificador
 * interno ou link no corpo — mesmo com manifestação com contato, resposta atribuída a turno e
 * equipe e usuários no mesmo hospital. Valores iguais aos de E28/E29 para o mesmo período (RF68).
 * T30: setor com 4 respostas ausente; com 5, presente; total geral com 4 → overall.suppressed e
 * todos os valores nulos; com 5 → valores exibidos (RF71). Limite de 8 setores (RF68).
 * T31 (parte de API): Cache-Control público de 60 s; nova resposta visível na consulta seguinte
 * (relógio + 60 s), sem cache no servidor; série da tendência sem lacunas (RF69).
 * T38 (E42): 31ª requisição no minuto → 429 RATE_LIMITED com Retry-After.
 *
 * Relógio fixo: NOW = 20/10/2026 12:00 em America/Sao_Paulo (15:00 UTC).
 * Hospital H (cenário de autenticação):
 * - janela 7d (14 a 20/10): setor A com 5 respostas [10, 9, 9, 7, 3] (a nota 3 entra pelo E02 real,
 *   com manifestação identificada pelo E03; uma resposta é QR Code atribuída à equipe A1) e setor B
 *   com 4 respostas [10, 10, 10, 10];
 * - 01/10: nove setores extras (Setor Extra 1..9) com 5 respostas cada e NPS 100, 80, 60, 40, 20,
 *   0, −20, −40 e −60;
 * - 01/09: a resposta do cenário mínimo (setor A, nota 9), fora das janelas de 7 e 30 dias.
 * Hospital H2 (somente para o total geral): 4 e depois 5 respostas na janela de 7 dias.
 */
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import type { Database } from '../../src/lib/database.js';
import { createLogger } from '../../src/lib/logger.js';
import { computeNps } from '../../src/modules/dashboard/nps.js';
import { tvWallSummarySchema } from '../../src/modules/tv-wall/tv-wall.schemas.js';
import type { Clock } from '../../src/utils/dates.js';
import { ALLOWED_ORIGIN, errorOf, TEST_AUTH_CONFIG } from '../support/app.js';
import {
  type AuthScenario,
  createAuthScenario,
  openConnections,
} from '../support/auth-scenario.js';
import { adjustableClock, dataOf, submitResponse } from '../support/api.js';
import { createFixture, type Db, type Fixture, HASH } from '../support/db.js';

const NOW = '2026-10-20T15:00:00.000Z';

let db: Db;
let database: Database;
let scenario: AuthScenario;
let h2: Fixture;
let hospitalShortName: string;
let h2ShortName: string;

/** Dados sensíveis gravados no hospital H que nunca podem aparecer no E42. */
const secrets = {
  contactName: 'Contato Fictício TV Wall 777',
  phone: '51900007777',
  email: 'contato.tvwall.777@example.com',
  description: 'Texto livre da manifestação que jamais pode aparecer na TV Wall.',
  protocol: '',
  responseId: '',
  shiftId: '',
};

interface TvWall {
  period: { key: '7d' | '30d' | '90d'; from: string; to: string };
  generatedAt: string;
  suppressionThreshold: number;
  overall: {
    n: number | null;
    nps: number | null;
    promotersPercent: number | null;
    detractorsPercent: number | null;
    suppressed: boolean;
  };
  trend: {
    granularity: 'day' | 'week';
    points: {
      start: string;
      end: string;
      n: number | null;
      nps: number | null;
      suppressed: boolean;
    }[];
  };
  sectors: {
    name: string;
    n: number;
    nps: number;
    promotersPercent: number;
    detractorsPercent: number;
  }[];
}

/** Aplicação com o hospital da TV Wall configurado (limite por IP próprio de cada instância). */
function tvApp(shortName: string | undefined, clock: Clock) {
  return createApp({
    env: {
      CORS_ORIGIN: [ALLOWED_ORIGIN],
      TRUST_PROXY: 0,
      AUDIT_IP_SECRET: undefined,
      TV_WALL_HOSPITAL_SHORT_NAME: shortName,
    },
    logger: createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' }),
    db: database,
    auth: TEST_AUTH_CONFIG,
    clock,
  });
}

type TvApp = ReturnType<typeof tvApp>;

function summary(app: TvApp, query = '') {
  return request(app).get(`/api/v1/tv-wall/summary${query}`).set('Origin', ALLOWED_ORIGIN);
}

async function sectorWithSurvey(hospitalId: string, name: string, code: string) {
  const sectorId = randomUUID();
  const surveyId = randomUUID();
  const versionId = randomUUID();
  await db.query('INSERT INTO sectors (id, hospital_id, code, name) VALUES (?, ?, ?, ?)', [
    sectorId,
    hospitalId,
    code,
    name,
  ]);
  await db.query(
    `INSERT INTO survey_configs (id, sector_id, title, slug, thank_you_message, created_by)
     VALUES (?, ?, 'Pesquisa extra', ?, 'Obrigado.', ?)`,
    [
      surveyId,
      sectorId,
      `tv-${code.toLowerCase()}-${randomUUID().slice(0, 8)}`,
      scenario.fx.adminId,
    ],
  );
  await db.query(
    `INSERT INTO survey_versions (id, survey_config_id, sector_id, version_number, title, thank_you_message, published_at, published_by)
     VALUES (?, ?, ?, 1, 'Pesquisa extra', 'Obrigado.', '2026-08-01 00:00:00', ?)`,
    [versionId, surveyId, sectorId, scenario.fx.adminId],
  );
  return { sectorId, versionId };
}

async function addResponse(values: {
  versionId: string;
  sectorId: string;
  nps: number;
  at: string;
  attributed?: { shiftId: string; teamId: string };
}): Promise<string> {
  const id = randomUUID();
  const at = new Date(values.at);
  await db.query(
    `INSERT INTO responses (id, survey_version_id, sector_id, origin, nps_score, low_score, submitted_at,
       attribution_status, shift_id, team_id, shift_period, idempotency_key, request_hash,
       manifestation_token_expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UUID(), ?, ?)`,
    [
      id,
      values.versionId,
      values.sectorId,
      values.attributed === undefined ? 'link' : 'qr_code',
      values.nps,
      values.nps <= 6,
      at,
      values.attributed === undefined ? 'not_qr_origin' : 'attributed',
      values.attributed?.shiftId ?? null,
      values.attributed?.teamId ?? null,
      values.attributed === undefined ? null : 'morning',
      HASH,
      new Date(at.getTime() + 60 * 60_000),
    ],
  );
  return id;
}

/** NPS de referência calculado à parte (inteiros), para não depender do código testado. */
function expectedNps(promoters: number, detractors: number, total: number): number {
  return Math.round(((promoters - detractors) * 1000) / total) / 10;
}

beforeAll(async () => {
  ({ db, database } = await openConnections());
  scenario = await createAuthScenario(db, database);
  const { fx } = scenario;
  const { rows } = await db.query<{ short_name: string }>(
    'SELECT short_name FROM hospitals WHERE id = ?',
    [fx.hospitalId],
  );
  hospitalShortName = rows[0]?.short_name ?? '';

  // Setor A, janela de 7 dias: 10, 9, 9 (QR Code atribuída a A1) e 7 diretas; a nota 3 vem do E02.
  const shiftId = randomUUID();
  await db.query(
    `INSERT INTO shifts (id, sector_id, team_id, period, starts_at, ends_at, source, created_by)
     VALUES (?, ?, ?, 'morning', '2026-10-15 10:00:00', '2026-10-15 16:00:00', 'manual', ?)`,
    [shiftId, fx.sectorA, fx.teamA1, fx.adminId],
  );
  secrets.shiftId = shiftId;
  const a = { versionId: fx.versionA2, sectorId: fx.sectorA };
  await addResponse({ ...a, nps: 10, at: '2026-10-14T13:00:00Z' });
  await addResponse({
    ...a,
    nps: 9,
    at: '2026-10-15T12:00:00Z',
    attributed: { shiftId, teamId: fx.teamA1 },
  });
  await addResponse({ ...a, nps: 9, at: '2026-10-16T13:00:00Z' });
  await addResponse({ ...a, nps: 7, at: '2026-10-17T13:00:00Z' });

  // Setor B, janela de 7 dias: exatamente 4 respostas, todas promotoras (NPS 100 se aparecesse).
  for (const day of ['14', '15', '16', '17']) {
    await addResponse({
      versionId: fx.versionB1,
      sectorId: fx.sectorB,
      nps: 10,
      at: `2026-10-${day}T14:00:00Z`,
    });
  }

  // Nove setores extras em 01/10 (fora da janela de 7 dias, dentro da de 30): 5 respostas cada.
  const mixes: [promoters: number, detractors: number][] = [
    [5, 0],
    [4, 0],
    [3, 0],
    [2, 0],
    [1, 0],
    [0, 0],
    [0, 1],
    [0, 2],
    [0, 3],
  ];
  for (const [index, [promoters, detractors]] of mixes.entries()) {
    const extra = await sectorWithSurvey(
      fx.hospitalId,
      `Setor Extra ${index + 1}`,
      `EXTRA-${index + 1}`,
    );
    const scores = [
      ...Array<number>(promoters).fill(10),
      ...Array<number>(detractors).fill(2),
      ...Array<number>(5 - promoters - detractors).fill(8),
    ];
    for (const [position, nps] of scores.entries()) {
      await addResponse({ ...extra, nps, at: `2026-10-01T1${position}:00:00Z` });
    }
  }

  // Nota 3 pelo fluxo público real (E02) e manifestação identificada com contato (E03).
  const clock = adjustableClock(new Date(NOW));
  const publicApp = tvApp(hospitalShortName, clock);
  const submitted = await submitResponse(publicApp, {
    surveyVersionId: fx.versionA2,
    origin: 'link',
    npsScore: 3,
    answers: [],
  });
  expect(submitted.status).toBe(201);
  const response = dataOf<{ responseId: string; manifestation: { token: string } }>(submitted);
  secrets.responseId = response.responseId;
  const manifestation = await request(publicApp)
    .post('/api/v1/public/manifestations')
    .set('Idempotency-Key', randomUUID())
    .send({
      responseId: response.responseId,
      manifestationToken: response.manifestation.token,
      type: 'complaint',
      description: secrets.description,
      anonymous: false,
      contact: {
        fullName: secrets.contactName,
        phone: secrets.phone,
        email: secrets.email,
        consent: true,
      },
    });
  expect(manifestation.status).toBe(201);
  secrets.protocol = dataOf<{ protocol: string }>(manifestation).protocol;

  // Hospital H2: total geral com 4 respostas na janela de 7 dias (1 do cenário mínimo + 3).
  h2 = await createFixture(db);
  const { rows: h2Rows } = await db.query<{ short_name: string }>(
    'SELECT short_name FROM hospitals WHERE id = ?',
    [h2.hospitalId],
  );
  h2ShortName = h2Rows[0]?.short_name ?? '';
  for (const nps of [10, 6, 8]) {
    await addResponse({
      versionId: h2.versionA1,
      sectorId: h2.sectorA,
      nps,
      at: '2026-09-02T12:00:00Z',
    });
  }
});

afterAll(async () => {
  await database.close();
  await db.end();
});

/** Todas as chaves do JSON, como caminhos (listas como "[]"). */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => keyPaths(item, `${prefix}[]`));
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    return [path, ...keyPaths(child, path)];
  });
}

const ALLOWED_PATHS = new Set([
  'data',
  'data.period',
  'data.period.key',
  'data.period.from',
  'data.period.to',
  'data.generatedAt',
  'data.suppressionThreshold',
  'data.overall',
  'data.overall.n',
  'data.overall.nps',
  'data.overall.promotersPercent',
  'data.overall.detractorsPercent',
  'data.overall.suppressed',
  'data.trend',
  'data.trend.granularity',
  'data.trend.points',
  'data.trend.points[].start',
  'data.trend.points[].end',
  'data.trend.points[].n',
  'data.trend.points[].nps',
  'data.trend.points[].suppressed',
  'data.sectors',
  'data.sectors[].name',
  'data.sectors[].n',
  'data.sectors[].nps',
  'data.sectors[].promotersPercent',
  'data.sectors[].detractorsPercent',
]);

describe('T29 — TV Wall sem dados pessoais (E42 com MySQL real)', () => {
  let app: TvApp;
  beforeAll(() => {
    app = tvApp(hospitalShortName, { now: () => new Date(NOW) });
  });

  it.each(['7d', '30d', '90d'] as const)(
    'period=%s: somente os campos da lista permitida, sem dados pessoais nem links',
    async (period) => {
      const response = await summary(app, `?period=${period}`);
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(response.headers['set-cookie']).toBeUndefined();

      // Lista explícita de campos (RF72): nenhum caminho fora dela, e todos os obrigatórios presentes.
      const paths = keyPaths(response.body);
      expect(paths.filter((path) => !ALLOWED_PATHS.has(path))).toEqual([]);
      expect(Object.keys(response.body as object)).toEqual(['data']);
      expect(tvWallSummarySchema.safeParse(dataOf(response)).success).toBe(true);

      const text = JSON.stringify(response.body);
      // Contato, texto livre e protocolo da manifestação identificada gravada neste hospital.
      for (const value of [
        secrets.contactName,
        secrets.phone,
        secrets.email,
        secrets.description,
        secrets.protocol,
      ]) {
        expect(text).not.toContain(value);
      }
      // Padrões genéricos: e-mail, telefone (10–11 dígitos), protocolo, URL e UUID.
      expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      expect(text).not.toMatch(/\d{10,11}/);
      expect(text).not.toMatch(/FHD-\d{4}-\d{6}/);
      expect(text).not.toMatch(/https?:\/\/|www\.|\/admin|\/ouvidoria|\/painel/i);
      expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      // Equipes, turnos, códigos de setor e usuários do hospital.
      for (const value of [
        'A1',
        'A2',
        'B1',
        'SETOR-A',
        'morning',
        'attributed',
        'Usuário Fictício',
        '@example.com',
        'Pesquisa de teste',
        'Texto publicado',
      ]) {
        expect(text).not.toContain(value);
      }
    },
  );

  it('identificadores internos (setor, resposta, turno, equipe, hospital) nunca saem', async () => {
    const text = JSON.stringify((await summary(app, '?period=90d')).body);
    for (const id of [
      scenario.fx.hospitalId,
      scenario.fx.sectorA,
      scenario.fx.sectorB,
      scenario.fx.teamA1,
      scenario.fx.adminId,
      secrets.responseId,
      secrets.shiftId,
    ]) {
      expect(text).not.toContain(id);
    }
  });

  it('valores iguais aos do dashboard (E28 e E29) para o mesmo período (RF68)', async () => {
    const tv = dataOf<TvWall>(await summary(app, '?period=30d'));
    const { from, to } = tv.period;
    const e28 = await request(app)
      .get(`/api/v1/dashboard/summary?from=${from}&to=${to}`)
      .set('Authorization', scenario.bearer('sa'));
    expect(e28.status).toBe(200);
    const indicators = dataOf<{
      indicators: { n: number; nps: number; promotersPercent: number; detractorsPercent: number };
    }>(e28).indicators;
    expect(tv.overall).toEqual({
      n: indicators.n,
      nps: indicators.nps,
      promotersPercent: indicators.promotersPercent,
      detractorsPercent: indicators.detractorsPercent,
      suppressed: false,
    });

    const e29 = await request(app)
      .get(`/api/v1/dashboard/sectors?from=${from}&to=${to}`)
      .set('Authorization', scenario.bearer('sa'));
    expect(e29.status).toBe(200);
    const fromDashboard = dataOf<
      {
        name: string;
        indicators: {
          n: number | null;
          nps: number | null;
          promotersPercent: number;
          detractorsPercent: number;
        };
      }[]
    >(e29)
      .filter((sector) => (sector.indicators.n ?? 0) >= 5)
      .slice(0, 8)
      .map((sector) => ({
        name: sector.name,
        n: sector.indicators.n,
        nps: sector.indicators.nps,
        promotersPercent: sector.indicators.promotersPercent,
        detractorsPercent: sector.indicators.detractorsPercent,
      }));
    expect(tv.sectors).toEqual(fromDashboard);
  });
});

describe('T30 — supressão de categorias com menos de cinco respostas', () => {
  it('7d: setor B com 4 respostas ausente; setor A com 5 presente; total com os valores de referência', async () => {
    const app = tvApp(hospitalShortName, { now: () => new Date(NOW) });
    const response = await summary(app, '?period=7d');
    expect(response.status).toBe(200);
    const tv = dataOf<TvWall>(response);

    expect(tv.period).toEqual({ key: '7d', from: '2026-10-14', to: '2026-10-20' });
    expect(tv.suppressionThreshold).toBe(5);
    // A: 10, 9, 9, 7, 3 → 3 promotores e 1 detrator em 5.
    expect(tv.sectors).toEqual([
      { name: 'Setor A', n: 5, nps: 40, promotersPercent: 60, detractorsPercent: 20 },
    ]);
    expect(tv.sectors.map((sector) => sector.name)).not.toContain('Setor B');
    expect(JSON.stringify(tv)).not.toContain('Setor B');
    // Total: A (5) + B (4) = 9; 7 promotores, 1 passivo e 1 detrator.
    expect(tv.overall).toEqual({
      n: 9,
      nps: expectedNps(7, 1, 9),
      promotersPercent: 77.8,
      detractorsPercent: 11.1,
      suppressed: false,
    });
    expect(tv.overall.nps).toBe(66.7);
    expect(tv.overall.nps).toBe(computeNps({ promoters: 7, passives: 1, detractors: 1 }));

    // Tendência diária: dias com 1 a 4 respostas anulados; dias sem respostas com n = 0.
    expect(tv.trend.granularity).toBe('day');
    expect(tv.trend.points.map((point) => point.start)).toEqual([
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
      '2026-10-19',
      '2026-10-20',
    ]);
    for (const point of tv.trend.points.slice(0, 4)) {
      // 2 respostas por dia (uma de A e uma de B) → suprimido.
      expect(point).toMatchObject({ n: null, nps: null, suppressed: true });
    }
    expect(tv.trend.points[4]).toMatchObject({ n: 0, nps: null, suppressed: false });
    expect(tv.trend.points[5]).toMatchObject({ n: 0, nps: null, suppressed: false });
    // 20/10: só a nota 3 do E02 → 1 resposta, suprimida.
    expect(tv.trend.points[6]).toMatchObject({ n: null, nps: null, suppressed: true });
  });

  it('30d: no máximo 8 setores, ordenados por NPS; B (4) ausente; extras 8 e 9 excluídos pelo limite', async () => {
    const app = tvApp(hospitalShortName, { now: () => new Date(NOW) });
    const tv = dataOf<TvWall>(await summary(app, '?period=30d'));
    expect(tv.period).toEqual({ key: '30d', from: '2026-09-21', to: '2026-10-20' });
    expect(tv.sectors).toHaveLength(8);
    expect(tv.sectors.map((sector) => [sector.name, sector.nps, sector.n])).toEqual([
      ['Setor Extra 1', 100, 5],
      ['Setor Extra 2', 80, 5],
      ['Setor Extra 3', 60, 5],
      ['Setor A', 40, 5],
      ['Setor Extra 4', 40, 5],
      ['Setor Extra 5', 20, 5],
      ['Setor Extra 6', 0, 5],
      ['Setor Extra 7', -20, 5],
    ]);
    // Total: extras 45 (15 promotores, 6 detratores) + A 5 (3, 1) + B 4 (4, 0) = 54.
    expect(tv.overall).toEqual({
      n: 54,
      nps: expectedNps(22, 7, 54),
      promotersPercent: 40.7,
      detractorsPercent: 13,
      suppressed: false,
    });
    expect(tv.overall.nps).toBe(27.8);
    expect(tv.trend.granularity).toBe('day');
    expect(tv.trend.points).toHaveLength(30);
    // 01/10: 45 respostas dos extras.
    const october1 = tv.trend.points.find((point) => point.start === '2026-10-01');
    expect(october1).toEqual({
      start: '2026-10-01',
      end: '2026-10-01',
      n: 45,
      nps: expectedNps(15, 6, 45),
      suppressed: false,
    });
  });

  it('90d: série semanal contínua; a resposta de 01/09 entra no total e no setor A', async () => {
    const app = tvApp(hospitalShortName, { now: () => new Date(NOW) });
    const tv = dataOf<TvWall>(await summary(app, '?period=90d'));
    expect(tv.period).toEqual({ key: '90d', from: '2026-07-23', to: '2026-10-20' });
    expect(tv.trend.granularity).toBe('week');
    expect(tv.trend.points).toHaveLength(13);
    expect(tv.trend.points[0]?.start).toBe('2026-07-23');
    expect(tv.trend.points.at(-1)?.end).toBe('2026-10-20');
    for (const [index, point] of tv.trend.points.entries()) {
      const next = tv.trend.points[index + 1];
      if (next !== undefined) {
        const dayAfter = new Date(`${point.end}T00:00:00Z`);
        dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
        expect(next.start).toBe(dayAfter.toISOString().slice(0, 10));
      }
    }
    expect(tv.overall.n).toBe(55);
    expect(tv.sectors.find((sector) => sector.name === 'Setor A')).toEqual({
      name: 'Setor A',
      n: 6,
      nps: expectedNps(4, 1, 6),
      promotersPercent: 66.7,
      detractorsPercent: 16.7,
    });
  });

  it('total geral com 4 respostas → overall.suppressed sem valores; com 5 → valores exibidos', async () => {
    const clock = adjustableClock(new Date('2026-09-03T15:00:00Z'));
    const app = tvApp(h2ShortName, clock);

    const four = dataOf<TvWall>(await summary(app, '?period=7d'));
    expect(four.period).toEqual({ key: '7d', from: '2026-08-28', to: '2026-09-03' });
    expect(four.overall).toEqual({
      n: null,
      nps: null,
      promotersPercent: null,
      detractorsPercent: null,
      suppressed: true,
    });
    expect(four.sectors).toEqual([]);
    for (const point of four.trend.points) {
      expect(point.n === null || point.n === 0).toBe(true);
      expect(point.nps).toBeNull();
    }
    expect(four.trend.points.filter((point) => point.suppressed)).toHaveLength(2);

    // Quinta resposta: o total passa a ser exibido; o setor A (5) também.
    await addResponse({
      versionId: h2.versionA1,
      sectorId: h2.sectorA,
      nps: 9,
      at: '2026-09-03T12:00:00Z',
    });
    clock.set(new Date('2026-09-03T15:01:00Z'));
    const five = dataOf<TvWall>(await summary(app, '?period=7d'));
    // 9 (cenário), 10, 6, 8, 9 → 3 promotores e 1 detrator em 5.
    expect(five.overall).toEqual({
      n: 5,
      nps: 40,
      promotersPercent: 60,
      detractorsPercent: 20,
      suppressed: false,
    });
    expect(five.sectors).toEqual([
      { name: 'Setor A', n: 5, nps: 40, promotersPercent: 60, detractorsPercent: 20 },
    ]);
  });
});

describe('T31 — atualização da TV Wall (parte de API) e contrato para o frontend', () => {
  it('200 com Cache-Control público de 60 s, CORS da origem do frontend e sem cookies', async () => {
    const app = tvApp(hospitalShortName, { now: () => new Date(NOW) });
    const response = await summary(app);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=60');
    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(response.headers['set-cookie']).toBeUndefined();
    // Padrão: últimos 30 dias.
    expect(dataOf<TvWall>(response).period.key).toBe('30d');
  });

  it('nova resposta aparece na consulta seguinte (relógio + 60 s), sem cache no servidor', async () => {
    const clock = adjustableClock(new Date(NOW));
    const app = tvApp(hospitalShortName, clock);
    const before = dataOf<TvWall>(await summary(app, '?period=7d'));

    // Executado depois dos cenários de T29 e T30 (ordem do arquivo), que não a consideram.
    await addResponse({
      versionId: scenario.fx.versionA2,
      sectorId: scenario.fx.sectorA,
      nps: 10,
      at: '2026-10-20T15:00:30Z',
    });
    clock.set(new Date(new Date(NOW).getTime() + 60_000));
    const after = dataOf<TvWall>(await summary(app, '?period=7d'));

    expect(after.generatedAt).toBe('2026-10-20T15:01:00.000Z');
    expect(after.generatedAt).not.toBe(before.generatedAt);
    expect(after.overall.n).toBe((before.overall.n ?? 0) + 1);
    expect(after.overall.nps).toBe(expectedNps(8, 1, 10));
    expect(after.sectors.find((sector) => sector.name === 'Setor A')?.n).toBe(6);
  });

  it('hospital configurado inexistente → 503 SERVICE_UNAVAILABLE, no-store e sem dados', async () => {
    const app = tvApp('NAO-EXISTE', { now: () => new Date(NOW) });
    const response = await summary(app);
    expect(response.status).toBe(503);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(errorOf(response).code).toBe('SERVICE_UNAVAILABLE');
    expect(response.body).not.toHaveProperty('data');
  });

  it('sem configuração e com vários hospitais no banco → 503 (nunca mistura hospitais)', async () => {
    const app = tvApp(undefined, { now: () => new Date(NOW) });
    const response = await summary(app);
    expect(response.status).toBe(503);
    expect(errorOf(response).code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify(response.body)).not.toMatch(/hospital|short_name|TV_WALL/i);
  });
});

describe('T38 — limitação de requisições do E42 (30 por minuto por IP)', () => {
  it('31ª requisição → 429 RATE_LIMITED com Retry-After e no-store', async () => {
    const app = tvApp(hospitalShortName, { now: () => new Date(NOW) });
    for (let index = 0; index < 30; index += 1) {
      expect((await summary(app, '?period=7d')).status).toBe(200);
    }
    const limited = await summary(app, '?period=7d');
    expect(limited.status).toBe(429);
    expect(errorOf(limited).code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.headers['cache-control']).toBe('no-store');
    expect(limited.body).not.toHaveProperty('data');
  });
});
