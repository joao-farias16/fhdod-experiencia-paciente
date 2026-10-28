/**
 * Dados dos testes ponta a ponta (frontend/e2e): cria, no banco de TESTE e no Supabase Auth LOCAL,
 * um hospital fictício com dois setores, as contas SA e VI (senhas aleatórias) e, desde a ET06,
 * duas pesquisas publicadas do Pronto Atendimento (uma ativa e uma desativada, para o 410), e
 * exclui as contas do Auth ao final. Nunca usa o banco de desenvolvimento nem serviços remotos.
 *
 * Uso: tsx scripts/e2e/fixture.ts setup <arquivo.json> | teardown <arquivo.json>
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

import { assertLocalTargets } from '../db/guard.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const [command, file] = process.argv.slice(2);
const DATABASE_URL = process.env.TEST_DATABASE_URL ?? '';
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? '';

interface Account {
  email: string;
  password: string;
}

interface FixtureFile {
  hospitalId: string;
  accounts: { sa: Account; vi: Account };
  /** Slugs das pesquisas publicadas (ET06): ativa e desativada. */
  surveys: { active: string; inactive: string };
}

const SPECIFIC_QUESTIONS = ['Como foi a recepção?', 'Como foi o tempo de espera?'];

/** Pesquisa publicada (v1) com a pergunta geral e duas específicas da etapa Recepção. */
async function publishSurvey(
  db: pg.Client,
  values: { sectorId: string; stageId: string; authorId: string; slug: string; active: boolean },
): Promise<void> {
  const insert = async (sql: string, params: unknown[]) =>
    (await db.query<{ id: string }>(sql, params)).rows[0]?.id ?? '';
  const surveyId = await insert(
    `INSERT INTO survey_configs (sector_id, title, slug, intro_text, thank_you_message, created_by,
       has_unpublished_changes)
     VALUES ($1, 'Avaliação do Pronto Atendimento E2E', $2, 'Leva menos de um minuto.',
       'Obrigado! Sua opinião ajuda a melhorar o atendimento.', $3, false) RETURNING id`,
    [values.sectorId, values.slug, values.authorId],
  );
  const questions = [
    {
      type: 'nps',
      text: 'Em uma escala de 0 a 10, o quanto você recomendaria o atendimento deste setor a um amigo ou familiar?',
    },
    ...SPECIFIC_QUESTIONS.map((text) => ({ type: 'scale_1_5', text })),
  ];
  const versionId = await insert(
    `INSERT INTO survey_versions (survey_config_id, sector_id, version_number, title, intro_text,
       thank_you_message, published_at, published_by)
     SELECT id, sector_id, 1, title, intro_text, thank_you_message, now(), $2
     FROM survey_configs WHERE id = $1 RETURNING id`,
    [surveyId, values.authorId],
  );
  for (const [index, question] of questions.entries()) {
    const nps = question.type === 'nps';
    const questionId = await insert(
      `INSERT INTO questions (survey_config_id, journey_stage_id, type, text, is_required, position,
         first_published_at)
       VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING id`,
      [surveyId, nps ? null : values.stageId, question.type, question.text, nps, index + 1],
    );
    await db.query(
      `INSERT INTO survey_version_questions (survey_version_id, question_id, type, text,
         journey_stage_id, journey_stage_name, journey_stage_position, position, is_required)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
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
    `UPDATE survey_configs SET current_version_id = $1, is_active = $3,
       deactivated_at = CASE WHEN $3 THEN NULL ELSE now() END
     WHERE id = $2`,
    [versionId, surveyId, values.active],
  );
}

function password(): string {
  // 20 caracteres com letras e números (RN28).
  return `E2e${randomBytes(12)
    .toString('base64url')
    .replace(/[^A-Za-z0-9]/g, 'x')}9`;
}

async function setup(path: string): Promise<void> {
  const migrate = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'pipe',
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: { ...process.env, DIRECT_URL: DATABASE_URL, DATABASE_URL },
  });
  if (migrate.status !== 0) throw new Error(`migrate deploy falhou:\n${migrate.stderr}`);

  const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false } });
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    const suffix = randomBytes(3).toString('hex');
    const hospital = await db.query<{ id: string }>(
      "INSERT INTO hospitals (name, short_name) VALUES ('Hospital Fictício E2E', $1) RETURNING id",
      [`E2E-${suffix}`],
    );
    const hospitalId = hospital.rows[0]?.id ?? '';
    const sectorIds: string[] = [];
    for (const [code, name] of [
      ['PA', 'Pronto Atendimento E2E'],
      ['UTI', 'UTI Adulto E2E'],
    ]) {
      const sector = await db.query<{ id: string }>(
        'INSERT INTO sectors (hospital_id, code, name) VALUES ($1, $2, $3) RETURNING id',
        [hospitalId, code, name],
      );
      sectorIds.push(sector.rows[0]?.id ?? '');
    }
    const stage = await db.query<{ id: string }>(
      "INSERT INTO journey_stages (hospital_id, code, name, position) VALUES ($1, 'RECEPCAO', 'Recepção', 1) RETURNING id",
      [hospitalId],
    );
    const accounts = {} as FixtureFile['accounts'];
    let authorId = '';
    for (const [key, role, fullName] of [
      ['sa', 'superadmin', 'Superadministrador E2E'],
      ['vi', 'viewer', 'Visualizador E2E'],
    ] as const) {
      const account = { email: `e2e-${key}.${suffix}@example.com`, password: password() };
      const { data, error } = await admin.auth.admin.createUser({
        email: account.email,
        password: account.password,
        email_confirm: true,
      });
      if (error !== null) throw error;
      const profile = await db.query<{ id: string }>(
        `INSERT INTO profiles (hospital_id, auth_user_id, full_name, email, role, all_sectors, must_change_password)
         VALUES ($1, $2, $3, $4, $5, true, false) RETURNING id`,
        [hospitalId, data.user.id, fullName, account.email, role],
      );
      accounts[key] = account;
      if (key === 'sa') authorId = profile.rows[0]?.id ?? '';
    }
    const surveys = { active: `e2e-pa-${suffix}`, inactive: `e2e-inativa-${suffix}` };
    for (const [slug, active] of [
      [surveys.active, true],
      [surveys.inactive, false],
    ] as const) {
      await publishSurvey(db, {
        sectorId: sectorIds[0] ?? '',
        stageId: stage.rows[0]?.id ?? '',
        authorId,
        slug,
        active,
      });
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
  const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false } });
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    // Inclui as contas criadas pela própria interface durante os testes.
    const { rows } = await db.query<{ auth_user_id: string }>(
      'SELECT auth_user_id FROM profiles WHERE hospital_id = $1',
      [fixture.hospitalId],
    );
    for (const row of rows) await admin.auth.admin.deleteUser(row.auth_user_id);
    console.info(`Contas E2E removidas do Supabase Auth local: ${rows.length}.`);
  } finally {
    await db.end();
    rmSync(path, { force: true });
  }
}

async function main(): Promise<void> {
  if (file === undefined || (command !== 'setup' && command !== 'teardown')) {
    throw new Error('Uso: tsx scripts/e2e/fixture.ts setup|teardown <arquivo.json>');
  }
  if (DATABASE_URL === '' || SUPABASE_URL === '' || SECRET_KEY === '') {
    throw new Error(
      'Defina TEST_DATABASE_URL, SUPABASE_URL e SUPABASE_SECRET_KEY em backend/.env.',
    );
  }
  assertLocalTargets({ TEST_DATABASE_URL: DATABASE_URL, SUPABASE_URL }, 'Dados E2E');
  if (command === 'setup') await setup(file);
  else await teardown(file);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
