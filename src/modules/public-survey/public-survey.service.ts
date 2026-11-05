import { randomUUID } from 'node:crypto';

import type { Database, Queryable } from '../../lib/database.js';
import type { Clock } from '../../utils/dates.js';
import { HttpError, isUniqueViolation } from '../../utils/errors.js';
import {
  canonicalHash,
  idempotencyKeyReused,
  manifestationToken,
} from '../../utils/idempotency.js';
import { invalidField } from '../../utils/validation.js';
import { isLowScore } from '../dashboard/nps.js';
import { attributeResponse } from './attribution.js';
import {
  findPublicSurvey,
  findResponseByIdempotencyKey,
  findVersionForSubmission,
  insertResponse,
  insertResponseAnswers,
  type StoredResponse,
} from './public-survey.repository.js';
import type { SubmitResponseInput } from './public-survey.schemas.js';

/** RN26: versão substituída aceita respostas por 24 horas. */
export const OUTDATED_VERSION_GRACE_MS = 24 * 60 * 60 * 1000;
/** RN22: o token de manifestação vale 60 minutos. */
export const MANIFESTATION_TOKEN_TTL_MS = 60 * 60 * 1000;

/** Textos padrão das âncoras e da escala (Seção 4.3). */
export const NPS_ANCHORS = { min: '0 = Nada provável', max: '10 = Extremamente provável' };
export const SCALE_LABELS = ['Muito ruim', 'Ruim', 'Regular', 'Bom', 'Muito bom'] as const;

export interface PublicSurveyDto {
  surveyVersionId: string;
  versionNumber: number;
  slug: string;
  title: string;
  introText: string | null;
  thankYouMessage: string;
  sectorName: string;
  npsQuestion: { id: string; text: string; anchors: typeof NPS_ANCHORS };
  /** Etapas da jornada com as perguntas específicas opcionais, na ordem publicada. */
  stages: { name: string; position: number; questions: { id: string; text: string }[] }[];
  scaleLabels: readonly string[];
}

export interface SubmittedResponseDto {
  responseId: string;
  submittedAt: string;
  lowScore: boolean;
  manifestation: { token: string; expiresAt: string };
}

export function surveyNotFound(): HttpError {
  return new HttpError(404, 'NOT_FOUND', 'Pesquisa não encontrada. Confira o endereço.');
}

export function surveyUnavailable(): HttpError {
  return new HttpError(
    410,
    'SURVEY_UNAVAILABLE',
    'Esta pesquisa não está disponível no momento. Obrigado pelo interesse.',
  );
}

/**
 * E01 — versão vigente da pesquisa por etapas (RF33). Rascunho ou inexistente → 404; pesquisa ou
 * setor inativo → 410. Somente os textos públicos da versão: nada de identificadores internos de
 * setor, equipe, turno ou usuários.
 */
export async function getPublicSurvey(db: Queryable, slug: string): Promise<PublicSurveyDto> {
  const survey = await findPublicSurvey(db, slug);
  const version = survey?.version;
  if (survey === null || version === null || version === undefined) throw surveyNotFound();
  if (!survey.isActive || !survey.sectorIsActive) throw surveyUnavailable();

  const nps = version.questions.find((question) => question.type === 'nps');
  if (nps === undefined) throw surveyNotFound();
  const stages: PublicSurveyDto['stages'] = [];
  for (const question of version.questions) {
    if (question.type !== 'scale_1_5') continue;
    const position = question.journeyStagePosition ?? 0;
    let stage = stages.find((item) => item.position === position);
    if (stage === undefined) {
      stage = { name: question.journeyStageName ?? '', position, questions: [] };
      stages.push(stage);
    }
    stage.questions.push({ id: question.questionId, text: question.text });
  }
  stages.sort((a, b) => a.position - b.position);

  return {
    surveyVersionId: version.id,
    versionNumber: version.versionNumber,
    slug: survey.slug,
    title: version.title,
    introText: version.introText,
    thankYouMessage: version.thankYouMessage,
    sectorName: survey.sectorName,
    npsQuestion: { id: nps.questionId, text: nps.text, anchors: NPS_ANCHORS },
    stages,
    scaleLabels: SCALE_LABELS,
  };
}

/** Corpo canônico do request_hash: respostas ordenadas por pergunta (Seção 4.3). */
function hashOf(input: SubmitResponseInput): string {
  return canonicalHash({
    surveyVersionId: input.surveyVersionId,
    origin: input.origin,
    npsScore: input.npsScore,
    answers: [...input.answers].sort((a, b) =>
      a.questionId < b.questionId ? -1 : a.questionId > b.questionId ? 1 : 0,
    ),
  });
}

