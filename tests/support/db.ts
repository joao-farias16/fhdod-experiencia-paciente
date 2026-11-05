/**
 * Apoio aos testes com MySQL real: conexão com o banco de testes (TEST_DB_*), transação desfeita
 * ao final, captura de erros do banco com SAVEPOINT e um cenário mínimo válido (fixture) criado
 * com SQL puro. Os identificadores são gerados no teste (randomUUID), pois o MySQL não tem
 * INSERT ... RETURNING.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Connection } from 'mysql2/promise';
import { expect } from 'vitest';

import {
  connect as connectMysql,
  loadDotEnv,
  loadTestDatabaseEnv,
} from '../../scripts/db/connection.js';
import { createDatabase, type Database } from '../../src/lib/database.js';

loadDotEnv();

/** Conexão direta dos testes (verificações e cenários), com a API `query` → `{ rows }`. */
export interface Db {
  connection: Connection;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- leitura tipada das linhas
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number }>;
  end(): Promise<void>;
}

export function testDatabaseEnv() {
  return loadTestDatabaseEnv();
}

export async function connect(): Promise<Db> {
  const connection = await connectMysql(testDatabaseEnv());
  return {
    connection,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- leitura tipada das linhas
    async query<T>(sql: string, params: unknown[] = []) {
      const [rows] = await connection.query(sql, params);
      const list = (Array.isArray(rows) ? rows : []) as T[];
      return {
        rows: list,
        rowCount: Array.isArray(rows)
          ? list.length
          : (rows as { affectedRows: number }).affectedRows,
      };
    },
    end: () => connection.end(),
  };
}

/** Pool da API apontando para o banco de testes. */
export function createTestDatabase(): Database {
  return createDatabase(testDatabaseEnv());
}

/** Erro do MySQL com os campos usados nas verificações. */
export interface MysqlTestError extends Error {
  code: string;
  errno: number;
  sqlMessage: string;
}

/**
 * Nome da regra que rejeitou a operação, extraído da mensagem do MySQL: CHECK
 * ("Check constraint 'x'"), UNIQUE ("for key 'tabela.x'"), chave estrangeira ("CONSTRAINT `x`")
 * ou gatilho ("[x] ...").
 */
