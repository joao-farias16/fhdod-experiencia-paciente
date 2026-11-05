/**
 * Acesso a dados das pesquisas: survey_configs, questions, survey_versions e
 * survey_version_questions (publicação imutável).
 */
import { type Queryable, toNumber } from '../../lib/database.js';
import type { QuestionType } from '../../lib/domain-types.js';
import { containsPattern, sql, type SqlStatement } from '../../lib/sql.js';

export interface SurveySummaryRecord {
  id: string;
  sectorId: string;
  title: string;
  slug: string;
  isActive: boolean;
  hasUnpublishedChanges: boolean;
  updatedAt: Date;
  sector: { code: string; name: string; isActive: boolean; hospitalId: string };
  currentVersion: { id: string; versionNumber: number; publishedAt: Date } | null;
  activeSpecificQuestions: number;
}

export interface SurveyQuestionRecord {
  id: string;
  type: QuestionType;
  text: string;
  position: number;
  isRequired: boolean;
  isActive: boolean;
  firstPublishedAt: Date | null;
  journeyStage: { id: string; code: string; name: string; position: number } | null;
}

export interface SurveyVersionRecord {
  id: string;
  versionNumber: number;
  title: string;
  introText: string | null;
  thankYouMessage: string;
  publishedAt: Date;
  supersededAt: Date | null;
  publishedBy: { id: string; fullName: string };
  questions: {
    id: string;
    questionId: string;
    type: QuestionType;
    text: string;
    journeyStageName: string | null;
    position: number;
  }[];
}

export interface SurveyDetailRecord extends SurveySummaryRecord {
  introText: string | null;
  thankYouMessage: string;
  deactivatedAt: Date | null;
  createdAt: Date;
  questions: SurveyQuestionRecord[];
  /** Da mais recente para a mais antiga. */
  versions: SurveyVersionRecord[];
}

interface SummaryRow {
  id: string;
  sector_id: string;
  title: string;
  slug: string;
  is_active: boolean;
  has_unpublished_changes: boolean;
  updated_at: Date;
  intro_text: string | null;
  thank_you_message: string;
  deactivated_at: Date | null;
  created_at: Date;
  sector_code: string;
  sector_name: string;
  sector_is_active: boolean;
  hospital_id: string;
  current_version_id: string | null;
  current_version_number: number | null;
  current_published_at: Date | null;
  active_specific_questions: number;
}

const SUMMARY_SELECT = sql`
  SELECT c.id, c.sector_id, c.title, c.slug, c.is_active, c.has_unpublished_changes, c.updated_at,
         c.intro_text, c.thank_you_message, c.deactivated_at, c.created_at,
         s.code AS sector_code, s.name AS sector_name, s.is_active AS sector_is_active, s.hospital_id,
         v.id AS current_version_id, v.version_number AS current_version_number,
         v.published_at AS current_published_at,
         (SELECT COUNT(*) FROM questions q
          WHERE q.survey_config_id = c.id AND q.is_active AND q.type = 'scale_1_5') AS active_specific_questions
  FROM survey_configs c
  JOIN sectors s ON s.id = c.sector_id
  LEFT JOIN survey_versions v ON v.id = c.current_version_id`;

function toSummary(row: SummaryRow): SurveySummaryRecord {
  return {
    id: row.id,
    sectorId: row.sector_id,
    title: row.title,
    slug: row.slug,
    isActive: row.is_active,
    hasUnpublishedChanges: row.has_unpublished_changes,
    updatedAt: row.updated_at,
    sector: {
      code: row.sector_code,
      name: row.sector_name,
      isActive: row.sector_is_active,
      hospitalId: row.hospital_id,
    },
    currentVersion:
      row.current_version_id === null ||
      row.current_version_number === null ||
      row.current_published_at === null
        ? null
        : {
            id: row.current_version_id,
            versionNumber: row.current_version_number,
            publishedAt: row.current_published_at,
          },
    activeSpecificQuestions: toNumber(row.active_specific_questions),
  };
}

export interface SurveyListFilters {
  hospitalId: string;
  sectorIds: readonly string[] | undefined;
  status?: 'draft' | 'active' | 'inactive' | undefined;
  search?: string | undefined;
  offset: number;
  limit: number;
}

