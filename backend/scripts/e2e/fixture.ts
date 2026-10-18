/**
 * Dados dos testes ponta a ponta (frontend/e2e): cria, no banco de TESTE e no Supabase Auth LOCAL,
 * um hospital fictício com dois setores e as contas SA e VI (senhas aleatórias), e as exclui do
 * Auth ao final. Nunca usa o banco de desenvolvimento nem serviços remotos.
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
    for (const [code, name] of [
      ['PA', 'Pronto Atendimento E2E'],
      ['UTI', 'UTI Adulto E2E'],
    ]) {
      await db.query('INSERT INTO sectors (hospital_id, code, name) VALUES ($1, $2, $3)', [
        hospitalId,
        code,
        name,
      ]);
    }
    const accounts = {} as FixtureFile['accounts'];
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
      await db.query(
        `INSERT INTO profiles (hospital_id, auth_user_id, full_name, email, role, all_sectors, must_change_password)
         VALUES ($1, $2, $3, $4, $5, true, false)`,
        [hospitalId, data.user.id, fullName, account.email, role],
      );
      accounts[key] = account;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ hospitalId, accounts } satisfies FixtureFile, null, 2));
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
