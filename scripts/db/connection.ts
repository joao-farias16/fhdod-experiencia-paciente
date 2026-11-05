/**
 * Conexões dos scripts de banco (migrations, seed, verificação e reinicialização), com as mesmas
 * opções da API (lib/database.ts): UTC, conversão de BOOLEAN e TLS opcional.
 * `target`: 'app' usa DB_*; 'test' usa TEST_DB_* (cada uma cai para a DB_* correspondente) e
 * exige servidor local e banco diferente do de desenvolvimento.
 */
import { existsSync } from 'node:fs';

import mysql, { type Connection } from 'mysql2/promise';

import { connectionOptions } from '../../src/lib/database.js';
import { type DatabaseConnectionEnv, databaseName, loadDatabaseEnv } from '../../src/lib/env.js';
import { assertLocalTargets, describeTarget } from './guard.js';

export function loadDotEnv(): void {
  if (existsSync('.env')) process.loadEnvFile('.env');
}

export const DATABASE_CHARSET = 'utf8mb4';
export const DATABASE_COLLATION = 'utf8mb4_0900_as_cs';

/** Variáveis do banco de testes: TEST_DB_* com DB_* como padrão (TEST_DB_NAME padrão: fhdod_test). */
export function loadTestDatabaseEnv(
  source: NodeJS.ProcessEnv = process.env,
): DatabaseConnectionEnv {
  const pick = (name: string) => {
    const value = source[`TEST_${name}`];
    return value === undefined || value === '' ? source[name] : value;
  };
  const env = loadDatabaseEnv({
    DB_HOST: pick('DB_HOST'),
    DB_PORT: pick('DB_PORT'),
    DB_USER: pick('DB_USER'),
    DB_PASSWORD: source.TEST_DB_PASSWORD ?? source.DB_PASSWORD,
    DB_NAME:
      source.TEST_DB_NAME === undefined || source.TEST_DB_NAME === ''
        ? 'fhdod_test'
        : source.TEST_DB_NAME,
    DB_CONNECTION_LIMIT: '5',
    DB_SSL: 'false',
  });
  assertLocalTargets({ TEST_DB_HOST: env.DB_HOST }, 'Banco de testes');
  const appName = source.DB_NAME === undefined || source.DB_NAME === '' ? 'fhdod' : source.DB_NAME;
  const sameServer = (pick('DB_HOST') ?? 'localhost') === (source.DB_HOST ?? 'localhost');
  if (sameServer && env.DB_NAME === appName) {
    throw new Error(
      `TEST_DB_NAME (${env.DB_NAME}) não pode ser o banco de desenvolvimento: os testes gravam dados.`,
    );
  }
  return env;
}

export function describeEnv(env: DatabaseConnectionEnv): string {
  return describeTarget({ host: env.DB_HOST, port: env.DB_PORT, database: env.DB_NAME });
}

/** Conexão única (sem pool) com o banco informado; `database: null` conecta só ao servidor. */
export async function connect(
  env: DatabaseConnectionEnv,
  database: string | null = env.DB_NAME,
): Promise<Connection> {
  const connection = await mysql.createConnection({
    ...connectionOptions(env, database),
    multipleStatements: false,
  });
  await connection.query("SET time_zone = '+00:00'");
  return connection;
}

/** Cria o banco (utf8mb4_0900_as_cs) se ainda não existir. Nunca apaga nada. */
export async function ensureDatabase(env: DatabaseConnectionEnv): Promise<boolean> {
  const name = databaseName.parse(env.DB_NAME);
  const server = await connect(env, null);
  try {
    const [rows] = await server.query(
      'SELECT 1 FROM information_schema.schemata WHERE schema_name = ?',
      [name],
    );
    if ((rows as unknown[]).length > 0) return false;
    await server.query(
      `CREATE DATABASE \`${name}\` CHARACTER SET ${DATABASE_CHARSET} COLLATE ${DATABASE_COLLATION}`,
    );
    return true;
  } finally {
    await server.end();
  }
}

/** Apaga e recria o banco — SOMENTE para servidor local (reinicialização e testes). */
export async function recreateLocalDatabase(env: DatabaseConnectionEnv): Promise<void> {
  assertLocalTargets({ DB_HOST: env.DB_HOST }, 'Recriação do banco');
  const name = databaseName.parse(env.DB_NAME);
  const server = await connect(env, null);
  try {
    await server.query(`DROP DATABASE IF EXISTS \`${name}\``);
    await server.query(
      `CREATE DATABASE \`${name}\` CHARACTER SET ${DATABASE_CHARSET} COLLATE ${DATABASE_COLLATION}`,
    );
  } finally {
    await server.end();
  }
}
