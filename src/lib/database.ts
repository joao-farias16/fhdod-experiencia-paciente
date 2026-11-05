/**
 * Conexão com o MySQL 8.4 (driver mysql2, sem ORM): pool de conexões configurado pelas variáveis
 * DB_*, sessão sempre em UTC, transações com nova tentativa em deadlock, verificação de saúde e
 * encerramento ordenado. Os repositórios (`*.repository.ts`) recebem um `Queryable` — o pool ou
 * a conexão de uma transação — e executam somente `SqlStatement` parametrizados (lib/sql.ts).
 */
import { readFileSync } from 'node:fs';

import mysql, { type Pool, type PoolConnection, type ResultSetHeader } from 'mysql2/promise';

import type { Env } from './env.js';
import type { SqlStatement } from './sql.js';

/** Resultado de INSERT, UPDATE e DELETE. */
export interface WriteResult {
  affectedRows: number;
  insertId: number;
}

/** Linha devolvida pelo MySQL (colunas já convertidas: DATETIME → Date, BOOLEAN → boolean). */
export type Row = Record<string, unknown>;

/** Executor de comandos: o pool (fora de transação) ou a conexão de uma transação. */
export interface Queryable {
  /** SELECT: devolve as linhas (o tipo informado não é verificado em tempo de execução). */
  query<T extends object = Row>(statement: SqlStatement): Promise<T[]>;
  /** INSERT, UPDATE ou DELETE. */
  execute(statement: SqlStatement): Promise<WriteResult>;
}

export interface TransactionOptions {
  /** Novas tentativas da transação inteira em deadlock (erro 1213). Padrão: 2. */
  deadlockRetries?: number;
}

export interface Database extends Queryable {
  /** Executa `work` numa transação (READ COMMITTED): COMMIT no sucesso, ROLLBACK em qualquer erro. */
  transaction<T>(work: (tx: Queryable) => Promise<T>, options?: TransactionOptions): Promise<T>;
  /** `SELECT 1` com tempo-limite (E43). */
  ping(timeoutMs: number): Promise<void>;
  /** Encerra o pool (desligamento da API e fim dos scripts). */
  close(): Promise<void>;
}

export type DatabaseEnv = Pick<
  Env,
  | 'DB_HOST'
  | 'DB_PORT'
  | 'DB_USER'
  | 'DB_PASSWORD'
  | 'DB_NAME'
  | 'DB_CONNECTION_LIMIT'
  | 'DB_SSL'
  | 'DB_SSL_CA'
>;

/** Comandos executados em toda conexão nova do pool. */
const SESSION_SETUP =
  "SET time_zone = '+00:00', SESSION transaction_isolation = 'READ-COMMITTED', " +
  "SESSION sql_mode = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'";

/** Opções do mysql2 comuns à API, aos scripts e aos testes. */
export function connectionOptions(env: DatabaseEnv, database: string | null = env.DB_NAME) {
  return {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    ...(database === null ? {} : { database }),
    charset: 'utf8mb4',
    // Instantes trafegam em UTC: Date ⇄ DATETIME(3) sem conversão pelo fuso do servidor.
    timezone: 'Z' as const,
    dateStrings: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
    decimalNumbers: true,
    connectTimeout: 10_000,
    ...(env.DB_SSL
      ? {
          ssl: {
            rejectUnauthorized: true,
            minVersion: 'TLSv1.2',
            ...(env.DB_SSL_CA === undefined ? {} : { ca: readFileSync(env.DB_SSL_CA, 'utf8') }),
          },
        }
      : {}),
    // BOOLEAN (TINYINT(1)) → boolean; o restante segue a conversão padrão do driver.
    typeCast(
      field: { type: string; length: number; string(): string | null },
      next: () => unknown,
    ): unknown {
      if (field.type === 'TINY' && field.length === 1) {
        const value = field.string();
        return value === null ? null : value === '1';
      }
      return next();
    },
  };
}

