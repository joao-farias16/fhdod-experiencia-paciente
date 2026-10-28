import type { Prisma, PrismaClient, TransactionClient } from '../../lib/prisma.js';
import { type AuditContext, recordAudit } from '../../services/audit.service.js';
import {
  isSectorInScope,
  resourceNotFound,
  sectorOutOfScope,
  sectorWhere,
} from '../../services/scope.js';
import type { Clock } from '../../utils/clock.js';
import { HttpError } from '../../utils/http-error.js';
import { isUniqueViolation } from '../../utils/prisma-errors.js';
import { VALIDATION_MESSAGE } from '../../utils/validation.js';
import type { AuthContext } from '../auth/auth.types.js';
import { sectorInactive } from '../teams/teams.service.js';
import {
  type CreateSurveyInput,
  DEFAULT_NPS_TEXT,
  DEFAULT_THANK_YOU_MESSAGE,
  type ListSurveysQuery,
  MAX_ACTIVE_SPECIFIC_QUESTIONS,
  type UpdateSurveyInput,
} from './surveys.schemas.js';

export interface SurveysDeps {
  prisma: PrismaClient;
  clock: Clock;
  /** Base pública das URLs /p/<slug> (PUBLIC_APP_URL). */
  publicAppUrl: string;
}

export type SurveyStatus = 'draft' | 'active' | 'inactive';

export interface SurveyLinks {
  qrUrl: string;
  linkUrl: string;
}

export interface SurveySummaryDto {
  id: string;
  sectorId: string;
  sectorCode: string;
  sectorName: string;
  sectorIsActive: boolean;
  title: string;
  slug: string;
  status: SurveyStatus;
  isActive: boolean;
  hasUnpublishedChanges: boolean;
  activeSpecificQuestions: number;
  currentVersion: { id: string; versionNumber: number; publishedAt: string } | null;
  updatedAt: string;
}

export interface SurveyQuestionDto {
  id: string;
  type: 'nps' | 'scale_1_5';
  text: string;
  journeyStage: { id: string; code: string; name: string; position: number } | null;
  position: number;
  isRequired: boolean;
  isActive: boolean;
  /** Já publicada: texto, tipo e etapa imutáveis (RN17). */
  locked: boolean;
}

export interface SurveyVersionDto {
  id: string;
  versionNumber: number;
  title: string;
  introText: string | null;
  thankYouMessage: string;
  publishedAt: string;
  publishedBy: { id: string; fullName: string };
  supersededAt: string | null;
  isCurrent: boolean;
  questions: {
    id: string;
    questionId: string;
    type: 'nps' | 'scale_1_5';
    text: string;
    journeyStageName: string | null;
    position: number;
  }[];
}

export interface SurveyDetailDto extends SurveySummaryDto {
  introText: string | null;
  thankYouMessage: string;
  deactivatedAt: string | null;
  createdAt: string;
  questions: SurveyQuestionDto[];
  versions: SurveyVersionDto[];
  links: SurveyLinks | null;
}

const summarySelect = {
  id: true,
  sectorId: true,
  title: true,
  slug: true,
  isActive: true,
  hasUnpublishedChanges: true,
  updatedAt: true,
  sector: { select: { code: true, name: true, isActive: true, hospitalId: true } },
  currentVersion: { select: { id: true, versionNumber: true, publishedAt: true } },
  _count: { select: { questions: { where: { isActive: true, type: 'scale_1_5' } } } },
} as const satisfies Prisma.SurveyConfigSelect;

const detailSelect = {
  ...summarySelect,
  introText: true,
  thankYouMessage: true,
  deactivatedAt: true,
  createdAt: true,
  questions: {
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      type: true,
      text: true,
      position: true,
      isRequired: true,
      isActive: true,
      firstPublishedAt: true,
      journeyStage: { select: { id: true, code: true, name: true, position: true } },
    },
  },
  versions: {
    orderBy: { versionNumber: 'desc' },
    select: {
      id: true,
      versionNumber: true,
      title: true,
      introText: true,
      thankYouMessage: true,
      publishedAt: true,
      supersededAt: true,
      publishedBy: { select: { id: true, fullName: true } },
      questions: {
        orderBy: { position: 'asc' },
        select: {
          id: true,
          questionId: true,
          type: true,
          text: true,
          journeyStageName: true,
          position: true,
        },
      },
    },
  },
} as const satisfies Prisma.SurveyConfigSelect;

