/**
 * Apoio aos testes com PostgreSQL real: conexão, transação desfeita ao final, captura de erros do
 * banco com SAVEPOINT e um cenário mínimo válido (fixture) criado com SQL puro.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import pg from 'pg';
import { expect } from 'vitest';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export type Db = pg.Client;

/** Erro do PostgreSQL com os campos usados nas verificações. */
export interface PgError extends Error {
  code: string;
  constraint?: string;
  table?: string;
  detail?: string;
}

export async function connect(url = process.env.TEST_DATABASE_URL): Promise<Db> {
  if (url === undefined || url === '') throw new Error('TEST_DATABASE_URL não definida.');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

/** Executa o corpo numa transação que é sempre desfeita (ROLLBACK). */
export async function inRollback<T>(db: Db, body: () => Promise<T>): Promise<T> {
  await db.query('BEGIN');
  try {
    return await body();
  } finally {
    await db.query('ROLLBACK');
  }
}

/**
 * Executa um comando que DEVE falhar no banco. Usa SAVEPOINT para que a transação continue
 * utilizável depois do erro e devolve o erro do PostgreSQL para as verificações.
 */
export async function expectDbError(
  db: Db,
  sql: string,
  params: unknown[] = [],
  expected: { code: string; constraint?: string | RegExp },
): Promise<PgError> {
  await db.query('SAVEPOINT tentativa_invalida');
  let error: PgError | undefined;
  try {
    await db.query(sql, params);
  } catch (caught) {
    error = caught as PgError;
  }
  await db.query('ROLLBACK TO SAVEPOINT tentativa_invalida');
  if (error === undefined) {
    throw new Error(`O banco aceitou uma operação inválida: ${sql}`);
  }
  expect(error.code).toBe(expected.code);
  if (expected.constraint instanceof RegExp) {
    expect(error.constraint).toMatch(expected.constraint);
  } else if (expected.constraint !== undefined) {
    expect(error.constraint).toBe(expected.constraint);
  }
  return error;
}

export async function count(db: Db, sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await db.query<{ count: string }>(sql, params);
  return Number(rows[0]?.count);
}

async function insertId(db: Db, sql: string, params: unknown[]): Promise<string> {
  const { rows } = await db.query<{ id: string }>(sql, params);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`Inserção sem id: ${sql}`);
  return id;
}

/** SHA-256 fictício (64 dígitos hexadecimais) para colunas request_hash. */
export const HASH = 'a'.repeat(64);

/** Instante de referência dos cenários (UTC). */
export const T0 = '2026-09-01T10:00:00Z';

/**
 * Cenário mínimo válido: hospital, superadministrador, dois setores (A e B) com equipes, uma
 * pesquisa do setor A com versões v1 e v2 (cada uma com pergunta geral e uma específica), uma
 * pesquisa do setor B com v1, um turno da equipe A1 (07:00–13:00 locais) e uma resposta da v1.
 */
