import { existsSync } from 'node:fs';

import { createApp } from './app.js';
import { createDatabase } from './lib/database.js';
import { EnvValidationError, loadEnv } from './lib/env.js';
import { createLogger } from './lib/logger.js';

// Em desenvolvimento, lê o .env da raiz; em produção as variáveis vêm do painel do serviço.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

function start(): void {
  const env = loadEnv();
  const logger = createLogger(env);
  // Pool de conexões MySQL: a primeira conexão é aberta na primeira consulta; banco indisponível
  // responde 503 SERVICE_UNAVAILABLE (inclusive em GET /api/v1/health) sem derrubar a API.
  const db = createDatabase(env);
  const app = createApp({
    env,
    logger,
    db,
    auth: {
      jwtSecret: env.JWT_SECRET,
      accessTokenTtlSeconds: env.JWT_ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
      bcryptRounds: env.BCRYPT_ROUNDS,
    },
  });

  const server = app.listen(env.PORT, () => {
    logger.info(
      {
        port: env.PORT,
        nodeEnv: env.NODE_ENV,
        database: `${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}`,
      },
      'API FHDOD iniciada',
    );
  });

  // Desligamento ordenado: para de aceitar conexões, conclui as requisições e fecha o pool.
  const shutdown = (signal: NodeJS.Signals) => {
    logger.info({ signal }, 'Encerrando a API');
    server.close(() => {
      void db
        .close()
        .catch((error: unknown) => {
          logger.error({ err: error }, 'Falha ao encerrar o pool do MySQL');
        })
        .finally(() => process.exit(0));
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
