/**
 * Linha de comando das migrations MySQL (database/migrations).
 *
 *   npm run db:create            cria o banco DB_NAME, se não existir (nunca apaga)
 *   npm run db:migrate           aplica as migrations pendentes em DB_NAME
 *   npm run db:migrate:status    lista aplicadas, pendentes e inconsistências (checksum)
 *   npm run db:migration:new -- nome_da_mudanca
 *                                cria database/migrations/NNN_nome_da_mudanca.sql (próximo número)
 *   npm run db:schema            regenera database/schema.sql (todas as migrations, para o Workbench)
 *   npm run db:schema:check      falha se database/schema.sql estiver desatualizado (CI)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadDatabaseEnv } from '../../src/lib/env.js';
import { connect, describeEnv, ensureDatabase, loadDotEnv } from './connection.js';
import {
  applyPendingMigrations,
  migrationStatus,
  MIGRATIONS_DIR,
  readMigrations,
  SCHEMA_MIGRATIONS_DDL,
} from './migrations.js';

loadDotEnv();

const SCHEMA_FILE = join('database', 'schema.sql');

/** database/schema.sql: todas as migrations em sequência + o registro em schema_migrations. */
export function buildSchemaSql(): string {
  const migrations = readMigrations();
  const header = `-- =============================================================================================
-- FHDOD — esquema completo do banco MySQL 8.4 (ARQUIVO GERADO: não edite à mão)
-- =============================================================================================
-- Gerado por \`npm run db:schema\` a partir de database/migrations/ (${migrations.length} migrations).
-- Uso no MySQL Workbench, em um banco VAZIO:
--   1. execute database/create_database.sql;
--   2. abra este arquivo, confira o USE abaixo e execute tudo (Ctrl+Shift+Enter);
--   3. (opcional) execute database/seeds/001_dados_base.sql.
-- O arquivo também registra as migrations em schema_migrations, para que \`npm run db:migrate\`
-- reconheça o banco como atualizado. Para bancos já existentes, aplique só as migrations novas.

USE fhdod;
SET NAMES utf8mb4;
SET time_zone = '+00:00';

${SCHEMA_MIGRATIONS_DDL};
`;
  const body = migrations
    .map(
      (migration) =>
        `\n-- >>> ${migration.fileName} ${'-'.repeat(Math.max(0, 80 - migration.fileName.length))}\n\n${migration.content.trim()}\n`,
    )
    .join('');
  const register = migrations
    .map((migration) => `  ('${migration.version}', '${migration.name}', '${migration.checksum}')`)
    .join(',\n');
  return `${header}${body}\n-- Registro das migrations aplicadas por este arquivo.\nINSERT INTO schema_migrations (version, name, checksum) VALUES\n${register};\n`;
}

async function main(): Promise<void> {
  const [command = 'up', ...args] = process.argv.slice(2);

  if (command === 'schema' || command === 'schema:check') {
    const expected = buildSchemaSql();
    if (command === 'schema') {
      writeFileSync(SCHEMA_FILE, expected, 'utf8');
      console.info(`${SCHEMA_FILE} atualizado.`);
      return;
    }
    const current = existsSync(SCHEMA_FILE)
      ? readFileSync(SCHEMA_FILE, 'utf8').replace(/\r\n/g, '\n')
      : '';
    if (current !== expected) {
      throw new Error(
        `${SCHEMA_FILE} desatualizado. Rode \`npm run db:schema\` e versione o arquivo.`,
      );
    }
    console.info(`${SCHEMA_FILE} confere com as migrations.`);
    return;
  }

  if (command === 'new') {
    const name = (args[0] ?? '').toLowerCase();
    if (!/^[a-z0-9_]+$/.test(name)) {
      throw new Error(
        'Informe o nome em minúsculas com _ (ex.: npm run db:migration:new -- inclui_coluna_x).',
      );
    }
    const last = readMigrations().at(-1)?.version ?? '000';
    const version = String(Number(last) + 1).padStart(3, '0');
    const file = join(MIGRATIONS_DIR, `${version}_${name}.sql`);
    writeFileSync(
      file,
      `-- Migration ${version} — ${name.replaceAll('_', ' ')}\n-- Descreva o objetivo e a regra de negócio. Não edite depois de aplicada; crie outra.\n\n`,
      'utf8',
    );
    console.info(
      `Criada ${file}. Depois de escrever o SQL: npm run db:migrate && npm run db:schema`,
    );
    return;
  }

  const env = loadDatabaseEnv();
  if (command === 'create') {
    const created = await ensureDatabase(env);
    console.info(
      created ? `Banco criado: ${describeEnv(env)}` : `Banco já existia: ${describeEnv(env)}`,
    );
    return;
  }

  const connection = await connect(env);
  try {
    if (command === 'status') {
      const status = await migrationStatus(connection);
      console.info(`Banco: ${describeEnv(env)}`);
      for (const record of status.applied) {
        console.info(
          `  [aplicada] ${record.version}_${record.name} em ${record.appliedAt.toISOString()}`,
        );
      }
      for (const file of status.pending) console.info(`  [pendente] ${file.fileName}`);
      for (const problem of status.problems) console.error(`  [problema] ${problem}`);
      if (status.problems.length > 0) process.exitCode = 1;
      return;
    }
    if (command !== 'up') throw new Error(`Comando desconhecido: ${command}`);
    console.info(`Aplicando migrations em ${describeEnv(env)}...`);
    const applied = await applyPendingMigrations(connection, (message) => {
      console.info(`  ${message}`);
    });
    console.info(
      applied.length === 0
        ? 'Nenhuma migration pendente.'
        : `${applied.length} migration(s) aplicada(s).`,
    );
  } finally {
    await connection.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
