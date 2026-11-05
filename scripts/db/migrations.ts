/**
 * Migrations versionadas em SQL puro (database/migrations/NNN_nome.sql), aplicadas em ordem e
 * registradas na tabela schema_migrations (versão, nome, SHA-256 do arquivo e instante). Os mesmos
 * arquivos rodam no MySQL Workbench: o leitor entende a diretiva DELIMITER usada nos gatilhos.
 *
 * Regras: nunca edite uma migration já aplicada (o checksum diverge e o comando falha); crie a
 * próxima. DDL no MySQL confirma a transação implicitamente, então cada arquivo é registrado só
 * depois de executado por inteiro; se um comando falhar no meio, corrija o banco e o arquivo
 * antes de tentar de novo (ver database/README.md).
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Connection } from 'mysql2/promise';

export const MIGRATIONS_DIR = join('database', 'migrations');
const FILE_PATTERN = /^(\d{3})_([a-z0-9_]+)\.sql$/;

export interface MigrationFile {
  version: string;
  name: string;
  fileName: string;
  checksum: string;
  content: string;
}

/** Arquivos de migration em ordem de versão. */
export function readMigrations(dir = MIGRATIONS_DIR): MigrationFile[] {
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  const migrations = files.map((fileName) => {
    const match = FILE_PATTERN.exec(fileName);
    if (match === null) {
      throw new Error(`Nome de migration inválido: ${fileName} (use NNN_nome_em_minusculas.sql).`);
    }
    const content = readFileSync(join(dir, fileName), 'utf8').replace(/\r\n/g, '\n');
    return {
      version: match[1] ?? '',
      name: match[2] ?? '',
      fileName,
      checksum: createHash('sha256').update(content).digest('hex'),
      content,
    };
  });
  const versions = new Set<string>();
  for (const migration of migrations) {
    if (versions.has(migration.version)) {
      throw new Error(`Versão de migration repetida: ${migration.version}.`);
    }
    versions.add(migration.version);
  }
  return migrations;
}

/**
 * Divide o script em comandos, respeitando `DELIMITER` (cliente mysql e MySQL Workbench), strings
 * entre aspas e comentários. Linhas de comentário isoladas são descartadas.
 */
export function splitStatements(script: string): string[] {
  const statements: string[] = [];
  let delimiter = ';';
  let current = '';
  let quote: string | null = null;
  let i = 0;
  const atLineStart = () => current.trim() === '';

  while (i < script.length) {
    const char = script[i] ?? '';
    const rest = script.slice(i);

    if (quote === null) {
      // Diretiva DELIMITER (somente no início de um comando).
      if (atLineStart()) {
        const directive = /^DELIMITER[ \t]+(\S+)[ \t]*(\n|$)/i.exec(rest);
        if (directive !== null) {
          delimiter = directive[1] ?? ';';
          current = '';
          i += directive[0].length;
          continue;
        }
      }
      if (rest.startsWith('-- ') || rest.startsWith('--\n') || char === '#') {
        const end = script.indexOf('\n', i);
        i = end === -1 ? script.length : end + 1;
        current += '\n';
        continue;
      }
      if (rest.startsWith('/*')) {
        const end = script.indexOf('*/', i + 2);
        i = end === -1 ? script.length : end + 2;
        continue;
      }
      if (rest.startsWith(delimiter)) {
        if (current.trim() !== '') statements.push(current.trim());
        current = '';
        i += delimiter.length;
        continue;
      }
      if (char === "'" || char === '"' || char === '`') quote = char;
      current += char;
      i += 1;
      continue;
    }

    // Dentro de string: barra invertida escapa o próximo caractere; aspas duplicadas também.
    current += char;
    if (char === '\\' && quote !== '`') {
      current += script[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (char === quote) {
      if (script[i + 1] === quote) {
        current += quote;
        i += 2;
        continue;
      }
      quote = null;
    }
    i += 1;
  }
  if (current.trim() !== '') statements.push(current.trim());
  return statements;
}

export const SCHEMA_MIGRATIONS_DDL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version    CHAR(3)      NOT NULL,
  name       VARCHAR(120) NOT NULL,
  checksum   CHAR(64)     NOT NULL,
  applied_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (version)
) ENGINE = InnoDB COMMENT = 'Controle das migrations aplicadas (database/migrations).'`;

export interface AppliedMigration {
  version: string;
  name: string;
  checksum: string;
  appliedAt: Date;
}

export async function appliedMigrations(connection: Connection): Promise<AppliedMigration[]> {
  await connection.query(SCHEMA_MIGRATIONS_DDL);
  const [rows] = await connection.query(
    'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version',
  );
  return (rows as { version: string; name: string; checksum: string; applied_at: Date }[]).map(
    (row) => ({
      version: row.version,
      name: row.name,
      checksum: row.checksum,
      appliedAt: row.applied_at,
    }),
  );
}

export interface MigrationStatus {
  applied: AppliedMigration[];
  pending: MigrationFile[];
  /** Arquivos alterados depois de aplicados (checksum diferente) ou ausentes no repositório. */
  problems: string[];
}

export async function migrationStatus(
  connection: Connection,
  files: MigrationFile[] = readMigrations(),
): Promise<MigrationStatus> {
  const applied = await appliedMigrations(connection);
  const problems: string[] = [];
  for (const record of applied) {
    const file = files.find((item) => item.version === record.version);
    if (file === undefined) {
      problems.push(
        `Migration ${record.version}_${record.name} aplicada, mas ausente no repositório.`,
      );
    } else if (file.checksum !== record.checksum) {
      problems.push(
        `Migration ${file.fileName} foi alterada depois de aplicada (checksum diferente). ` +
          'Desfaça a alteração e crie uma nova migration.',
      );
    }
  }
  const pending = files.filter(
    (file) => !applied.some((record) => record.version === file.version),
  );
  const lastApplied = applied.at(-1)?.version;
  for (const file of pending) {
    if (lastApplied !== undefined && file.version < lastApplied) {
      problems.push(`Migration ${file.fileName} é anterior à última aplicada (${lastApplied}).`);
    }
  }
  return { applied, pending, problems };
}

/** Aplica as migrations pendentes, em ordem. Devolve os arquivos aplicados. */
export async function applyPendingMigrations(
  connection: Connection,
  log: (message: string) => void = () => undefined,
): Promise<MigrationFile[]> {
  const status = await migrationStatus(connection);
  if (status.problems.length > 0) {
    throw new Error(`Migrations inconsistentes:\n- ${status.problems.join('\n- ')}`);
  }
  for (const migration of status.pending) {
    log(`Aplicando ${migration.fileName}...`);
    for (const statement of splitStatements(migration.content)) {
      await connection.query(statement);
    }
    await connection.query(
      'INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)',
      [migration.version, migration.name, migration.checksum],
    );
  }
  return status.pending;
}
