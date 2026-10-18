import { PrismaPg } from '@prisma/adapter-pg';

import { Prisma, PrismaClient } from '../generated/prisma/client.js';

export { Prisma, PrismaClient };
export type { UserRole } from '../generated/prisma/client.js';

/** Cliente usado dentro de `prisma.$transaction(async (tx) => ...)`. */
export type TransactionClient = Prisma.TransactionClient;

/**
 * Cria o cliente Prisma com o adaptador do driver `pg` (Prisma 7). Em produção, `databaseUrl` é o
 * pooler do Supabase em modo transação (porta 6543); localmente, o PostgreSQL do Supabase CLI.
 */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}