type SummaryRecord = Prisma.SurveyConfigGetPayload<{ select: typeof summarySelect }>;
type DetailRecord = Prisma.SurveyConfigGetPayload<{ select: typeof detailSelect }>;

function statusOf(survey: { isActive: boolean; currentVersion: unknown }): SurveyStatus {
  if (!survey.isActive) return 'inactive';
  return survey.currentVersion === null ? 'draft' : 'active';
}

/** RF30: URLs exatas com a origem identificada (?origem=qr e ?origem=link). */
export function surveyLinks(publicAppUrl: string, slug: string): SurveyLinks {
  const base = `${publicAppUrl}/p/${encodeURIComponent(slug)}`;
  return { qrUrl: `${base}?origem=qr`, linkUrl: `${base}?origem=link` };
}

function toSummaryDto(survey: SummaryRecord): SurveySummaryDto {
  return {
    id: survey.id,
    sectorId: survey.sectorId,
    sectorCode: survey.sector.code,
    sectorName: survey.sector.name,
    sectorIsActive: survey.sector.isActive,
    title: survey.title,
    slug: survey.slug,
    status: statusOf(survey),
    isActive: survey.isActive,
    hasUnpublishedChanges: survey.hasUnpublishedChanges,
    activeSpecificQuestions: survey._count.questions,
    currentVersion:
      survey.currentVersion === null
        ? null
        : {
            id: survey.currentVersion.id,
            versionNumber: survey.currentVersion.versionNumber,
            publishedAt: survey.currentVersion.publishedAt.toISOString(),
          },
    updatedAt: survey.updatedAt.toISOString(),
  };
}

function toDetailDto(survey: DetailRecord, publicAppUrl: string): SurveyDetailDto {
  return {
    ...toSummaryDto(survey),
    introText: survey.introText,
    thankYouMessage: survey.thankYouMessage,
    deactivatedAt: survey.deactivatedAt?.toISOString() ?? null,
    createdAt: survey.createdAt.toISOString(),
    questions: survey.questions.map((question) => ({
      id: question.id,
      type: question.type,
      text: question.text,
      journeyStage: question.journeyStage,
      position: question.position,
      isRequired: question.isRequired,
      isActive: question.isActive,
      locked: question.firstPublishedAt !== null,
    })),
    versions: survey.versions.map((version) => ({
      id: version.id,
      versionNumber: version.versionNumber,
      title: version.title,
      introText: version.introText,
      thankYouMessage: version.thankYouMessage,
      publishedAt: version.publishedAt.toISOString(),
      publishedBy: version.publishedBy,
      supersededAt: version.supersededAt?.toISOString() ?? null,
      isCurrent: version.id === survey.currentVersion?.id,
      questions: version.questions,
    })),
    links: survey.currentVersion === null ? null : surveyLinks(publicAppUrl, survey.slug),
  };
}

function slugConflict(): HttpError {
  return new HttpError(409, 'CONFLICT', 'Já existe uma pesquisa com este endereço.', [
    { field: 'slug', message: 'Escolha outro endereço.' },
  ]);
}

function fieldLocked(field: string): HttpError {
  return new HttpError(
    422,
    'FIELD_LOCKED_AFTER_PUBLICATION',
    'Setor, endereço e pergunta geral não podem mudar depois da primeira publicação.',
    [{ field, message: 'Campo bloqueado após a primeira publicação.' }],
  );
}

function questionLocked(field: string): HttpError {
  return new HttpError(
    422,
    'QUESTION_LOCKED',
    'Pergunta já publicada não muda de texto ou etapa. Desative-a e crie outra.',
    [{ field, message: 'Pergunta bloqueada após a publicação.' }],
  );
}

function invalidField(field: string, message: string): HttpError {
  return new HttpError(400, 'VALIDATION_ERROR', VALIDATION_MESSAGE, [{ field, message }]);
}

/** Pesquisa do hospital e do escopo; fora do escopo ou inexistente → 404 (RN10). */
async function findInScope(
  tx: Pick<TransactionClient, 'surveyConfig'>,
  auth: AuthContext,
  id: string,
): Promise<DetailRecord> {
  const survey = await tx.surveyConfig.findUnique({ where: { id }, select: detailSelect });
  if (survey?.sector.hospitalId !== auth.hospitalId) throw resourceNotFound();
  if (!isSectorInScope(auth.scope, survey.sectorId)) throw resourceNotFound();
  return survey;
}

