import { existsSync } from 'node:fs';

import { createApp } from './app.js';
import { EnvValidationError, loadEnv } from './config/env.js';
import { createLogger } from './lib/logger.js';

// Em desenvolvimento, lê backend/.env; em produção as variáveis vêm do painel do serviço.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

function start(): void {
  const env = loadEnv();
  const logger = createLogger(env);
  const app = createApp({ env, logger });

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, 'API FHDOD iniciada');
  });

  const shutdown = (signal: NodeJS.Signals) => {
    logger.info({ signal }, 'Encerrando a API');
    server.close(() => process.exit(0));
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
