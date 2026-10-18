/**
 * Integração do Prisma ao backend (ET02): E43 executa `SELECT 1` com o cliente Prisma real
 * (adaptador pg) contra o PostgreSQL de teste e responde 503 quando o banco está inacessível.
 */
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../../src/lib/prisma.js';
import { buildTestApp, errorOf } from '../helpers.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? '';
const prisma = createPrismaClient(testDatabaseUrl);
// Porta 1 em localhost: conexão recusada imediatamente.
const unreachable = createPrismaClient('postgresql://postgres:postgres@127.0.0.1:1/postgres');

afterAll(async () => {
  await Promise.all([prisma.$disconnect(), unreachable.$disconnect()]);
});

describe('GET /api/v1/health com PostgreSQL real', () => {
  it('responde 200 quando o SELECT 1 do Prisma é atendido', async () => {
    const response = await request(buildTestApp(prisma)).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect((response.body as { data: { status: string } }).data.status).toBe('ok');
  });

  it('responde 503 SERVICE_UNAVAILABLE quando o banco está inacessível', async () => {
    const response = await request(buildTestApp(unreachable)).get('/api/v1/health');

    expect(response.status).toBe(503);
    expect(errorOf(response).code).toBe('SERVICE_UNAVAILABLE');
  });

  it('lê os dados pelo Prisma Client gerado do schema (modelos mapeados para snake_case)', async () => {
    const tables = await prisma.$queryRaw<{ total: bigint }[]>`
      SELECT count(*) AS total FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    expect(Number(tables[0]?.total)).toBe(18);
    await expect(prisma.auditLog.count()).resolves.toBeGreaterThanOrEqual(0);
    await expect(prisma.surveyVersion.findMany({ take: 1 })).resolves.toBeInstanceOf(Array);
  });
});
