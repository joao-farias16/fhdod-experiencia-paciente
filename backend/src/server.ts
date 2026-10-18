import { existsSync } from 'node:fs';

import { createApp } from './app.js';
import { EnvValidationError, loadEnv } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { createPrismaClient } from './lib/prisma.js';
import { createSupabaseAuth } from './lib/supabase.js';

// Em desenvolvimento, lê backend/.env; em produção as variáveis vêm do painel do serviço.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

function start(): void {
  const env = loadEnv();
  const logger = createLogger(env);
  const prisma = createPrismaClient(env.DATABASE_URL);
  const app = createApp({ env, logger, prisma, auth: createSupabaseAuth(env) });

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, 'API FHDOD iniciada');
  });

  const shutdown = (signal: NodeJS.Signals) => {
    logger.info({ signal }, 'Encerrando a API');
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

try {
  start();
} catch (error) {
  if (error instanceof EnvValidationError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  throw error;
}