export async function createFixture(db: Db) {
  const suffix = Math.random().toString(36).slice(2, 8);
  const hospitalId = await insertId(
    db,
    "INSERT INTO hospitals (name, short_name) VALUES ('Hospital de Teste', $1) RETURNING id",
    [`TESTE-${suffix}`],
  );
  const adminId = await insertId(
    db,
    `INSERT INTO profiles (hospital_id, auth_user_id, full_name, email, role, all_sectors, must_change_password)
     VALUES ($1, gen_random_uuid(), 'Administrador de Teste', $2, 'superadmin', true, false) RETURNING id`,
    [hospitalId, `sa.${suffix}@example.com`],
  );
  const stageId = await insertId(
    db,
    "INSERT INTO journey_stages (hospital_id, code, name, position) VALUES ($1, 'RECEPCAO', 'Recepção', 1) RETURNING id",
    [hospitalId],
  );
  const sector = (code: string, name: string) =>
    insertId(db, 'INSERT INTO sectors (hospital_id, code, name) VALUES ($1, $2, $3) RETURNING id', [
      hospitalId,
      code,
      name,
    ]);
  const sectorA = await sector('SETOR-A', 'Setor A');
  const sectorB = await sector('SETOR-B', 'Setor B');
  const team = (sectorId: string, code: string) =>
    insertId(db, 'INSERT INTO teams (sector_id, code, name) VALUES ($1, $2, $2) RETURNING id', [
      sectorId,
      code,
    ]);
  const teamA1 = await team(sectorA, 'A1');
  const teamA2 = await team(sectorA, 'A2');
  const teamB1 = await team(sectorB, 'B1');

  const survey = (sectorId: string, slug: string) =>
    insertId(
      db,
      `INSERT INTO survey_configs (sector_id, title, slug, thank_you_message, created_by)
       VALUES ($1, 'Pesquisa de teste', $2, 'Obrigado.', $3) RETURNING id`,
      [sectorId, `${slug}-${suffix}`, adminId],
    );
  const surveyA = await survey(sectorA, 'pesquisa-a');
  const surveyB = await survey(sectorB, 'pesquisa-b');

  const question = (surveyId: string, type: 'nps' | 'scale_1_5', position: number) =>
    insertId(
      db,
      `INSERT INTO questions (survey_config_id, journey_stage_id, type, text, is_required, position, first_published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        surveyId,
        type === 'nps' ? null : stageId,
        type,
        type === 'nps' ? 'Pergunta geral de teste?' : `Pergunta específica ${position}?`,
        type === 'nps',
        position,
        '2026-08-01T00:00:00Z',
      ],
    );
  const npsA = await question(surveyA, 'nps', 1);
  const specificA = await question(surveyA, 'scale_1_5', 2);
  const npsB = await question(surveyB, 'nps', 1);
  const specificB = await question(surveyB, 'scale_1_5', 2);

  const version = (surveyId: string, sectorId: string, number: number, publishedAt: string) =>
    insertId(
      db,
      `INSERT INTO survey_versions (survey_config_id, sector_id, version_number, title, thank_you_message, published_at, published_by)
       VALUES ($1, $2, $3, 'Pesquisa de teste', 'Obrigado.', $4, $5) RETURNING id`,
      [surveyId, sectorId, number, publishedAt, adminId],
    );
  const svq = (
    versionId: string,
    questionId: string,
    type: 'nps' | 'scale_1_5',
    position: number,
  ) =>
    insertId(
      db,
      `INSERT INTO survey_version_questions
         (survey_version_id, question_id, type, text, journey_stage_id, journey_stage_name, journey_stage_position, position, is_required)
       VALUES ($1, $2, $3, 'Texto publicado', $4, $5, $6, $7, $8) RETURNING id`,
      [
        versionId,
        questionId,
        type,
        type === 'nps' ? null : stageId,
        type === 'nps' ? null : 'Recepção',
        type === 'nps' ? null : 1,
        position,
        type === 'nps',
      ],
    );

  const versionA1 = await version(surveyA, sectorA, 1, '2026-08-01T00:00:00Z');
  const svqA1Nps = await svq(versionA1, npsA, 'nps', 1);
  const svqA1Specific = await svq(versionA1, specificA, 'scale_1_5', 2);
  const versionA2 = await version(surveyA, sectorA, 2, '2026-08-15T00:00:00Z');
  const svqA2Nps = await svq(versionA2, npsA, 'nps', 1);
  const svqA2Specific = await svq(versionA2, specificA, 'scale_1_5', 2);
  const versionB1 = await version(surveyB, sectorB, 1, '2026-08-01T00:00:00Z');
  const svqB1Specific = await svq(versionB1, specificB, 'scale_1_5', 2);
  await svq(versionB1, npsB, 'nps', 1);

  await db.query('UPDATE survey_configs SET current_version_id = $1 WHERE id = $2', [
    versionA2,
    surveyA,
  ]);
  await db.query('UPDATE survey_configs SET current_version_id = $1 WHERE id = $2', [
    versionB1,
    surveyB,
  ]);

  // Turno 07:00–13:00 (America/Sao_Paulo) = 10:00–16:00 UTC em 01/09/2026.
  const shiftA1 = await insertId(
    db,
    `INSERT INTO shifts (sector_id, team_id, period, starts_at, ends_at, source, created_by)
     VALUES ($1, $2, 'morning', '2026-09-01T10:00:00Z', '2026-09-01T16:00:00Z', 'manual', $3) RETURNING id`,
    [sectorA, teamA1, adminId],
  );

  const responseA1 = await insertResponse(db, { versionId: versionA1, sectorId: sectorA });

  return {
    hospitalId,
    adminId,
    stageId,
    sectorA,
    sectorB,
    teamA1,
    teamA2,
    teamB1,
    surveyA,
    surveyB,
    npsA,
    specificA,
    versionA1,
    versionA2,
    versionB1,
    svqA1Nps,
    svqA1Specific,
    svqA2Nps,
    svqA2Specific,
    svqB1Specific,
    shiftA1,
    responseA1,
  };
}

export type Fixture = Awaited<ReturnType<typeof createFixture>>;

/** Insere uma resposta por link (sem atribuição), com valores válidos por padrão. */
export function insertResponse(
  db: Db,
  values: { versionId: string; sectorId: string; npsScore?: number; submittedAt?: string },
): Promise<string> {
  const npsScore = values.npsScore ?? 9;
  const submittedAt = values.submittedAt ?? '2026-09-01T12:00:00Z';
  return insertId(
    db,
    `INSERT INTO responses (survey_version_id, sector_id, origin, nps_score, low_score, submitted_at,
       attribution_status, idempotency_key, request_hash, manifestation_token_expires_at)
     VALUES ($1, $2, 'link', $3, $4, $5::timestamptz, 'not_qr_origin', gen_random_uuid(), $6,
       $5::timestamptz + interval '60 minutes')
     RETURNING id`,
    [values.versionId, values.sectorId, npsScore, npsScore <= 6, submittedAt, HASH],
  );
}

/** Insere uma manifestação vinculada à resposta (anônima por padrão). */
export function insertManifestation(
  db: Db,
  values: { responseId: string; sectorId: string; anonymous?: boolean },
): Promise<string> {
  return insertId(
    db,
    `INSERT INTO manifestations (response_id, sector_id, type, description, is_anonymous,
       triggered_by_low_score, received_at, idempotency_key, request_hash)
     VALUES ($1, $2, 'complaint', 'Descrição fictícia com mais de dez caracteres.', $3, false,
       '2026-09-01T12:10:00Z', gen_random_uuid(), $4)
     RETURNING id`,
    [values.responseId, values.sectorId, values.anonymous ?? true, HASH],
  );
}

// -------------------------------------------------------------------------------------------
// Evidências (gravadas somente quando EVIDENCE_DIR estiver definido)
// -------------------------------------------------------------------------------------------

export interface EvidenceEntry {
  scenario: string;
  operation: string;
  mechanism: string;
  sqlstate: string;
  constraint: string | undefined;
  message: string;
  before: Record<string, number | string>;
  after: Record<string, number | string>;
  result: 'APROVADO';
}

const evidence: EvidenceEntry[] = [];

export function recordEvidence(entry: Omit<EvidenceEntry, 'result'>): void {
  evidence.push({ ...entry, result: 'APROVADO' });
}

export function writeEvidence(fileName: string): void {
  const dir = process.env.EVIDENCE_DIR;
  if (dir === undefined || dir === '' || evidence.length === 0) return;
  const path = `${dir}/${fileName}`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify({ executedAt: new Date().toISOString(), entries: evidence }, null, 2)}\n`,
    'utf8',
  );
}
