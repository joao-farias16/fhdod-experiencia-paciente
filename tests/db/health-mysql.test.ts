/**
 * Camada de acesso ao MySQL (Etapa 3): pool real do mysql2 contra o banco de testes — E43 com
 * banco disponível e inacessível, conversão de tipos (BOOLEAN, DATETIME(3) em UTC, JSON),
 * parametrização, transações (COMMIT, ROLLBACK e isolamento) e reconhecimento de erros.
 */
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database, isDatabaseUnavailable } from '../../src/lib/database.js';
import { sql } from '../../src/lib/sql.js';
import { isConstraintViolation, isUniqueViolation } from '../../src/utils/errors.js';
import { buildTestApp, errorOf } from '../support/app.js';
import { createTestDatabase, PASSWORD_HASH, testDatabaseEnv } from '../support/db.js';

let database: Database;
let unreachable: Database;
let hospitalId: string;

beforeAll(async () => {
  database = createTestDatabase();
  // Porta 1 em localhost: conexão recusada imediatamente.
  unreachable = createDatabase({ ...testDatabaseEnv(), DB_PORT: 1, DB_CONNECTION_LIMIT: 1 });
  hospitalId = randomUUID();
  await database.execute(
    sql`INSERT INTO hospitals (id, name, short_name) VALUES (${hospitalId}, 'Hospital Saúde', ${`SAUDE-${hospitalId.slice(0, 8)}`})`,
  );
});

afterAll(async () => {
  await Promise.all([database.close(), unreachable.close()]);
});

describe('GET /api/v1/health com MySQL real', () => {
  it('responde 200 quando o SELECT 1 é atendido', async () => {
    const response = await request(buildTestApp(database)).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect((response.body as { data: { status: string } }).data.status).toBe('ok');
  });

  it('responde 503 SERVICE_UNAVAILABLE quando o banco está inacessível', async () => {
    const response = await request(buildTestApp(unreachable)).get('/api/v1/health');

    expect(response.status).toBe(503);
    expect(errorOf(response).code).toBe('SERVICE_UNAVAILABLE');
    const failure = await unreachable.query(sql`SELECT 1`).catch((error: unknown) => error);
    expect(isDatabaseUnavailable(failure)).toBe(true);
  });
});

describe('conversão de tipos e parametrização', () => {
  it('BOOLEAN vira boolean, DATETIME(3) vira Date em UTC e JSON vira objeto', async () => {
    const at = new Date('2026-09-01T23:59:59.987Z');
    await database.execute(
      sql`INSERT INTO sectors (hospital_id, code, name) VALUES (${hospitalId}, 'TIPOS', 'Setor tipos')`,
    );
    const [row] = await database.query<{ flag: boolean; at: Date; data: { a: number[] } }>(sql`
      SELECT s.is_active AS flag, CAST(${at} AS DATETIME(3)) AS at, ${sql.json({ a: [1, 2] })} AS data
      FROM sectors s WHERE s.hospital_id = ${hospitalId} AND s.code = 'TIPOS'`);
    expect(row?.flag).toBe(true);
    expect(row?.at).toBeInstanceOf(Date);
    expect(row?.at.toISOString()).toBe(at.toISOString());
    expect(row?.data).toEqual({ a: [1, 2] });
  });

  it('valores com aspas e curingas são dados, nunca SQL (sem injeção)', async () => {
    const hostile = "x' OR '1'='1; DROP TABLE hospitals; --";
    const rows = await database.query(sql`SELECT id FROM hospitals WHERE name = ${hostile}`);
    expect(rows).toEqual([]);
    const [still] = await database.query<{ total: number }>(
      sql`SELECT COUNT(*) AS total FROM hospitals`,
    );
    expect(Number(still?.total)).toBeGreaterThan(0);
  });

  it('sql.list expande listas e recusa lista vazia; undefined é recusado', () => {
    const statement = sql`SELECT 1 WHERE x IN (${sql.list(['a', 'b'])})`;
    expect(statement.text).toBe('SELECT 1 WHERE x IN (?, ?)');
    expect(statement.values).toEqual(['a', 'b']);
    expect(() => sql.list([])).toThrow(RangeError);
    expect(() => sql`SELECT ${undefined as unknown as string}`).toThrow(TypeError);
  });
});

describe('transações', () => {
  const sectorRow = (code: string) =>
    database.query(
      sql`SELECT id FROM sectors WHERE hospital_id = ${hospitalId} AND code = ${code}`,
    );

  it('confirma (COMMIT) no sucesso e desfaz (ROLLBACK) em qualquer erro', async () => {
    await database.transaction(async (tx) => {
      await tx.execute(
        sql`INSERT INTO sectors (hospital_id, code, name) VALUES (${hospitalId}, 'OK', 'Setor confirmado')`,
      );
    });
    expect(await sectorRow('OK')).toHaveLength(1);

    await expect(
      database.transaction(async (tx) => {
        await tx.execute(
          sql`INSERT INTO sectors (hospital_id, code, name) VALUES (${hospitalId}, 'DESFEITO', 'Setor desfeito')`,
        );
        throw new Error('falha de regra de negócio');
      }),
    ).rejects.toThrow('falha de regra de negócio');
    expect(await sectorRow('DESFEITO')).toHaveLength(0);
  });

  it('dados não confirmados não aparecem para outra conexão (READ COMMITTED)', async () => {
    await database.transaction(async (tx) => {
      await tx.execute(
        sql`INSERT INTO sectors (hospital_id, code, name) VALUES (${hospitalId}, 'ISOLADO', 'Setor isolado')`,
      );
      expect(await sectorRow('ISOLADO')).toHaveLength(0);
      expect(
        await tx.query(
          sql`SELECT id FROM sectors WHERE hospital_id = ${hospitalId} AND code = 'ISOLADO'`,
        ),
      ).toHaveLength(1);
    });
    expect(await sectorRow('ISOLADO')).toHaveLength(1);
  });

  it('reconhece violações pelo nome da chave, do CHECK e do gatilho', async () => {
    const duplicate = await database
      .execute(
        sql`INSERT INTO sectors (hospital_id, code, name) VALUES (${hospitalId}, 'OK', 'Outro nome')`,
      )
      .catch((error: unknown) => error);
    expect(isUniqueViolation(duplicate, 'sectors_hospital_id_code_key')).toBe(true);
    expect(isUniqueViolation(duplicate, 'lower_name')).toBe(false);

    const check = await database
      .execute(
        sql`INSERT INTO profiles (hospital_id, full_name, email, password_hash, role, all_sectors)
                   VALUES (${hospitalId}, 'X', 'X@EXAMPLE.COM', ${PASSWORD_HASH}, 'viewer', true)`,
      )
      .catch((error: unknown) => error);
    expect(isConstraintViolation(check, 'profiles_email_lowercase')).toBe(true);

    const trigger = await database
      .execute(sql`UPDATE audit_logs SET action = 'X' WHERE id = 0 OR TRUE LIMIT 1`)
      .catch((error: unknown) => error);
    const [audit] = await database.query<{ total: number }>(
      sql`SELECT COUNT(*) AS total FROM audit_logs`,
    );
    if (Number(audit?.total) > 0)
      expect(isConstraintViolation(trigger, 'audit_logs_insert_only')).toBe(true);
    expect(isDatabaseUnavailable(duplicate)).toBe(false);
  });
});
