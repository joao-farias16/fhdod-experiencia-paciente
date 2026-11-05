/**
 * Dados dos testes ponta a ponta do frontend (repositório do frontend, pasta e2e): cria, no banco
 * MySQL de TESTE (TEST_DB_*), um hospital fictício com dois setores, as contas SA, VI, OU e GE
 * (senhas aleatórias, gravadas só como hash bcrypt) e duas pesquisas publicadas do Pronto
 * Atendimento (uma ativa e uma desativada, para o 410). No teardown, encerra as sessões dessas
 * contas e apaga o arquivo. Nunca usa o banco de desenvolvimento nem servidor remoto.
 *
 * Uso: npm run e2e:fixture -- setup <arquivo.json> | teardown <arquivo.json>
 * A API usada pela E2E deve apontar para o mesmo banco (DB_NAME = TEST_DB_NAME).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Connection } from 'mysql2/promise';

import { hashPassword } from '../../src/modules/auth/passwords.js';
import { connect, ensureDatabase, loadDotEnv, loadTestDatabaseEnv } from '../db/connection.js';
import { applyPendingMigrations } from '../db/migrations.js';

loadDotEnv();

const [command, file] = process.argv.slice(2);

interface Account {
  email: string;
  password: string;
}

interface FixtureFile {
  hospitalId: string;
  /** ET07–ET09: Ouvidoria (ou) e Gestão (ge), ambos com escopo global. */
  accounts: { sa: Account; vi: Account; ou: Account; ge: Account };
  /** Slugs das pesquisas publicadas (ET06): ativa e desativada. */
  surveys: { active: string; inactive: string };
}

const SPECIFIC_QUESTIONS = ['Como foi a recepção?', 'Como foi o tempo de espera?'];

/** Pesquisa publicada (v1) com a pergunta geral e duas específicas da etapa Recepção. */
async function publishSurvey(
  db: Connection,
  values: { sectorId: string; stageId: string; authorId: string; slug: string; active: boolean },
): Promise<void> {
  const surveyId = randomUUID();
  const versionId = randomUUID();
  await db.query(
    `INSERT INTO survey_configs (id, sector_id, title, slug, intro_text, thank_you_message, created_by,
       has_unpublished_changes)
     VALUES (?, ?, 'Avaliação do Pronto Atendimento E2E', ?, 'Leva menos de um minuto.',
       'Obrigado! Sua opinião ajuda a melhorar o atendimento.', ?, false)`,
    [surveyId, values.sectorId, values.slug, values.authorId],
  );
  const questions = [
    {
      type: 'nps',
      text: 'Em uma escala de 0 a 10, o quanto você recomendaria o atendimento deste setor a um amigo ou familiar?',
    },
    ...SPECIFIC_QUESTIONS.map((text) => ({ type: 'scale_1_5', text })),
  ];
  await db.query(
    `INSERT INTO survey_versions (id, survey_config_id, sector_id, version_number, title, intro_text,
       thank_you_message, published_at, published_by)
     SELECT ?, id, sector_id, 1, title, intro_text, thank_you_message, UTC_TIMESTAMP(3), ?
     FROM survey_configs WHERE id = ?`,
    [versionId, values.authorId, surveyId],
  );
  for (const [index, question] of questions.entries()) {
    const nps = question.type === 'nps';
    const questionId = randomUUID();
    await db.query(
      `INSERT INTO questions (id, survey_config_id, journey_stage_id, type, text, is_required, position,
         first_published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [
        questionId,
        surveyId,
        nps ? null : values.stageId,
        question.type,
        question.text,
        nps,
        index + 1,
      ],
    );
    await db.query(
      `INSERT INTO survey_version_questions (survey_version_id, question_id, type, text,
         journey_stage_id, journey_stage_name, journey_stage_position, position, is_required)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        versionId,
        questionId,
        question.type,
        question.text,
        nps ? null : values.stageId,
        nps ? null : 'Recepção',
        nps ? null : 1,
        index + 1,
        nps,
      ],
    );
  }
  await db.query(
    `UPDATE survey_configs SET current_version_id = ?, is_active = ?,
       deactivated_at = CASE WHEN ? THEN NULL ELSE UTC_TIMESTAMP(3) END
     WHERE id = ?`,
    [versionId, values.active, values.active, surveyId],
  );
}