/** E22 — pesquisas do escopo por setor e título, com a situação calculada. */
export async function listSurveySummaries(
  db: Queryable,
  filters: SurveyListFilters,
): Promise<{ items: SurveySummaryRecord[]; total: number }> {
  if (filters.sectorIds?.length === 0) return { items: [], total: 0 };
  const conditions: SqlStatement[] = [sql`s.hospital_id = ${filters.hospitalId}`];
  if (filters.sectorIds !== undefined) {
    conditions.push(sql`c.sector_id IN (${sql.list(filters.sectorIds)})`);
  }
  if (filters.status === 'inactive') conditions.push(sql`NOT c.is_active`);
  if (filters.status === 'draft')
    conditions.push(sql`c.is_active AND c.current_version_id IS NULL`);
  if (filters.status === 'active') {
    conditions.push(sql`c.is_active AND c.current_version_id IS NOT NULL`);
  }
  if (filters.search !== undefined) {
    const pattern = containsPattern(filters.search.toLowerCase());
    conditions.push(sql`(LOWER(c.title) LIKE ${pattern} OR LOWER(c.slug) LIKE ${pattern})`);
  }
  const where = sql.join(conditions, ' AND ');
  const [rows, totals] = await Promise.all([
    db.query<SummaryRow>(sql`
      ${SUMMARY_SELECT}
      WHERE ${where}
      ORDER BY s.name, c.title, c.id
      LIMIT ${filters.limit} OFFSET ${filters.offset}`),
    db.query<{ total: number }>(sql`
      SELECT COUNT(*) AS total FROM survey_configs c JOIN sectors s ON s.id = c.sector_id
      WHERE ${where}`),
  ]);
  return { items: rows.map(toSummary), total: toNumber(totals[0]?.total ?? 0) };
}

/** Configuração, perguntas e histórico de versões (E23). */
export async function findSurveyDetail(
  db: Queryable,
  id: string,
): Promise<SurveyDetailRecord | null> {
  const [row] = await db.query<SummaryRow>(sql`${SUMMARY_SELECT} WHERE c.id = ${id}`);
  if (row === undefined) return null;

  const [questions, versions, versionQuestions] = await Promise.all([
    db.query<{
      id: string;
      type: QuestionType;
      text: string;
      position: number;
      is_required: boolean;
      is_active: boolean;
      first_published_at: Date | null;
      stage_id: string | null;
      stage_code: string | null;
      stage_name: string | null;
      stage_position: number | null;
    }>(sql`
      SELECT q.id, q.type, q.text, q.position, q.is_required, q.is_active, q.first_published_at,
             j.id AS stage_id, j.code AS stage_code, j.name AS stage_name, j.position AS stage_position
      FROM questions q LEFT JOIN journey_stages j ON j.id = q.journey_stage_id
      WHERE q.survey_config_id = ${id}
      ORDER BY q.position, q.created_at, q.id`),
    db.query<{
      id: string;
      version_number: number;
      title: string;
      intro_text: string | null;
      thank_you_message: string;
      published_at: Date;
      superseded_at: Date | null;
      published_by: string;
      published_by_name: string;
    }>(sql`
      SELECT v.id, v.version_number, v.title, v.intro_text, v.thank_you_message, v.published_at,
             v.superseded_at, v.published_by, p.full_name AS published_by_name
      FROM survey_versions v JOIN profiles p ON p.id = v.published_by
      WHERE v.survey_config_id = ${id}
      ORDER BY v.version_number DESC`),
    db.query<{
      id: string;
      survey_version_id: string;
      question_id: string;
      type: QuestionType;
      text: string;
      journey_stage_name: string | null;
      position: number;
    }>(sql`
      SELECT svq.id, svq.survey_version_id, svq.question_id, svq.type, svq.text,
             svq.journey_stage_name, svq.position
      FROM survey_version_questions svq JOIN survey_versions v ON v.id = svq.survey_version_id
      WHERE v.survey_config_id = ${id}
      ORDER BY svq.position`),
  ]);

  return {
    ...toSummary(row),
    introText: row.intro_text,
    thankYouMessage: row.thank_you_message,
    deactivatedAt: row.deactivated_at,
    createdAt: row.created_at,
    questions: questions.map((question) => ({
      id: question.id,
      type: question.type,
      text: question.text,
      position: question.position,
      isRequired: question.is_required,
      isActive: question.is_active,
      firstPublishedAt: question.first_published_at,
      journeyStage:
        question.stage_id === null ||
        question.stage_code === null ||
        question.stage_name === null ||
        question.stage_position === null
          ? null
          : {
              id: question.stage_id,
              code: question.stage_code,
              name: question.stage_name,
              position: question.stage_position,
            },
    })),
    versions: versions.map((version) => ({
      id: version.id,
      versionNumber: version.version_number,
      title: version.title,
      introText: version.intro_text,
      thankYouMessage: version.thank_you_message,
      publishedAt: version.published_at,
      supersededAt: version.superseded_at,
      publishedBy: { id: version.published_by, fullName: version.published_by_name },
      questions: versionQuestions
        .filter((question) => question.survey_version_id === version.id)
        .map((question) => ({
          id: question.id,
          questionId: question.question_id,
          type: question.type,
          text: question.text,
          journeyStageName: question.journey_stage_name,
          position: question.position,
        })),
    })),
  };
}

