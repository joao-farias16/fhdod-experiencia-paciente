/**
 * Pesquisa pública — E01 e E02 com PostgreSQL real (ET06):
 * T01 (parte de API): pesquisa sem login nem cookies; slug inexistente 404; inativa 410.
 * T03 (parte de API): E02 sem npsScore → 400 sem gravação.
 * T04: NPS 9 e duas específicas → 201; 1 linha em responses e 2 em response_answers.
 * T05: computeNps e o SQL da Seção 8 com os mesmos conjuntos de referência.
 * T06: NPS −1, 11, 7,5 e "9"; específica 0, 6 e 3,5; pergunta de outra versão ou repetida → 400.
 * T10: mesma chave e corpo duas vezes, corpo diferente e 5 envios concorrentes → 201/200 com o
 * mesmo id; 409; uma linha.
 * RN26: versão substituída aceita respostas por 24 horas; depois, 409 SURVEY_VERSION_OUTDATED.
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
} from './auth-support.js';
import {
  adjustableClock,
  type App,
  call,
  countRows,
  dataOf,
  submitResponse,
} from './et04-et06-support.js';
import type { Db } from './support.js';

let db: Db;
let prisma: PrismaClient;
let fake: FakeSupabase;
let scenario: AuthScenario;

interface PublicSurvey {
  surveyVersionId: string;
  title: string;
  thankYouMessage: string;
  npsQuestion: { id: string; text: string; anchors: { min: string; max: string } };
  stages: { name: string; position: number; questions: { id: string; text: string }[] }[];
}
interface Submitted {
  responseId: string;
  submittedAt: string;
  lowScore: boolean;
  manifestation: { token: string; expiresAt: string };
}

const suffix = Math.random().toString(36).slice(2, 8);
const slug = `publica-${suffix}`;
let survey: PublicSurvey;
let specifics: string[];

/** Cria e publica pela API uma pesquisa do setor A com duas perguntas específicas. */
async function publishSurvey(app: App, surveySlug: string): Promise<string> {
  const created = dataOf<{ id: string }>(
    await call(app, scenario, 'sa', 'post', '/admin/surveys', {
      sectorId: scenario.fx.sectorA,
      title: 'Pesquisa pública de teste',
      slug: surveySlug,
      thankYouMessage: 'Obrigado! Sua resposta foi registrada.',
    }),
  );
  await call(app, scenario, 'sa', 'patch', `/admin/surveys/${created.id}`, {
    questions: [
      { text: 'Como foi a recepção?', journeyStageId: scenario.fx.stageId },
      { text: 'Como foi o tempo de espera?', journeyStageId: scenario.fx.stageId },
    ],
  });
  const published = await call(app, scenario, 'sa', 'post', `/admin/surveys/${created.id}/publish`);
  expect(published.status).toBe(201);
  return created.id;
}

const responsesOfVersion = (versionId: string) =>
  countRows(db, 'SELECT 1 FROM responses WHERE survey_version_id = $1', [versionId]);
const answersOfVersion = (versionId: string) =>
  countRows(db, 'SELECT 1 FROM response_answers WHERE survey_version_id = $1', [versionId]);

beforeAll(async () => {
  ({ db, prisma } = await openConnections());
  fake = new FakeSupabase();
  scenario = await createAuthScenario(db, fake);
  const app = buildAuthApp(prisma, fake);
  await publishSurvey(app, slug);
  survey = dataOf<PublicSurvey>(await request(app).get(`/api/v1/public/surveys/${slug}`));
  specifics = survey.stages.flatMap((stage) => stage.questions.map((question) => question.id));
});

afterAll(async () => {
  await prisma.$disconnect();
  await db.end();
});

describe('T01 — E01 sem login nem cookies; 404 e 410', () => {
  it('devolve a versão vigente por etapas, com cache público de 60 s e sem dados internos', async () => {
    const app = buildAuthApp(prisma, fake);
    const response = await request(app).get(`/api/v1/public/surveys/${slug}`);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=60');
    expect(response.headers['set-cookie']).toBeUndefined();
    const data = dataOf<PublicSurvey & Record<string, unknown>>(response);
    expect(Object.keys(data).sort()).toEqual(
      [
        'introText',
        'npsQuestion',
        'scaleLabels',
        'sectorName',
        'slug',
        'stages',
        'surveyVersionId',
        'thankYouMessage',
        'title',
        'versionNumber',
      ].sort(),
    );
    expect(data.npsQuestion.anchors).toEqual({
      min: '0 = Nada provável',
      max: '10 = Extremamente provável',
    });
    expect(data.stages).toEqual([
      {
        name: 'Recepção',
        position: 1,
        questions: [
          { id: expect.any(String) as string, text: 'Como foi a recepção?' },
          { id: expect.any(String) as string, text: 'Como foi o tempo de espera?' },
        ],
      },
    ]);
  });

  it('slug inexistente ou inválido → 404; pesquisa inativa → 410 com mensagem', async () => {
    const app = buildAuthApp(prisma, fake);
    expect((await request(app).get('/api/v1/public/surveys/nao-existe-mesmo')).status).toBe(404);
    expect((await request(app).get('/api/v1/public/surveys/Slug_Invalido')).status).toBe(404);

    const otherSlug = `inativa-${suffix}`;
    const id = await publishSurvey(app, otherSlug);
    await call(app, scenario, 'sa', 'patch', `/admin/surveys/${id}`, { isActive: false });
    const gone = await request(app).get(`/api/v1/public/surveys/${otherSlug}`);
    expect(gone.status).toBe(410);
    expect(errorOf(gone)).toMatchObject({
      code: 'SURVEY_UNAVAILABLE',
      message: expect.any(String) as string,
    });
  });
});

