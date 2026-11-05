/** Acesso a dados da pesquisa pública: versão vigente, envio de respostas e atribuição a turno. */
import type { Queryable } from '../../lib/database.js';
import type {
  AttributionStatus,
  QuestionType,
  ResponseOrigin,
  ShiftPeriod,
} from '../../lib/domain-types.js';
import { sql } from '../../lib/sql.js';

export interface PublicVersionRecord {
  slug: string;
  isActive: boolean;
  sectorName: string;
  sectorIsActive: boolean;
  version: {
    id: string;
    versionNumber: number;
    title: string;
    introText: string | null;
    thankYouMessage: string;
    questions: {
      questionId: string;
      type: QuestionType;
      text: string;
      journeyStageName: string | null;
      journeyStagePosition: number | null;
    }[];
  } | null;
}

/** Pesquisa pelo slug com a versão vigente e as perguntas publicadas (E01). */
export async function findPublicSurvey(
  db: Queryable,
  slug: string,
): Promise<PublicVersionRecord | null> {
  const [row] = await db.query<{
    slug: string;
    is_active: boolean;
    sector_name: string;
    sector_is_active: boolean;
    version_id: string | null;
    version_number: number | null;
    title: string | null;
    intro_text: string | null;
    thank_you_message: string | null;
  }>(sql`
    SELECT c.slug, c.is_active, s.name AS sector_name, s.is_active AS sector_is_active,
           v.id AS version_id, v.version_number, v.title, v.intro_text, v.thank_you_message
    FROM survey_configs c
    JOIN sectors s ON s.id = c.sector_id
    LEFT JOIN survey_versions v ON v.id = c.current_version_id
    WHERE c.slug = ${slug}`);
  if (row === undefined) return null;
  const base = {
    slug: row.slug,
    isActive: row.is_active,
    sectorName: row.sector_name,
    sectorIsActive: row.sector_is_active,
  };
  if (
    row.version_id === null ||
    row.version_number === null ||
    row.title === null ||
    row.thank_you_message === null
  ) {
    return { ...base, version: null };
  }
  const questions = await db.query<{
    question_id: string;
    type: QuestionType;
    text: string;
    journey_stage_name: string | null;
    journey_stage_position: number | null;
  }>(sql`
    SELECT question_id, type, text, journey_stage_name, journey_stage_position
    FROM survey_version_questions WHERE survey_version_id = ${row.version_id}
    ORDER BY position`);
  return {
    ...base,
    version: {
      id: row.version_id,
      versionNumber: row.version_number,
      title: row.title,
      introText: row.intro_text,
      thankYouMessage: row.thank_you_message,
      questions: questions.map((question) => ({
        questionId: question.question_id,
        type: question.type,
        text: question.text,
        journeyStageName: question.journey_stage_name,
        journeyStagePosition: question.journey_stage_position,
      })),
    },
  };
}

export interface StoredResponse {
  id: string;
  submittedAt: Date;
  lowScore: boolean;
  requestHash: string;
  manifestationTokenExpiresAt: Date;
}

export async function findResponseByIdempotencyKey(
  db: Queryable,
  idempotencyKey: string,
): Promise<StoredResponse | null> {
  const [row] = await db.query<{
    id: string;
    submitted_at: Date;
    low_score: boolean;
    request_hash: string;
    manifestation_token_expires_at: Date;
  }>(sql`
    SELECT id, submitted_at, low_score, request_hash, manifestation_token_expires_at
    FROM responses WHERE idempotency_key = ${idempotencyKey}`);
  return row === undefined
    ? null
    : {
        id: row.id,
        submittedAt: row.submitted_at,
        lowScore: row.low_score,
        requestHash: row.request_hash,
        manifestationTokenExpiresAt: row.manifestation_token_expires_at,
      };
}

export interface VersionForSubmission {
  id: string;
  sectorId: string;
  supersededAt: Date | null;
  surveyIsActive: boolean;
  currentVersionId: string | null;
  sectorIsActive: boolean;
  questions: { id: string; questionId: string; type: QuestionType }[];
}

