import { PrismaPg } from '@prisma/adapter-pg';

import { Prisma, PrismaClient } from '../generated/prisma/client.js';

export { Prisma, PrismaClient };
export type {
  AttributionStatus,
  ManifestationEventKind,
  ManifestationPriority,
  ManifestationStatus,
  ManifestationType,
  QuestionType,
  ResponseOrigin,
  ShiftPeriod,
  UserRole,
} from '../generated/prisma/client.js';

/** Cliente usado dentro de `prisma.$transaction(async (tx) => ...)`. */
export type TransactionClient = Prisma.TransactionClient;

/** Transações que incluem uma chamada ao Supabase Auth podem demorar mais que o padrão (5 s). */
export const AUTH_TRANSACTION_OPTIONS = { timeout: 15_000, maxWait: 5_000 } as const;

/**
 * Cria o cliente Prisma com o adaptador do driver `pg` (Prisma 7). Em produção, `databaseUrl` é o
 * pooler do Supabase em modo transação (porta 6543); localmente, o PostgreSQL do Supabase CLI.
 */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}
