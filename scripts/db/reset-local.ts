/**
 * Reinicializa o banco LOCAL de desenvolvimento: apaga e recria DB_NAME, reaplica todas as
 * migrations e executa o seed de demonstração. Nunca roda contra servidor remoto.
 * Uso: `npm run db:reset` (na raiz do repositório). ATENÇÃO: apaga todos os dados de DB_NAME.
 */
import { spawnSync } from 'node:child_process';

import { loadDatabaseEnv } from '../../src/lib/env.js';
import { connect, describeEnv, loadDotEnv, recreateLocalDatabase } from './connection.js';
import { assertLocalTargets } from './guard.js';
import { applyPendingMigrations } from './migrations.js';

loadDotEnv();

async function main(): Promise<void> {
  const env = loadDatabaseEnv();
  // Verificação explícita do ambiente: somente servidor local.
  assertLocalTargets({ DB_HOST: env.DB_HOST }, 'Reinicialização do banco');

  console.info(`Reinicializando ${describeEnv(env)} (banco local)...`);
  await recreateLocalDatabase(env);
  const connection = await connect(env);
  try {
    await applyPendingMigrations(connection, (message) => {
      console.info(`  ${message}`);
    });
  } finally {
    await connection.end();
  }
  const seed = spawnSync('npx', ['tsx', 'scripts/db/seed.ts'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
  if (seed.status !== 0) throw new Error('Falha ao executar o seed de demonstração.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
