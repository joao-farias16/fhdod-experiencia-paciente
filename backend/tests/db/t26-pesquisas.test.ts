/**
 * T26 — Configuração, versionamento e publicação (RF25–RF29, RF31, RF32) e parte de integração do
 * T02 (URLs exatas do link e do QR Code, RF30), com PostgreSQL real.
 * Procedimento da Seção 12: criar, publicar v1, responder, alterar, publicar v2, desativar →
 * versões distintas; 422 QUESTION_LOCKED; 409; 410.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../src/lib/prisma.js';
import { DEFAULT_NPS_TEXT } from '../../src/modules/surveys/surveys.schemas.js';
import { FakeSupabase } from '../fake-supabase.js';
import { errorOf } from '../helpers.js';
import {
  type AuthScenario,
  buildAuthApp,
  createAuthScenario,
  openConnections,
} from './auth-support.js';
import {
  type App,
  auditActionsOf,
  call,
  countRows,
  dataOf,
  submitResponse,
} from './et04-et06-support.js';
import type { Db } from './support.js';

let db: Db;
let prisma: PrismaClient;
let scenario: AuthScenario;
let app: App;

beforeAll(async () => {
  ({ db, prisma } = await openConnections());
  const fake = new FakeSupabase();
  scenario = await createAuthScenario(db, fake);
  app = buildAuthApp(prisma, fake);
});

afterAll(async () => {
  await prisma.$disconnect();
  await db.end();
});

interface Question {
  id: string;
  type: 'nps' | 'scale_1_5';
  text: string;
  isActive: boolean;
  locked: boolean;
}
interface Version {
  id: string;
  versionNumber: number;
  title: string;
  supersededAt: string | null;
  isCurrent: boolean;
  publishedBy: { id: string; fullName: string };
  questions: { questionId: string; type: string; text: string; position: number }[];
}
interface Survey {
  id: string;
  slug: string;
  title: string;
  status: 'draft' | 'active' | 'inactive';
  hasUnpublishedChanges: boolean;
  questions: Question[];
  versions: Version[];
  links: { qrUrl: string; linkUrl: string } | null;
}

const slug = `pesquisa-t26-${Math.random().toString(36).slice(2, 8)}`;
const publicSurvey = (target: string) => request(app).get(`/api/v1/public/surveys/${target}`);

describe('T26 — configuração, versionamento e publicação', () => {
  let survey: Survey;
  let v1: Version;
  let responseId: string;

  it('cria rascunho com a pergunta geral automática; link de rascunho → 404; slug repetido → 409', async () => {
    const created = await call(app, scenario, 'as', 'post', '/admin/surveys', {
      sectorId: scenario.fx.sectorA,
      title: 'Avaliação do atendimento',
      slug,
      introText: 'Sua opinião é anônima.',
    });
    expect(created.status).toBe(201);
    survey = dataOf<Survey>(created);
    expect(survey).toMatchObject({ status: 'draft', hasUnpublishedChanges: true, links: null });
    expect(survey.questions).toEqual([
      expect.objectContaining({
        type: 'nps',
        text: DEFAULT_NPS_TEXT,
        isActive: true,
        locked: false,
      }),
    ]);

    expect((await publicSurvey(slug)).status).toBe(404);
    const qr = await call(app, scenario, 'as', 'get', `/admin/surveys/${survey.id}/qr`);
    expect([qr.status, errorOf(qr).code]).toEqual([409, 'SURVEY_NOT_PUBLISHED']);

    const duplicate = await call(app, scenario, 'sa', 'post', '/admin/surveys', {
      sectorId: scenario.fx.sectorB,
      title: 'Outra',
      slug,
    });
    expect(duplicate.status).toBe(409);
    const invalidSlug = await call(app, scenario, 'sa', 'post', '/admin/surveys', {
      sectorId: scenario.fx.sectorB,
      title: 'Outra',
      slug: 'Com Espaço',
    });
    expect([invalidSlug.status, errorOf(invalidSlug).details[0]?.field]).toEqual([400, 'slug']);
    const outside = await call(app, scenario, 'as', 'post', '/admin/surveys', {
      sectorId: scenario.fx.sectorB,
      title: 'Fora do escopo',
      slug: `${slug}-b`,
    });
    expect([outside.status, errorOf(outside).code]).toEqual([403, 'SECTOR_OUT_OF_SCOPE']);
    const inactiveSector = await call(app, scenario, 'sa', 'post', '/admin/surveys', {
      sectorId: scenario.sectorC,
      title: 'Setor inativo',
      slug: `${slug}-c`,
    });
    expect([inactiveSector.status, errorOf(inactiveSector).code]).toEqual([422, 'SECTOR_INACTIVE']);
  });

  it('publica a v1 com instantâneos, gera link e QR exatos e recebe resposta', async () => {
    const edited = await call(app, scenario, 'as', 'patch', `/admin/surveys/${survey.id}`, {
      questions: [
        { text: 'Como foi a recepção?', journeyStageId: scenario.fx.stageId },
        { text: 'A sala de espera estava limpa?', journeyStageId: scenario.fx.stageId },
      ],
    });
    expect(edited.status).toBe(200);
    survey = dataOf<Survey>(edited);
    expect(survey.questions.filter((question) => question.type === 'scale_1_5')).toHaveLength(2);

    const published = await call(
      app,
      scenario,
      'as',
      'post',
      `/admin/surveys/${survey.id}/publish`,
    );
    expect(published.status).toBe(201);
    v1 = dataOf<Version>(published);
    expect(v1).toMatchObject({ versionNumber: 1, isCurrent: true, supersededAt: null });
    expect(v1.questions.map((question) => [question.position, question.type])).toEqual([
      [1, 'nps'],
      [2, 'scale_1_5'],
      [3, 'scale_1_5'],
    ]);

    // RF30 (T02, integração): URLs exatas com a origem identificada.
    const links = dataOf<{ qrUrl: string; linkUrl: string }>(
      await call(app, scenario, 'as', 'get', `/admin/surveys/${survey.id}/qr`),
    );
    expect(links.qrUrl).toBe(`http://localhost:5173/p/${slug}?origem=qr`);
    expect(links.linkUrl).toBe(`http://localhost:5173/p/${slug}?origem=link`);

    const open = await publicSurvey(slug);
    expect(open.status).toBe(200);
    const body = dataOf<{ surveyVersionId: string; stages: { questions: { id: string }[] }[] }>(
      open,
    );
    expect(body.surveyVersionId).toBe(v1.id);
    const answered = await submitResponse(app, {
      surveyVersionId: v1.id,
      origin: 'link',
      npsScore: 9,
      answers: [{ questionId: body.stages[0]?.questions[0]?.id, score: 4 }],
    });
    expect(answered.status).toBe(201);
    responseId = dataOf<{ responseId: string }>(answered).responseId;
  });

  it('pergunta publicada, setor, slug e pergunta geral ficam bloqueados (422); textos editáveis', async () => {
    const published = survey.questions.find((question) => question.type === 'scale_1_5');
    const nps = survey.questions.find((question) => question.type === 'nps');
    if (published === undefined || nps === undefined) throw new Error('perguntas ausentes');
    expect(
      dataOf<Survey>(
        await call(app, scenario, 'as', 'get', `/admin/surveys/${survey.id}`),
      ).questions.every((q) => q.locked),
    ).toBe(true);

    const lockedText = await call(app, scenario, 'as', 'patch', `/admin/surveys/${survey.id}`, {
      questions: [{ id: published.id, text: 'Texto novo para pergunta publicada' }],
    });
    expect([lockedText.status, errorOf(lockedText).code]).toEqual([422, 'QUESTION_LOCKED']);
    for (const [field, value] of [
      ['slug', `${slug}-novo`],
      ['sectorId', scenario.fx.sectorB],
      ['npsQuestionText', 'Outra pergunta geral de 0 a 10?'],
    ] as const) {
      const locked = await call(app, scenario, 'sa', 'patch', `/admin/surveys/${survey.id}`, {
        [field]: value,
      });
      expect([locked.status, errorOf(locked).code]).toEqual([
        422,
        'FIELD_LOCKED_AFTER_PUBLICATION',
      ]);
    }
    const npsOff = await call(app, scenario, 'as', 'patch', `/admin/surveys/${survey.id}`, {
      questions: [{ id: nps.id, isActive: false }],
    });
    expect([npsOff.status, errorOf(npsOff).code]).toEqual([422, 'NPS_QUESTION_REQUIRED']);

    // RN17: para mudar, desativa-se a pergunta e cria-se outra; títulos e textos mudam livremente.
    const changed = await call(app, scenario, 'as', 'patch', `/admin/surveys/${survey.id}`, {
      title: 'Avaliação do atendimento — versão 2',
      thankYouMessage: 'Muito obrigado pela sua participação.',
      questions: [
        { id: published.id, isActive: false },
        { text: 'Texto novo para pergunta publicada', journeyStageId: scenario.fx.stageId },
      ],
    });
    expect(changed.status).toBe(200);
    survey = dataOf<Survey>(changed);
    expect(survey.hasUnpublishedChanges).toBe(true);
    // As mudanças só ficam públicas após publicar (RF26).
    const stillV1 = dataOf<{ surveyVersionId: string; title: string }>(await publicSurvey(slug));
    expect(stillV1).toMatchObject({ surveyVersionId: v1.id, title: 'Avaliação do atendimento' });
  });

  it('publica a v2; a v1 e a resposta antiga permanecem; publicar sem mudanças → 409', async () => {
    const published = await call(
      app,
      scenario,
      'as',
      'post',
      `/admin/surveys/${survey.id}/publish`,
    );
    expect(published.status).toBe(201);
    const v2 = dataOf<Version>(published);
    expect(v2.versionNumber).toBe(2);
    expect(v2.questions.map((question) => question.text)).toContain(
      'Texto novo para pergunta publicada',
    );
    expect(v2.questions).toHaveLength(3);

    const again = await call(app, scenario, 'as', 'post', `/admin/surveys/${survey.id}/publish`);
    expect([again.status, errorOf(again).code]).toEqual([409, 'NO_CHANGES_TO_PUBLISH']);

    // RF32: histórico com número, data, autor e perguntas de cada versão; v1 intacta.
    const detail = dataOf<Survey>(
      await call(app, scenario, 'as', 'get', `/admin/surveys/${survey.id}`),
    );
    expect(detail.versions.map((version) => [version.versionNumber, version.isCurrent])).toEqual([
      [2, true],
      [1, false],
    ]);
    const oldVersion = detail.versions[1];
    expect(oldVersion?.supersededAt).not.toBeNull();
    expect(oldVersion?.title).toBe('Avaliação do atendimento');
    expect(oldVersion?.questions).toEqual(v1.questions);
    expect(oldVersion?.publishedBy.id).toBe(scenario.users.as.profileId);

    // RN06/RN15: a resposta antiga continua na versão exibida (v1).
    const { rows } = await db.query<{ survey_version_id: string }>(
      'SELECT survey_version_id FROM responses WHERE id = $1',
      [responseId],
    );
    expect(rows[0]?.survey_version_id).toBe(v1.id);
    const current = dataOf<{ surveyVersionId: string; thankYouMessage: string }>(
      await publicSurvey(slug),
    );
    expect(current).toMatchObject({
      surveyVersionId: v2.id,
      thankYouMessage: 'Muito obrigado pela sua participação.',
    });
  });

  it('limite de 10 específicas ativas (422) e desativação/reativação da pesquisa (410)', async () => {
    const additions = Array.from({ length: 8 }, (_, index) => ({
      text: `Pergunta adicional número ${index + 1}?`,
      journeyStageId: scenario.fx.stageId,
    }));
    // Hoje há 2 específicas ativas: +8 = 10 (aceito); +1 = 11 (recusado).
    expect(
      (
        await call(app, scenario, 'as', 'patch', `/admin/surveys/${survey.id}`, {
          questions: additions,
        })
      ).status,
    ).toBe(200);
    const eleventh = await call(app, scenario, 'as', 'patch', `/admin/surveys/${survey.id}`, {
      questions: [{ text: 'Décima primeira pergunta?', journeyStageId: scenario.fx.stageId }],
    });
    expect([eleventh.status, errorOf(eleventh).code]).toEqual([422, 'QUESTION_LIMIT_REACHED']);

    const off = await call(app, scenario, 'as', 'patch', `/admin/surveys/${survey.id}`, {
      isActive: false,
    });
    expect(dataOf<Survey>(off).status).toBe('inactive');
    const closed = await publicSurvey(slug);
    expect([closed.status, errorOf(closed).code]).toEqual([410, 'SURVEY_UNAVAILABLE']);
    const late = await submitResponse(app, {
      surveyVersionId: dataOf<Survey>(off).versions[0]?.id,
      origin: 'link',
      npsScore: 7,
    });
    expect(late.status).toBe(410);
    const publishOff = await call(
      app,
      scenario,
      'as',
      'post',
      `/admin/surveys/${survey.id}/publish`,
    );
    expect([publishOff.status, errorOf(publishOff).code]).toEqual([422, 'SURVEY_INACTIVE']);
    // RN11: nada é apagado; a reativação volta à versão vigente.
    expect(await countRows(db, 'SELECT 1 FROM responses WHERE id = $1', [responseId])).toBe(1);
    await call(app, scenario, 'as', 'patch', `/admin/surveys/${survey.id}`, { isActive: true });
    expect((await publicSurvey(slug)).status).toBe(200);

    expect(await auditActionsOf(db, survey.id)).toEqual([
      'SURVEY_CREATED',
      'SURVEY_UPDATED',
      'SURVEY_PUBLISHED',
      'SURVEY_UPDATED',
      'SURVEY_PUBLISHED',
      'SURVEY_UPDATED',
      'SURVEY_DEACTIVATED',
      'SURVEY_REACTIVATED',
    ]);
  });

  it('E22 filtra por situação e escopo; GE, OU e VI → 403; setor inativo → E01 410', async () => {
    const drafts = await call(
      app,
      scenario,
      'sa',
      'get',
      `/admin/surveys?status=active&sectorId=${scenario.fx.sectorA}`,
    );
    expect(dataOf<Survey[]>(drafts).map((item) => item.slug)).toContain(slug);
    const asList = dataOf<{ sectorId: string }[]>(
      await call(app, scenario, 'as', 'get', '/admin/surveys'),
    );
    expect(new Set(asList.map((item) => item.sectorId))).toEqual(new Set([scenario.fx.sectorA]));
    for (const key of ['ge', 'ou', 'vi'] as const) {
      expect((await call(app, scenario, key, 'get', '/admin/surveys')).status).toBe(403);
    }
    await call(app, scenario, 'sa', 'patch', `/admin/sectors/${scenario.fx.sectorA}`, {
      isActive: false,
    });
    const sectorOff = await publicSurvey(slug);
    expect(sectorOff.status).toBe(410);
    await call(app, scenario, 'sa', 'patch', `/admin/sectors/${scenario.fx.sectorA}`, {
      isActive: true,
    });
  });
});
