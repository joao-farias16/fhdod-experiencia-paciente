/**
 * Reinicializa o banco LOCAL: apaga o esquema public, reaplica todas as migrations e executa o
 * seed determinístico. Estratégia de repetição do seed (ET02) — nunca roda contra banco remoto.
 * Uso: `npm run db:reset` (raiz) ou `npm run db:reset -w backend`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { assertLocalTargets, describeUrl } from './guard.js';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`Falha ao executar: ${command} ${args.join(' ')}`);
  }
}

try {
  const { DATABASE_URL, DIRECT_URL } = process.env;
  if (DATABASE_URL === undefined || DATABASE_URL === '') {
    throw new Error('DATABASE_URL não definida.');
  }
  // Verificação explícita do ambiente: as duas URLs precisam ser locais.
  assertLocalTargets({ DATABASE_URL, DIRECT_URL }, 'Reinicialização do banco');

  console.info(`Reinicializando ${describeUrl(DIRECT_URL ?? DATABASE_URL)} (banco local)...`);
  run('npx', ['prisma', 'migrate', 'reset', '--force']);
  run('npx', ['tsx', 'prisma/seed.ts']);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