async function lockSurvey(tx: TransactionClient, id: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM survey_configs WHERE id = ${id}::uuid FOR UPDATE`;
}

/** Setor de destino: do escopo (403), do hospital (404) e ativo (422). */
async function assertTargetSector(
  tx: Pick<TransactionClient, 'sector'>,
  auth: AuthContext,
  sectorId: string,
): Promise<void> {
  if (!isSectorInScope(auth.scope, sectorId)) throw sectorOutOfScope();
  const sector = await tx.sector.findFirst({
    where: { id: sectorId, hospitalId: auth.hospitalId },
    select: { isActive: true },
  });
  if (sector === null) throw resourceNotFound();
  if (!sector.isActive) throw sectorInactive();
}

/** E22 — pesquisas do escopo com situação (rascunho, ativa, inativa), paginadas (RF32). */
export async function listSurveys(
  prisma: Pick<PrismaClient, 'surveyConfig'>,
  auth: AuthContext,
  query: ListSurveysQuery,
): Promise<{ items: SurveySummaryDto[]; total: number }> {
  const statusWhere: Prisma.SurveyConfigWhereInput =
    query.status === 'inactive'
      ? { isActive: false }
      : query.status === 'draft'
        ? { isActive: true, currentVersionId: null }
        : query.status === 'active'
          ? { isActive: true, currentVersionId: { not: null } }
          : {};
  const where: Prisma.SurveyConfigWhereInput = {
    ...sectorWhere(auth.scope, query.sectorId === undefined ? undefined : [query.sectorId]),
    sector: { hospitalId: auth.hospitalId },
    ...statusWhere,
    ...(query.search === undefined
      ? {}
      : {
          OR: [
            { title: { contains: query.search, mode: 'insensitive' } },
            { slug: { contains: query.search, mode: 'insensitive' } },
          ],
        }),
  };
  const [items, total] = await Promise.all([
    prisma.surveyConfig.findMany({
      where,
      orderBy: [{ sector: { name: 'asc' } }, { title: 'asc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: summarySelect,
    }),
    prisma.surveyConfig.count({ where }),
  ]);
  return { items: items.map(toSummaryDto), total };
}

/** E23 — configuração, perguntas e histórico de versões com os textos publicados (RF32). */
export async function getSurvey(
  { prisma, publicAppUrl }: SurveysDeps,
  auth: AuthContext,
  id: string,
): Promise<SurveyDetailDto> {
  return toDetailDto(await findInScope(prisma, auth, id), publicAppUrl);
}

/**
 * E24 — cria a pesquisa em rascunho com a pergunta geral obrigatória (RF25, RN01). Slug repetido
 * → 409; setor fora do escopo → 403; setor inativo → 422. O link de rascunho responde 404.
 */
export async function createSurvey(
  { prisma, publicAppUrl }: SurveysDeps,
  auth: AuthContext,
  audit: AuditContext,
  input: CreateSurveyInput,
): Promise<SurveyDetailDto> {
  try {
    return await prisma.$transaction(async (tx) => {
      await assertTargetSector(tx, auth, input.sectorId);
      const existing = await tx.surveyConfig.findUnique({
        where: { slug: input.slug },
        select: { id: true },
      });
      if (existing !== null) throw slugConflict();

      const created = await tx.surveyConfig.create({
        data: {
          sectorId: input.sectorId,
          title: input.title,
          slug: input.slug,
          introText: input.introText ?? null,
          thankYouMessage: input.thankYouMessage ?? DEFAULT_THANK_YOU_MESSAGE,
          createdById: auth.profileId,
          questions: {
            create: { type: 'nps', text: DEFAULT_NPS_TEXT, isRequired: true, position: 1 },
          },
        },
        select: { id: true },
      });
      await recordAudit(tx, audit, {
        action: 'SURVEY_CREATED',
        entityType: 'survey_config',
        entityId: created.id,
        sectorId: input.sectorId,
        details: { slug: input.slug },
      });
      return toDetailDto(await findInScope(tx, auth, created.id), publicAppUrl);
    });
  } catch (error) {
    if (isUniqueViolation(error, 'survey_configs_slug_key')) throw slugConflict();
    throw error;
  }
}

interface QuestionState {
  id: string | null;
  type: 'nps' | 'scale_1_5';
  isActive: boolean;
}

/**
 * E25 — edição (RF26–RF28, RF31). Textos mudam a qualquer tempo, mas só ficam públicos após
 * publicar; setor, slug e pergunta geral, só antes da primeira publicação (422). Pergunta já
 * publicada não muda texto nem etapa (422 QUESTION_LOCKED); a geral nunca é desativada (422
 * NPS_QUESTION_REQUIRED); no máximo 10 específicas ativas (422 QUESTION_LIMIT_REACHED).
 * Desativar e reativar a pesquisa não apaga respostas nem versões (RN11).
 */
export async function updateSurvey(
  { prisma, clock, publicAppUrl }: SurveysDeps,
  auth: AuthContext,
  audit: AuditContext,
  id: string,
  patch: UpdateSurveyInput,
): Promise<SurveyDetailDto> {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockSurvey(tx, id);
      const survey = await findInScope(tx, auth, id);
      const published = survey.versions.length > 0;
      const changed: string[] = [];
      const data: Prisma.SurveyConfigUncheckedUpdateInput = {};

      if (patch.title !== undefined && patch.title !== survey.title) {
        data.title = patch.title;
        changed.push('title');
      }
      if (patch.introText !== undefined && patch.introText !== survey.introText) {
        data.introText = patch.introText;
        changed.push('introText');
      }
      if (patch.thankYouMessage !== undefined && patch.thankYouMessage !== survey.thankYouMessage) {
        data.thankYouMessage = patch.thankYouMessage;
        changed.push('thankYouMessage');
      }
      if (patch.slug !== undefined && patch.slug !== survey.slug) {
        if (published) throw fieldLocked('slug');
        const taken = await tx.surveyConfig.findUnique({
          where: { slug: patch.slug },
          select: { id: true },
        });
        if (taken !== null) throw slugConflict();
        data.slug = patch.slug;
        changed.push('slug');
      }
      if (patch.sectorId !== undefined && patch.sectorId !== survey.sectorId) {
        if (published) throw fieldLocked('sectorId');
        await assertTargetSector(tx, auth, patch.sectorId);
        data.sectorId = patch.sectorId;
        changed.push('sectorId');
      }

      const nps = survey.questions.find((question) => question.type === 'nps');
      const questionUpdates: { id: string; data: Prisma.QuestionUncheckedUpdateInput }[] = [];
      if (
        patch.npsQuestionText !== undefined &&
        nps !== undefined &&
        patch.npsQuestionText !== nps.text
      ) {
        if (nps.firstPublishedAt !== null) throw fieldLocked('npsQuestionText');
        questionUpdates.push({ id: nps.id, data: { text: patch.npsQuestionText } });
        changed.push('npsQuestionText');
      }

      // Perguntas: estado final em memória para conferir o limite de específicas ativas.
      const state = new Map<string, QuestionState>(
        survey.questions.map((question) => [
          question.id,
          { id: question.id, type: question.type, isActive: question.isActive },
        ]),
      );
      const creations: Prisma.QuestionUncheckedCreateInput[] = [];
      const changes = patch.questions ?? [];
      const stageIds = [...new Set(changes.flatMap((change) => change.journeyStageId ?? []))];
      const stages = new Set(
        (
          await tx.journeyStage.findMany({
            where: { id: { in: stageIds }, hospitalId: auth.hospitalId, isActive: true },
            select: { id: true },
          })
        ).map((stage) => stage.id),
      );
      let nextPosition = Math.max(0, ...survey.questions.map((question) => question.position)) + 1;
      let questionsChanged = false;

      for (const [index, change] of changes.entries()) {
        const field = `questions.${index}`;
        if (change.journeyStageId !== undefined && !stages.has(change.journeyStageId)) {
          throw invalidField(`${field}.journeyStageId`, 'Escolha uma etapa ativa da jornada.');
        }
        if (change.id === undefined) {
          creations.push({
            surveyConfigId: id,
            type: 'scale_1_5',
            isRequired: false,
            text: change.text ?? '',
            journeyStageId: change.journeyStageId ?? null,
            position: change.position ?? nextPosition++,
            isActive: change.isActive ?? true,
          });
          state.set(`nova-${index}`, {
            id: null,
            type: 'scale_1_5',
            isActive: change.isActive ?? true,
          });
          questionsChanged = true;
          continue;
        }

        const current = survey.questions.find((question) => question.id === change.id);
        if (current === undefined) {
          throw invalidField(`${field}.id`, 'A pergunta não pertence a esta pesquisa.');
        }
        const update: Prisma.QuestionUncheckedUpdateInput = {};
        const newText =
          change.text !== undefined && change.text !== current.text ? change.text : undefined;
        const newStageId =
          change.journeyStageId !== undefined && change.journeyStageId !== current.journeyStage?.id
            ? change.journeyStageId
            : undefined;
        const textChanged = newText !== undefined;
        const stageChanged = newStageId !== undefined;
        if (current.type === 'nps') {
          if (change.isActive === false) {
            throw new HttpError(
              422,
              'NPS_QUESTION_REQUIRED',
              'A pergunta geral de 0 a 10 é obrigatória e não pode ser desativada.',
              [{ field: `${field}.isActive`, message: 'A pergunta geral fica sempre ativa.' }],
            );
          }
          if (change.journeyStageId !== undefined) {
            throw invalidField(`${field}.journeyStageId`, 'A pergunta geral não tem etapa.');
          }
        }
        if ((textChanged || stageChanged) && current.firstPublishedAt !== null) {
          throw questionLocked(`${field}.${textChanged ? 'text' : 'journeyStageId'}`);
        }
        if (newText !== undefined) update.text = newText;
        if (newStageId !== undefined) update.journeyStageId = newStageId;
        if (change.position !== undefined && change.position !== current.position) {
          update.position = change.position;
        }
        if (change.isActive !== undefined && change.isActive !== current.isActive) {
          update.isActive = change.isActive;
          state.set(current.id, { id: current.id, type: current.type, isActive: change.isActive });
        }
        if (Object.keys(update).length > 0) {
          questionUpdates.push({ id: current.id, data: update });
          questionsChanged = true;
        }
      }
      if (questionsChanged) changed.push('questions');

      const activeSpecifics = [...state.values()].filter(
        (question) => question.type === 'scale_1_5' && question.isActive,
      ).length;
      if (activeSpecifics > MAX_ACTIVE_SPECIFIC_QUESTIONS) {
        throw new HttpError(
          422,
          'QUESTION_LIMIT_REACHED',
          `A pesquisa pode ter no máximo ${MAX_ACTIVE_SPECIFIC_QUESTIONS} perguntas específicas ativas.`,
          [{ field: 'questions', message: 'Desative outra pergunta antes de incluir esta.' }],
        );
      }

      const contentChanged = changed.length > 0;
      const nextActive = patch.isActive ?? survey.isActive;
      const activeChanged = nextActive !== survey.isActive;
      if (activeChanged) {
        if (nextActive && !survey.sector.isActive) throw sectorInactive();
        data.isActive = nextActive;
        data.deactivatedAt = nextActive ? null : clock.now();
        changed.push('isActive');
      }
      if (!contentChanged && !activeChanged) return toDetailDto(survey, publicAppUrl);

      for (const update of questionUpdates) {
        await tx.question.update({ where: { id: update.id }, data: update.data });
      }
      if (creations.length > 0) await tx.question.createMany({ data: creations });
      await tx.surveyConfig.update({
        where: { id },
        data: {
          ...data,
          ...(contentChanged ? { hasUnpublishedChanges: true } : {}),
          updatedById: auth.profileId,
        },
      });
      await recordAudit(tx, audit, {
        action: activeChanged
          ? nextActive
            ? 'SURVEY_REACTIVATED'
            : 'SURVEY_DEACTIVATED'
          : 'SURVEY_UPDATED',
        entityType: 'survey_config',
        entityId: id,
        sectorId: patch.sectorId ?? survey.sectorId,
        details: { changedFields: changed },
      });
      return toDetailDto(await findInScope(tx, auth, id), publicAppUrl);
    });
  } catch (error) {
    if (isUniqueViolation(error, 'survey_configs_slug_key')) throw slugConflict();
    throw error;
  }
}

/**
 * E26 — publicação (RF29, RN06, RN17): cria a versão seguinte, imutável, com os instantâneos dos
 * textos e das perguntas ativas; a anterior recebe superseded_at e continua aceitando respostas
 * por 24 horas (RN26). Sem alterações → 409 NO_CHANGES_TO_PUBLISH; inativos → 422.
 */
export async function publishSurvey(
  { prisma, clock }: SurveysDeps,
  auth: AuthContext,
  audit: AuditContext,
  id: string,
): Promise<SurveyVersionDto> {
  return prisma.$transaction(async (tx) => {
    await lockSurvey(tx, id);
    const survey = await findInScope(tx, auth, id);
    if (!survey.isActive) {
      throw new HttpError(422, 'SURVEY_INACTIVE', 'Reative a pesquisa antes de publicar.');
    }
    if (!survey.sector.isActive) throw sectorInactive();
    if (survey.currentVersion !== null && !survey.hasUnpublishedChanges) {
      throw new HttpError(
        409,
        'NO_CHANGES_TO_PUBLISH',
        'Não há alterações desde a última publicação.',
      );
    }
    const active = survey.questions.filter((question) => question.isActive);
    const nps = active.find((question) => question.type === 'nps');
    if (nps === undefined) {
      throw new HttpError(422, 'NPS_QUESTION_REQUIRED', 'A pesquisa precisa da pergunta geral.');
    }
    // Ordem pública: pergunta geral e, depois, as específicas por etapa e posição.
    const specifics = active
      .filter((question) => question.type === 'scale_1_5')
      .sort(
        (a, b) =>
          (a.journeyStage?.position ?? 0) - (b.journeyStage?.position ?? 0) ||
          a.position - b.position,
      );
    const now = clock.now();
    const versionNumber = (survey.versions[0]?.versionNumber ?? 0) + 1;

    const version = await tx.surveyVersion.create({
      data: {
        surveyConfigId: id,
        sectorId: survey.sectorId,
        versionNumber,
        title: survey.title,
        introText: survey.introText,
        thankYouMessage: survey.thankYouMessage,
        publishedAt: now,
        publishedById: auth.profileId,
      },
      select: { id: true },
    });
    await tx.surveyVersionQuestion.createMany({
      data: [nps, ...specifics].map((question, index) => ({
        surveyVersionId: version.id,
        questionId: question.id,
        type: question.type,
        text: question.text,
        journeyStageId: question.journeyStage?.id ?? null,
        journeyStageName: question.journeyStage?.name ?? null,
        journeyStagePosition: question.journeyStage?.position ?? null,
        position: index + 1,
        isRequired: question.type === 'nps',
      })),
    });
    await tx.question.updateMany({
      where: { id: { in: active.map((question) => question.id) }, firstPublishedAt: null },
      data: { firstPublishedAt: now },
    });
    if (survey.currentVersion !== null) {
      await tx.surveyVersion.update({
        where: { id: survey.currentVersion.id },
        data: { supersededAt: now },
      });
    }
    await tx.surveyConfig.update({
      where: { id },
      data: {
        currentVersionId: version.id,
        hasUnpublishedChanges: false,
        updatedById: auth.profileId,
      },
    });
    await recordAudit(tx, audit, {
      action: 'SURVEY_PUBLISHED',
      entityType: 'survey_config',
      entityId: id,
      sectorId: survey.sectorId,
      details: { versionNumber, questions: specifics.length + 1 },
    });
    const detail = await findInScope(tx, auth, id);
    const created = toDetailDto(detail, '').versions.find((item) => item.id === version.id);
    if (created === undefined) throw resourceNotFound();
    return created;
  });
}

/** E27 — link e QR Code da versão vigente (RF30); pesquisa sem versão → 409. */
export async function getSurveyLinks(
  { prisma, publicAppUrl }: SurveysDeps,
  auth: AuthContext,
  id: string,
): Promise<SurveyLinks & { slug: string; title: string; sectorName: string }> {
  const survey = await findInScope(prisma, auth, id);
  if (survey.currentVersion === null) {
    throw new HttpError(
      409,
      'SURVEY_NOT_PUBLISHED',
      'Publique a pesquisa antes de gerar o link e o QR Code.',
    );
  }
  return {
    ...surveyLinks(publicAppUrl, survey.slug),
    slug: survey.slug,
    title: survey.title,
    sectorName: survey.sector.name,
  };
}
