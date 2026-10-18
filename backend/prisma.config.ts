import { existsSync } from 'node:fs';

import { defineConfig } from 'prisma/config';

// O Prisma 7 não carrega o .env sozinho. Em desenvolvimento, lê backend/.env; na CI e na
// publicação as variáveis vêm do ambiente.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

/**
 * Configuração do Prisma CLI (Seção 8 e Tabela 15).
 * As migrations usam DIRECT_URL (pooler em modo sessão, porta 5432, no Supabase); a aplicação usa
 * DATABASE_URL (pooler em modo transação, porta 6543) por meio do adaptador @prisma/adapter-pg.
 * `prisma generate` e `prisma validate` não precisam de conexão; por isso a URL pode estar ausente.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '',
  },
});