/** Bloqueia a pesquisa (edição e publicação concorrentes). */
export async function lockSurvey(db: Queryable, id: string): Promise<void> {
  await db.query(sql`SELECT id FROM survey_configs WHERE id = ${id} FOR UPDATE`);
}

export async function findSurveyIdBySlug(db: Queryable, slug: string): Promise<string | null> {
  const [row] = await db.query<{ id: string }>(sql`
    SELECT id FROM survey_configs WHERE slug = ${slug}`);
  return row?.id ?? null;
}

export async function insertSurvey(
  db: Queryable,
  data: {
    id: string;
    sectorId: string;
    title: string;
    slug: string;
    introText: string | null;
    thankYouMessage: string;
    createdById: string;
  },
): Promise<void> {
  await db.execute(sql`
    INSERT INTO survey_configs (id, sector_id, title, slug, intro_text, thank_you_message, created_by)
    VALUES (${data.id}, ${data.sectorId}, ${data.title}, ${data.slug}, ${data.introText},
            ${data.thankYouMessage}, ${data.createdById})`);
}

export interface QuestionInsert {
  id: string;
  surveyConfigId: string;
  type: QuestionType;
  text: string;
  journeyStageId: string | null;
  isRequired: boolean;
  position: number;
  isActive: boolean;
}

export async function insertQuestions(
  db: Queryable,
  questions: readonly QuestionInsert[],
): Promise<void> {
  if (questions.length === 0) return;
  const rows = questions.map(
    (question) =>
      sql`(${question.id}, ${question.surveyConfigId}, ${question.type}, ${question.text},
           ${question.journeyStageId}, ${question.isRequired}, ${question.position}, ${question.isActive})`,
  );
  await db.execute(sql`
    INSERT INTO questions
      (id, survey_config_id, type, text, journey_stage_id, is_required, position, is_active)
    VALUES ${sql.join(rows, ', ')}`);
}

export interface QuestionChanges {
  text?: string;
  journeyStageId?: string;
  position?: number;
  isActive?: boolean;
}

export async function updateQuestion(
  db: Queryable,
  id: string,
  changes: QuestionChanges,
): Promise<void> {
  const sets: SqlStatement[] = [];
  if (changes.text !== undefined) sets.push(sql`text = ${changes.text}`);
  if (changes.journeyStageId !== undefined) {
    sets.push(sql`journey_stage_id = ${changes.journeyStageId}`);
  }
  if (changes.position !== undefined) sets.push(sql`position = ${changes.position}`);
  if (changes.isActive !== undefined) sets.push(sql`is_active = ${changes.isActive}`);
  if (sets.length === 0) return;
  await db.execute(sql`UPDATE questions SET ${sql.join(sets, ', ')} WHERE id = ${id}`);
}

export interface SurveyChanges {
  title?: string;
  introText?: string | null;
  thankYouMessage?: string;
  slug?: string;
  sectorId?: string;
  isActive?: boolean;
  deactivatedAt?: Date | null;
  hasUnpublishedChanges?: boolean;
  currentVersionId?: string;
  updatedById: string;
}