function wrap(executor: Pool | PoolConnection): Queryable {
  return {
    async query<T extends object>(statement: SqlStatement): Promise<T[]> {
      const [rows] = await executor.query(statement.text, [...statement.values]);
      if (!Array.isArray(rows)) throw new Error('O comando não devolveu linhas (use execute).');
      return rows as T[];
    },
    async execute(statement: SqlStatement): Promise<WriteResult> {
      const [result] = await executor.query<ResultSetHeader>(statement.text, [...statement.values]);
      return { affectedRows: result.affectedRows, insertId: result.insertId };
    },
  };
}

/** Erro do MySQL/mysql2 com os campos usados na tradução para a API. */
export interface MysqlError extends Error {
  code: string;
  errno?: number;
  sqlState?: string;
  sqlMessage?: string;
  fatal?: boolean;
}

export function isMysqlError(error: unknown): error is MysqlError {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  );
}

/**
 * Converte valores numéricos do MySQL para number. COUNT/SUM chegam como BIGINT/DECIMAL e o
 * driver os entrega como number (ou string, se excederem 2^53); NULL vira 0.
 */
export function toNumber(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

/** Deadlock detectado pelo InnoDB: a transação foi desfeita e pode ser repetida. */
export function isDeadlock(error: unknown): boolean {
  return isMysqlError(error) && error.errno === 1213;
}

/** Códigos de banco inacessível, sem permissão de conexão ou conexão perdida (→ 503). */
const UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'EPIPE',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_SEQUENCE_TIMEOUT',
  'POOL_CLOSED',
  'ER_ACCESS_DENIED_ERROR',
  'ER_BAD_DB_ERROR',
  'ER_CON_COUNT_ERROR',
  'ER_TOO_MANY_USER_CONNECTIONS',
  'ER_SERVER_SHUTDOWN',
  'ER_SERVER_OFFLINE_MODE',
]);

/** Indica falha de disponibilidade do banco (não de regra de negócio). */
export function isDatabaseUnavailable(error: unknown): boolean {
  if (!isMysqlError(error)) return false;
  return UNAVAILABLE_CODES.has(error.code) || error.fatal === true;
}

/** Cria o pool e o expõe como `Database`. A conexão só é aberta na primeira consulta. */
export function createDatabase(env: DatabaseEnv, database: string = env.DB_NAME): Database {
  const pool = mysql.createPool({
    ...connectionOptions(env, database),
    connectionLimit: env.DB_CONNECTION_LIMIT,
    maxIdle: env.DB_CONNECTION_LIMIT,
    idleTimeout: 60_000,
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,
  });
  // Toda conexão nova do pool passa a operar em UTC, READ COMMITTED (como o PostgreSQL) e modo estrito.
  pool.pool.on('connection', (connection) => {
    connection.query(SESSION_SETUP, (error: Error | null) => {
      if (error !== null) connection.destroy();
    });
  });
  return createDatabaseFromPool(pool);
}

export function createDatabaseFromPool(pool: Pool): Database {
  const base = wrap(pool);
  return {
    ...base,
    async transaction<T>(
      work: (tx: Queryable) => Promise<T>,
      { deadlockRetries = 2 }: TransactionOptions = {},
    ): Promise<T> {
      for (let attempt = 0; ; attempt += 1) {
        const connection = await pool.getConnection();
        let broken = false as boolean;
        try {
          await connection.query('START TRANSACTION');
          const result = await work(wrap(connection));
          await connection.query('COMMIT');
          return result;
        } catch (error) {
          try {
            await connection.query('ROLLBACK');
          } catch {
            broken = true;
          }
          if (isDeadlock(error) && attempt < deadlockRetries) continue;
          throw error;
        } finally {
          if (broken) connection.destroy();
          else connection.release();
        }
      }
    },
    async ping(timeoutMs: number): Promise<void> {
      await pool.query({ sql: 'SELECT 1', timeout: timeoutMs });
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}