function password(): string {
  // 20 caracteres com letras e números (RN28).
  return `E2e${randomBytes(12)
    .toString('base64url')
    .replace(/[^A-Za-z0-9]/g, 'x')}9`;
}

async function setup(path: string): Promise<void> {
  const env = loadTestDatabaseEnv();
  await ensureDatabase(env);
  const db = await connect(env);
  try {
    await applyPendingMigrations(db);
    const suffix = randomBytes(3).toString('hex');
    const hospitalId = randomUUID();
    await db.query(
      "INSERT INTO hospitals (id, name, short_name) VALUES (?, 'Hospital Fictício E2E', ?)",
      [hospitalId, `E2E-${suffix}`],
    );
    const sectorIds: string[] = [];
    for (const [code, name] of [
      ['PA', 'Pronto Atendimento E2E'],
      ['UTI', 'UTI Adulto E2E'],
    ]) {
      const id = randomUUID();
      await db.query('INSERT INTO sectors (id, hospital_id, code, name) VALUES (?, ?, ?, ?)', [
        id,
        hospitalId,
        code,
        name,
      ]);
      sectorIds.push(id);
    }
    const stageId = randomUUID();
    await db.query(
      "INSERT INTO journey_stages (id, hospital_id, code, name, position) VALUES (?, ?, 'RECEPCAO', 'Recepção', 1)",
      [stageId, hospitalId],
    );
    const accounts = {} as FixtureFile['accounts'];
    let authorId = '';
    for (const [key, role, fullName] of [
      ['sa', 'superadmin', 'Superadministrador E2E'],
      ['vi', 'viewer', 'Visualizador E2E'],
      ['ou', 'ombudsman', 'Ouvidoria E2E'],
      ['ge', 'management', 'Gestão E2E'],
    ] as const) {
      const account = { email: `e2e-${key}.${suffix}@example.com`, password: password() };
      const id = randomUUID();
      await db.query(
        `INSERT INTO profiles (id, hospital_id, full_name, email, password_hash, role, all_sectors, must_change_password)
         VALUES (?, ?, ?, ?, ?, ?, true, false)`,
        [id, hospitalId, fullName, account.email, await hashPassword(account.password, 10), role],
      );
      accounts[key] = account;
      if (key === 'sa') authorId = id;
    }
    const surveys = { active: `e2e-pa-${suffix}`, inactive: `e2e-inativa-${suffix}` };
    for (const [slug, active] of [
      [surveys.active, true],
      [surveys.inactive, false],
    ] as const) {
      await publishSurvey(db, { sectorId: sectorIds[0] ?? '', stageId, authorId, slug, active });
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ hospitalId, accounts, surveys } satisfies FixtureFile, null, 2),
    );
    console.info(`Dados E2E criados (hospital E2E-${suffix}).`);
  } finally {
    await db.end();
  }
}

async function teardown(path: string): Promise<void> {
  if (!existsSync(path)) return;
  const fixture = JSON.parse(readFileSync(path, 'utf8')) as FixtureFile;
  const db = await connect(loadTestDatabaseEnv());
  try {
    // Encerra as sessões das contas do hospital E2E (inclusive as criadas pela interface).
    const [result] = await db.query(
      `UPDATE auth_sessions s JOIN profiles p ON p.id = s.profile_id
       SET s.revoked_at = UTC_TIMESTAMP(3), s.revoked_reason = 'logout'
       WHERE p.hospital_id = ? AND s.revoked_at IS NULL`,
      [fixture.hospitalId],
    );
    console.info(`Sessões E2E encerradas: ${(result as { affectedRows: number }).affectedRows}.`);
  } finally {
    await db.end();
    rmSync(path, { force: true });
  }
}

async function main(): Promise<void> {
  if (file === undefined || (command !== 'setup' && command !== 'teardown')) {
    throw new Error('Uso: tsx scripts/e2e/fixture.ts setup|teardown <arquivo.json>');
  }
  if (command === 'setup') await setup(file);
  else await teardown(file);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