describe('T03, T04 e T06 — validação no backend e persistência', () => {
  let app: App;
  beforeAll(() => {
    app = buildAuthApp(prisma, fake);
  });

  it('T04: NPS 9 e duas específicas → 201; 1 resposta e 2 notas, na mesma versão', async () => {
    const before = [
      await responsesOfVersion(survey.surveyVersionId),
      await answersOfVersion(survey.surveyVersionId),
    ];
    const response = await submitResponse(app, {
      surveyVersionId: survey.surveyVersionId,
      origin: 'link',
      npsScore: 9,
      answers: specifics.map((questionId, index) => ({ questionId, score: index + 4 })),
    });
    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const data = dataOf<Submitted>(response);
    expect(data.lowScore).toBe(false);
    expect(data.manifestation.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(data.manifestation.expiresAt) - Date.parse(data.submittedAt)).toBe(3_600_000);
    expect(await responsesOfVersion(survey.surveyVersionId)).toBe((before[0] ?? 0) + 1);
    expect(await answersOfVersion(survey.surveyVersionId)).toBe((before[1] ?? 0) + 2);
    const { rows } = await db.query<{ nps_score: number; origin: string; scores: number[] }>(
      `SELECT r.nps_score, r.origin, array_agg(a.score ORDER BY a.score) AS scores
       FROM responses r JOIN response_answers a ON a.response_id = r.id
       WHERE r.id = $1 GROUP BY r.id`,
      [data.responseId],
    );
    expect(rows[0]).toEqual({ nps_score: 9, origin: 'link', scores: [4, 5] });

    // Específicas são opcionais (RN02); nota baixa conforme a RN05.
    const withoutSpecifics = await submitResponse(app, {
      surveyVersionId: survey.surveyVersionId,
      origin: 'qr_code',
      npsScore: 10,
    });
    expect(withoutSpecifics.status).toBe(201);
    const low = await submitResponse(app, {
      surveyVersionId: survey.surveyVersionId,
      origin: 'link',
      npsScore: 8,
      answers: [{ questionId: specifics[0], score: 2 }],
    });
    expect(dataOf<Submitted>(low).lowScore).toBe(true);
    const detractor = await submitResponse(app, {
      surveyVersionId: survey.surveyVersionId,
      origin: 'link',
      npsScore: 3,
    });
    expect(dataOf<Submitted>(detractor).lowScore).toBe(true);
  });

  it('T03 e T06: notas e perguntas inválidas → 400, sem nenhuma gravação', async () => {
    const before = await responsesOfVersion(survey.surveyVersionId);
    const base = { surveyVersionId: survey.surveyVersionId, origin: 'link' };
    const invalidBodies: [string, object][] = [
      ['NPS ausente', { ...base }],
      ['NPS −1', { ...base, npsScore: -1 }],
      ['NPS 11', { ...base, npsScore: 11 }],
      ['NPS 7,5', { ...base, npsScore: 7.5 }],
      ['NPS "9"', { ...base, npsScore: '9' }],
      ['específica 0', { ...base, npsScore: 9, answers: [{ questionId: specifics[0], score: 0 }] }],
      ['específica 6', { ...base, npsScore: 9, answers: [{ questionId: specifics[0], score: 6 }] }],
      [
        'específica 3,5',
        { ...base, npsScore: 9, answers: [{ questionId: specifics[0], score: 3.5 }] },
      ],
      [
        'pergunta de outra versão',
        { ...base, npsScore: 9, answers: [{ questionId: scenario.fx.specificA, score: 3 }] },
      ],
      [
        'pergunta geral como específica',
        { ...base, npsScore: 9, answers: [{ questionId: survey.npsQuestion.id, score: 3 }] },
      ],
      [
        'pergunta repetida',
        {
          ...base,
          npsScore: 9,
          answers: [
            { questionId: specifics[0], score: 3 },
            { questionId: specifics[0], score: 4 },
          ],
        },
      ],
      ['origem inválida', { ...base, origin: 'email', npsScore: 9 }],
      ['campo desconhecido', { ...base, npsScore: 9, nome: 'Fulano' }],
    ];
    for (const [label, body] of invalidBodies) {
      const response = await submitResponse(app, body);
      expect(response.status, label).toBe(400);
      expect(errorOf(response).code, label).toBe('VALIDATION_ERROR');
    }
    const missing = await submitResponse(app, { ...base, npsScore: 9 }, 'nao-e-uuid');
    expect([missing.status, errorOf(missing).code]).toEqual([400, 'IDEMPOTENCY_KEY_INVALID']);
    const noHeader = await request(app)
      .post('/api/v1/public/responses')
      .send({ ...base, npsScore: 9 });
    expect(noHeader.status).toBe(400);
    const unknownVersion = await submitResponse(app, {
      ...base,
      surveyVersionId: crypto.randomUUID(),
      npsScore: 9,
    });
    expect(unknownVersion.status).toBe(404);
    expect(await responsesOfVersion(survey.surveyVersionId)).toBe(before);
    expect(errorOf(await submitResponse(app, { ...base })).details).toContainEqual(
      expect.objectContaining({ field: 'npsScore' }),
    );
  });
});