export async function updateSurveyRow(
  db: Queryable,
  id: string,
  changes: SurveyChanges,
): Promise<void> {
  const sets: SqlStatement[] = [sql`updated_by = ${changes.updatedById}`];
  if (changes.title !== undefined) sets.push(sql`title = ${changes.title}`);
  if (changes.introText !== undefined) sets.push(sql`intro_text = ${changes.introText}`);
  if (changes.thankYouMessage !== undefined) {
    sets.push(sql`thank_you_message = ${changes.thankYouMessage}`);
  }
  if (changes.slug !== undefined) sets.push(sql`slug = ${changes.slug}`);
  if (changes.sectorId !== undefined) sets.push(sql`sector_id = ${changes.sectorId}`);
  if (changes.isActive !== undefined) sets.push(sql`is_active = ${changes.isActive}`);
  if (changes.deactivatedAt !== undefined) {
    sets.push(sql`deactivated_at = ${changes.deactivatedAt}`);
  }
  if (changes.hasUnpublishedChanges !== undefined) {
    sets.push(sql`has_unpublished_changes = ${changes.hasUnpublishedChanges}`);
  }
  if (changes.currentVersionId !== undefined) {
    sets.push(sql`current_version_id = ${changes.currentVersionId}`);
  }
  // updated_at explícito: muda mesmo quando só updated_by é regravado com o mesmo valor.
  sets.push(sql`updated_at = CURRENT_TIMESTAMP(3)`);
  await db.execute(sql`UPDATE survey_configs SET ${sql.join(sets, ', ')} WHERE id = ${id}`);
}

export async function insertSurveyVersion(
  db: Queryable,
  data: {
    id: string;
    surveyConfigId: string;
    sectorId: string;
    versionNumber: number;
    title: string;
    introText: string | null;
    thankYouMessage: string;
    publishedAt: Date;
    publishedById: string;
  },
): Promise<void> {
  await db.execute(sql`
    INSERT INTO survey_versions
      (id, survey_config_id, sector_id, version_number, title, intro_text, thank_you_message,
       published_at, published_by)
    VALUES (${data.id}, ${data.surveyConfigId}, ${data.sectorId}, ${data.versionNumber},
            ${data.title}, ${data.introText}, ${data.thankYouMessage}, ${data.publishedAt},
            ${data.publishedById})`);
}

export interface VersionQuestionInsert {
  id: string;
  surveyVersionId: string;
  questionId: string;
  type: QuestionType;
  text: string;
  journeyStageId: string | null;
  journeyStageName: string | null;
  journeyStagePosition: number | null;
  position: number;
  isRequired: boolean;
}

export async function insertVersionQuestions(
  db: Queryable,
  questions: readonly VersionQuestionInsert[],
): Promise<void> {
  if (questions.length === 0) return;
  const rows = questions.map(
    (question) =>
      sql`(${question.id}, ${question.surveyVersionId}, ${question.questionId}, ${question.type},
           ${question.text}, ${question.journeyStageId}, ${question.journeyStageName},
           ${question.journeyStagePosition}, ${question.position}, ${question.isRequired})`,
  );
  await db.execute(sql`
    INSERT INTO survey_version_questions
      (id, survey_version_id, question_id, type, text, journey_stage_id, journey_stage_name,
       journey_stage_position, position, is_required)
    VALUES ${sql.join(rows, ', ')}`);
}

/** Marca a primeira publicação das perguntas (texto, tipo e etapa ficam bloqueados, RN17). */
export async function markQuestionsPublished(
  db: Queryable,
  questionIds: readonly string[],
  at: Date,
): Promise<void> {
  if (questionIds.length === 0) return;
  await db.execute(sql`
    UPDATE questions SET first_published_at = ${at}
    WHERE id IN (${sql.list(questionIds)}) AND first_published_at IS NULL`);
}

export async function supersedeVersion(db: Queryable, id: string, at: Date): Promise<void> {
  await db.execute(sql`UPDATE survey_versions SET superseded_at = ${at} WHERE id = ${id}`);
}

/** Setor e hospital da pesquisa (validação de escopo dos filtros do dashboard). */
export async function findSurveyScope(
  db: Queryable,
  id: string,
): Promise<{ sectorId: string; hospitalId: string; title: string } | null> {
  const [row] = await db.query<{ sector_id: string; hospital_id: string; title: string }>(sql`
    SELECT c.sector_id, s.hospital_id, c.title
    FROM survey_configs c JOIN sectors s ON s.id = c.sector_id
    WHERE c.id = ${id}`);
  return row === undefined
    ? null
    : { sectorId: row.sector_id, hospitalId: row.hospital_id, title: row.title };
}
