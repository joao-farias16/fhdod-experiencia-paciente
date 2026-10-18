/**
 * Preparação dos testes de banco (Seção 12: integração com PostgreSQL real via TEST_DATABASE_URL).
 * 1. exige TEST_DATABASE_URL apontando para um servidor local (Supabase CLI ou serviço da CI);
 * 2. cria o banco de teste, se ainda não existir;
 * 3. aplica as migrations versionadas com `prisma migrate deploy`.
 * Os testes rodam em transações desfeitas ao final (ROLLBACK): nenhum dado de teste permanece.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import pg from 'pg';

import { assertLocalTargets, describeUrl } from '../../scripts/db/guard.js';

export default async function setup(): Promise<void> {
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }
  const url = process.env.TEST_DATABASE_URL;
  if (url === undefined || url === '') {
    throw new Error(
      'TEST_DATABASE_URL não definida. Inicie o banco local (npm run db:start) e configure ' +
        'backend/.env conforme backend/.env.example.',
    );
  }
  assertLocalTargets({ TEST_DATABASE_URL: url }, 'Testes de banco');

  const target = new URL(url);
  const database = decodeURIComponent(target.pathname.slice(1));
  const admin = new URL(url);
  admin.pathname = '/postgres';

  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (exists.rowCount === 0) {
      await client.query(`CREATE DATABASE ${client.escapeIdentifier(database)}`);
    }
  } finally {
    await client.end();
  }

  const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'pipe',
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: { ...process.env, DIRECT_URL: url, DATABASE_URL: url },
  });
  if (result.status !== 0) {
    throw new Error(
      `prisma migrate deploy falhou em ${describeUrl(url)}:\n${result.stdout}\n${result.stderr}`,
    );
  }
}