describe('T10 — idempotência do envio (RN13)', () => {
  it('repetição devolve o original (200), conteúdo diferente → 409 e 5 envios concorrentes → 1 linha', async () => {
    const app = buildAuthApp(prisma, fake);
    const key = crypto.randomUUID();
    const body = {
      surveyVersionId: survey.surveyVersionId,
      origin: 'qr_code',
      npsScore: 6,
      answers: [{ questionId: specifics[1], score: 3 }],
    };
    const first = await submitResponse(app, body, key);
    expect(first.status).toBe(201);
    const repeated = await submitResponse(app, { ...body, answers: [...body.answers] }, key);
    expect(repeated.status).toBe(200);
    expect(repeated.headers['idempotent-replayed']).toBe('true');
    expect(dataOf<Submitted>(repeated)).toEqual(dataOf<Submitted>(first));

    const reused = await submitResponse(app, { ...body, npsScore: 7 }, key);
    expect([reused.status, errorOf(reused).code]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
    expect(await countRows(db, 'SELECT 1 FROM responses WHERE idempotency_key = $1', [key])).toBe(
      1,
    );

    const concurrentKey = crypto.randomUUID();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        submitResponse(app, { ...body, npsScore: 10 }, concurrentKey),
      ),
    );
    expect(results.map((result) => result.status).filter((status) => status === 201)).toHaveLength(
      1,
    );
    expect(results.every((result) => [200, 201].includes(result.status))).toBe(true);
    expect(new Set(results.map((result) => dataOf<Submitted>(result).responseId)).size).toBe(1);
    expect(
      await countRows(db, 'SELECT 1 FROM responses WHERE idempotency_key = $1', [concurrentKey]),
    ).toBe(1);
  });
});

describe('RN26 — versão substituída aceita respostas por 24 horas', () => {
  it('v1 aceita até 24 h após a publicação da v2; depois, 409 SURVEY_VERSION_OUTDATED', async () => {
    const start = new Date();
    const clock = adjustableClock(start);
    const app = buildAuthApp(prisma, fake, clock);
    const id = await publishSurvey(app, `versoes-${suffix}`);
    const v1 = dataOf<PublicSurvey>(
      await request(app).get(`/api/v1/public/surveys/versoes-${suffix}`),
    );
    await call(app, scenario, 'sa', 'patch', `/admin/surveys/${id}`, {
      title: 'Pesquisa pública v2',
    });
    await call(app, scenario, 'sa', 'post', `/admin/surveys/${id}/publish`);

    const answer = { surveyVersionId: v1.surveyVersionId, origin: 'link', npsScore: 8 };
    clock.set(new Date(start.getTime() + 23 * 3_600_000));
    expect((await submitResponse(app, answer)).status).toBe(201);
    clock.set(new Date(start.getTime() + 25 * 3_600_000));
    const outdated = await submitResponse(app, answer);
    expect([outdated.status, errorOf(outdated).code]).toEqual([409, 'SURVEY_VERSION_OUTDATED']);
  });
});

describe('T05 — computeNps e o SQL da Seção 8 (RN03)', () => {
  const vectors: [number, number, number, number | null][] = [
    [4, 3, 3, 10.0],
    [0, 0, 0, null],
    [10, 0, 0, 100.0],
    [0, 0, 10, -100.0],
    [1, 15, 0, 6.3],
    [0, 15, 1, -6.3],
  ];

  it.each(vectors)(
    'P=%i, passivos=%i, D=%i → %s',
    async (promoters, passives, detractors, expected) => {
      const scores = [
        ...Array<number>(promoters).fill(10),
        ...Array<number>(passives).fill(7),
        ...Array<number>(detractors).fill(0),
      ];
      const { rows } = await db.query<{ nps: string | null }>(
        `SELECT ROUND(100.0 * (COUNT(*) FILTER (WHERE s >= 9) - COUNT(*) FILTER (WHERE s <= 6))
                    / NULLIF(COUNT(*), 0), 1) AS nps
       FROM unnest($1::int[]) AS s`,
        [scores],
      );
      const sql = rows[0]?.nps === null || rows[0]?.nps === undefined ? null : Number(rows[0].nps);
      expect(computeNps({ promoters, passives, detractors })).toBe(expected);
      expect(sql).toBe(expected);
    },
  );
});