export function constraintOf(error: { sqlMessage?: string; message: string }): string | undefined {
  const text = error.sqlMessage ?? error.message;
  const patterns = [
    /Check constraint '([^']+)'/,
    /for key '(?:[^'.]+\.)?([^']+)'/,
    /CONSTRAINT `([^`]+)`/,
    /^\[([a-z0-9_]+)\]/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}

/** Executa o corpo numa transação que é sempre desfeita (ROLLBACK). */
export async function inRollback<T>(db: Db, body: () => Promise<T>): Promise<T> {
  await db.query('START TRANSACTION');
  try {
    return await body();
  } finally {
    await db.query('ROLLBACK');
  }
}

/**
 * Executa um comando que DEVE falhar no banco. Usa SAVEPOINT para que a transação continue
 * utilizável depois do erro e devolve o erro do MySQL para as verificações. `code`: código do
 * mysql2 (ER_CHECK_CONSTRAINT_VIOLATED, ER_DUP_ENTRY, ER_NO_REFERENCED_ROW_2,
 * ER_ROW_IS_REFERENCED_2 ou ER_SIGNAL_EXCEPTION para os gatilhos).
 */
export async function expectDbError(
  db: Db,
  sql: string,
  params: unknown[] = [],
  expected: { code: string; constraint?: string | RegExp },
): Promise<MysqlTestError & { constraint: string | undefined }> {
  await db.query('SAVEPOINT tentativa_invalida');
  let error: MysqlTestError | undefined;
  try {
    await db.query(sql, params);
  } catch (caught) {
    error = caught as MysqlTestError;
  }
  await db.query('ROLLBACK TO SAVEPOINT tentativa_invalida');
  if (error === undefined) {
    throw new Error(`O banco aceitou uma operação inválida: ${sql}`);
  }
  const constraint = constraintOf(error);
  expect(error.code, error.sqlMessage).toBe(expected.code);
  if (expected.constraint instanceof RegExp) {
    expect(constraint).toMatch(expected.constraint);
  } else if (expected.constraint !== undefined) {
    expect(constraint).toBe(expected.constraint);
  }
  return Object.assign(error, { constraint });
}

export async function count(db: Db, sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await db.query(sql, params);
  return Number(Object.values(rows[0] ?? {})[0]);
}

/** INSERT com id gerado no teste; devolve o id. */
async function insertWithId(db: Db, sql: string, params: unknown[]): Promise<string> {
  const id = randomUUID();
  await db.query(sql, [id, ...params]);
  return id;
}

/** SHA-256 fictício (64 dígitos hexadecimais) para colunas request_hash. */
export const HASH = 'a'.repeat(64);

/** Hash bcrypt fictício (custo 4) para perfis criados diretamente no banco. */
export const PASSWORD_HASH = '$2b$04$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234';

/** Instante de referência dos cenários (UTC). */
export const T0 = '2026-09-01T10:00:00Z';

/** Converte um instante ISO para DATETIME(3) UTC aceito pelo MySQL. */
export function dt(iso: string | Date): string {
  return (typeof iso === 'string' ? new Date(iso) : iso)
    .toISOString()
    .replace('T', ' ')
    .replace('Z', '');
}

/**
 * Cenário mínimo válido: hospital, superadministrador, dois setores (A e B) com equipes, uma
 * pesquisa do setor A com versões v1 e v2 (cada uma com pergunta geral e uma específica), uma
 * pesquisa do setor B com v1, um turno da equipe A1 (07:00–13:00 locais) e uma resposta da v1.
 */
export async function createFixture(db: Db) {
  const suffix = Math.random().toString(36).slice(2, 8);
  const hospitalId = await insertWithId(
    db,
    "INSERT INTO hospitals (id, name, short_name) VALUES (?, 'Hospital de Teste', ?)",
    [`TESTE-${suffix}`],
  );
  const adminId = await insertWithId(
    db,
    `INSERT INTO profiles (id, hospital_id, full_name, email, password_hash, role, all_sectors, must_change_password)
     VALUES (?, ?, 'Administrador de Teste', ?, ?, 'superadmin', true, false)`,
    [hospitalId, `sa.${suffix}@example.com`, PASSWORD_HASH],
  );
  const stageId = await insertWithId(
    db,
    "INSERT INTO journey_stages (id, hospital_id, code, name, position) VALUES (?, ?, 'RECEPCAO', 'Recepção', 1)",
    [hospitalId],
  );
  const sector = (code: string, name: string) =>
    insertWithId(db, 'INSERT INTO sectors (id, hospital_id, code, name) VALUES (?, ?, ?, ?)', [
      hospitalId,
      code,
      name,
    ]);
  const sectorA = await sector('SETOR-A', 'Setor A');
  const sectorB = await sector('SETOR-B', 'Setor B');
  const team = (sectorId: string, code: string) =>
    insertWithId(db, 'INSERT INTO teams (id, sector_id, code, name) VALUES (?, ?, ?, ?)', [
      sectorId,
      code,
      code,
    ]);
  const teamA1 = await team(sectorA, 'A1');
  const teamA2 = await team(sectorA, 'A2');
  const teamB1 = await team(sectorB, 'B1');

  const survey = (sectorId: string, slug: string) =>
    insertWithId(
      db,
      `INSERT INTO survey_configs (id, sector_id, title, slug, thank_you_message, created_by)
       VALUES (?, ?, 'Pesquisa de teste', ?, 'Obrigado.', ?)`,
      [sectorId, `${slug}-${suffix}`, adminId],
    );
  const surveyA = await survey(sectorA, 'pesquisa-a');
  const surveyB = await survey(sectorB, 'pesquisa-b');

  const question = (surveyId: string, type: 'nps' | 'scale_1_5', position: number) =>
    insertWithId(
      db,
      `INSERT INTO questions (id, survey_config_id, journey_stage_id, type, text, is_required, position, first_published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        surveyId,
        type === 'nps' ? null : stageId,
        type,
        type === 'nps' ? 'Pergunta geral de teste?' : `Pergunta específica ${position}?`,
        type === 'nps',
        position,
        dt('2026-08-01T00:00:00Z'),
      ],
    );
  const npsA = await question(surveyA, 'nps', 1);
  const specificA = await question(surveyA, 'scale_1_5', 2);
  const npsB = await question(surveyB, 'nps', 1);
  const specificB = await question(surveyB, 'scale_1_5', 2);

  const version = (surveyId: string, sectorId: string, number: number, publishedAt: string) =>
    insertWithId(
      db,
      `INSERT INTO survey_versions (id, survey_config_id, sector_id, version_number, title, thank_you_message, published_at, published_by)
       VALUES (?, ?, ?, ?, 'Pesquisa de teste', 'Obrigado.', ?, ?)`,
      [surveyId, sectorId, number, dt(publishedAt), adminId],
    );
  const svq = (
    versionId: string,
    questionId: string,
    type: 'nps' | 'scale_1_5',
    position: number,
  ) =>
    insertWithId(
      db,
      `INSERT INTO survey_version_questions
         (id, survey_version_id, question_id, type, text, journey_stage_id, journey_stage_name, journey_stage_position, position, is_required)
       VALUES (?, ?, ?, ?, 'Texto publicado', ?, ?, ?, ?, ?)`,
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

  await db.query('UPDATE survey_configs SET current_version_id = ? WHERE id = ?', [
    versionA2,
    surveyA,
  ]);
  await db.query('UPDATE survey_configs SET current_version_id = ? WHERE id = ?', [
    versionB1,
    surveyB,
  ]);

  // Turno 07:00–13:00 (America/Sao_Paulo) = 10:00–16:00 UTC em 01/09/2026.
  const shiftA1 = await insertWithId(
    db,
    `INSERT INTO shifts (id, sector_id, team_id, period, starts_at, ends_at, source, created_by)
     VALUES (?, ?, ?, 'morning', '2026-09-01 10:00:00', '2026-09-01 16:00:00', 'manual', ?)`,
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
  const submittedAt = new Date(values.submittedAt ?? '2026-09-01T12:00:00Z');
  return insertWithId(
    db,
    `INSERT INTO responses (id, survey_version_id, sector_id, origin, nps_score, low_score, submitted_at,
       attribution_status, idempotency_key, request_hash, manifestation_token_expires_at)
     VALUES (?, ?, ?, 'link', ?, ?, ?, 'not_qr_origin', UUID(), ?, ?)`,
    [
      values.versionId,
      values.sectorId,
      npsScore,
      npsScore <= 6,
      dt(submittedAt),
      HASH,
      dt(new Date(submittedAt.getTime() + 60 * 60_000)),
    ],
  );
}

/** Insere uma manifestação vinculada à resposta (anônima por padrão). */
export function insertManifestation(
  db: Db,
  values: { responseId: string; sectorId: string; anonymous?: boolean },
): Promise<string> {
  return insertWithId(
    db,
    `INSERT INTO manifestations (id, response_id, sector_id, type, description, is_anonymous,
       triggered_by_low_score, received_at, idempotency_key, request_hash)
     VALUES (?, ?, ?, 'complaint', 'Descrição fictícia com mais de dez caracteres.', ?, false,
       '2026-09-01 12:10:00', UUID(), ?)`,
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