export async function findVersionForSubmission(
  db: Queryable,
  versionId: string,
): Promise<VersionForSubmission | null> {
  const [row] = await db.query<{
    id: string;
    sector_id: string;
    superseded_at: Date | null;
    survey_is_active: boolean;
    current_version_id: string | null;
    sector_is_active: boolean;
  }>(sql`
    SELECT v.id, v.sector_id, v.superseded_at, c.is_active AS survey_is_active,
           c.current_version_id, s.is_active AS sector_is_active
    FROM survey_versions v
    JOIN survey_configs c ON c.id = v.survey_config_id
    JOIN sectors s ON s.id = c.sector_id
    WHERE v.id = ${versionId}`);
  if (row === undefined) return null;
  const questions = await db.query<{ id: string; question_id: string; type: QuestionType }>(sql`
    SELECT id, question_id, type FROM survey_version_questions WHERE survey_version_id = ${versionId}`);
  return {
    id: row.id,
    sectorId: row.sector_id,
    supersededAt: row.superseded_at,
    surveyIsActive: row.survey_is_active,
    currentVersionId: row.current_version_id,
    sectorIsActive: row.sector_is_active,
    questions: questions.map((question) => ({
      id: question.id,
      questionId: question.question_id,
      type: question.type,
    })),
  };
}

/**
 * Até dois turnos NÃO cancelados do setor, de equipe ativa, contendo o instante (starts_at <=
 * instante < ends_at). LIMIT 2 distingue nenhum, um ou vários (Seção 8).
 */
export async function findShiftsAt(
  db: Queryable,
  sectorId: string,
  at: Date,
): Promise<{ id: string; teamId: string; period: ShiftPeriod }[]> {
  const rows = await db.query<{ id: string; team_id: string; period: ShiftPeriod }>(sql`
    SELECT sh.id, sh.team_id, sh.period
    FROM shifts sh JOIN teams t ON t.id = sh.team_id
    WHERE sh.sector_id = ${sectorId} AND sh.cancelled_at IS NULL
      AND sh.starts_at <= ${at} AND sh.ends_at > ${at} AND t.is_active
    LIMIT 2`);
  return rows.map((row) => ({ id: row.id, teamId: row.team_id, period: row.period }));
}

export interface ResponseInsert {
  id: string;
  surveyVersionId: string;
  sectorId: string;
  origin: ResponseOrigin;
  npsScore: number;
  lowScore: boolean;
  submittedAt: Date;
  attributionStatus: AttributionStatus;
  shiftId: string | null;
  teamId: string | null;
  shiftPeriod: ShiftPeriod | null;
  idempotencyKey: string;
  requestHash: string;
  manifestationTokenExpiresAt: Date;
}

export async function insertResponse(db: Queryable, data: ResponseInsert): Promise<void> {
  await db.execute(sql`
    INSERT INTO responses
      (id, survey_version_id, sector_id, origin, nps_score, low_score, submitted_at,
       attribution_status, shift_id, team_id, shift_period, idempotency_key, request_hash,
       manifestation_token_expires_at)
    VALUES (${data.id}, ${data.surveyVersionId}, ${data.sectorId}, ${data.origin}, ${data.npsScore},
            ${data.lowScore}, ${data.submittedAt}, ${data.attributionStatus}, ${data.shiftId},
            ${data.teamId}, ${data.shiftPeriod}, ${data.idempotencyKey}, ${data.requestHash},
            ${data.manifestationTokenExpiresAt})`);
}

export async function insertResponseAnswers(
  db: Queryable,
  responseId: string,
  surveyVersionId: string,
  answers: readonly { id: string; surveyVersionQuestionId: string; score: number }[],
): Promise<void> {
  if (answers.length === 0) return;
  const rows = answers.map(
    (answer) =>
      sql`(${answer.id}, ${responseId}, ${surveyVersionId}, ${answer.surveyVersionQuestionId},
           'scale_1_5', ${answer.score})`,
  );
  await db.execute(sql`
    INSERT INTO response_answers
      (id, response_id, survey_version_id, survey_version_question_id, question_type, score)
    VALUES ${sql.join(rows, ', ')}`);
}