function toSubmittedDto(stored: StoredResponse, tokenSecret: string): SubmittedResponseDto {
  return {
    responseId: stored.id,
    submittedAt: stored.submittedAt.toISOString(),
    lowScore: stored.lowScore,
    manifestation: {
      token: manifestationToken(tokenSecret, stored.id),
      expiresAt: stored.manifestationTokenExpiresAt.toISOString(),
    },
  };
}

export type SubmitResult = { replayed: boolean; data: SubmittedResponseDto };

/** Mesma chave: mesmo conteúdo → registro original (200); conteúdo diferente → 409 (RN13). */
function replay(stored: StoredResponse, requestHash: string, tokenSecret: string): SubmitResult {
  if (stored.requestHash !== requestHash) throw idempotencyKeyReused();
  return { replayed: true, data: toSubmittedDto(stored, tokenSecret) };
}

export interface PublicSurveyDeps {
  db: Database;
  clock: Clock;
  manifestationTokenSecret: string;
}

/**
 * E02 — registro da avaliação (RF37, RN01, RN02, RN06, RN13, RN14, RN26). Valida versão, perguntas
 * e notas no backend; grava responses e response_answers numa transação com a atribuição a turno e
 * equipe (RF24), que nunca impede o registro. O sucesso só é devolvido após o COMMIT; a restrição
 * UNIQUE de idempotency_key resolve envios concorrentes com a mesma chave.
 */
export async function submitResponse(
  { db, clock, manifestationTokenSecret }: PublicSurveyDeps,
  idempotencyKey: string,
  input: SubmitResponseInput,
): Promise<SubmitResult> {
  const requestHash = hashOf(input);
  const previous = await findResponseByIdempotencyKey(db, idempotencyKey);
  if (previous !== null) return replay(previous, requestHash, manifestationTokenSecret);

  const version = await findVersionForSubmission(db, input.surveyVersionId);
  if (version === null) throw surveyNotFound();
  if (!version.surveyIsActive || !version.sectorIsActive) {
    throw surveyUnavailable();
  }
  const now = clock.now();
  if (
    version.currentVersionId !== version.id &&
    (version.supersededAt === null ||
      now.getTime() - version.supersededAt.getTime() > OUTDATED_VERSION_GRACE_MS)
  ) {
    throw new HttpError(
      409,
      'SURVEY_VERSION_OUTDATED',
      'Esta pesquisa foi atualizada. Recarregue a página para responder a versão nova.',
    );
  }

  // RF35: cada nota específica deve ser de uma pergunta específica DESTA versão.
  const answers = input.answers.map((answer, index) => {
    const question = version.questions.find(
      (item) => item.questionId === answer.questionId && item.type === 'scale_1_5',
    );
    if (question === undefined) {
      throw invalidField(
        `answers.${index}.questionId`,
        'A pergunta não pertence a esta versão da pesquisa.',
      );
    }
    return { id: randomUUID(), surveyVersionQuestionId: question.id, score: answer.score };
  });
  const lowScore = isLowScore(
    input.npsScore,
    answers.map((answer) => answer.score),
  );

  try {
    const stored = await db.transaction(async (tx): Promise<StoredResponse> => {
      const attribution = await attributeResponse(tx, version.sectorId, input.origin, now);
      const response: StoredResponse = {
        id: randomUUID(),
        submittedAt: now,
        lowScore,
        requestHash,
        manifestationTokenExpiresAt: new Date(now.getTime() + MANIFESTATION_TOKEN_TTL_MS),
      };
      const attributed = attribution.status === 'attributed' ? attribution : null;
      await insertResponse(tx, {
        id: response.id,
        surveyVersionId: version.id,
        sectorId: version.sectorId,
        origin: input.origin,
        npsScore: input.npsScore,
        lowScore,
        submittedAt: now,
        attributionStatus: attribution.status,
        shiftId: attributed?.shiftId ?? null,
        teamId: attributed?.teamId ?? null,
        shiftPeriod: attributed?.period ?? null,
        idempotencyKey,
        requestHash,
        manifestationTokenExpiresAt: response.manifestationTokenExpiresAt,
      });
      await insertResponseAnswers(tx, response.id, version.id, answers);
      return response;
    });
    return { replayed: false, data: toSubmittedDto(stored, manifestationTokenSecret) };
  } catch (error) {
    // Envio concorrente com a mesma chave: o primeiro COMMIT vence; os demais repetem o original.
    if (!isUniqueViolation(error, 'responses_idempotency_key_key')) throw error;
    const winner = await findResponseByIdempotencyKey(db, idempotencyKey);
    if (winner === null) throw error;
    return replay(winner, requestHash, manifestationTokenSecret);
  }
}
