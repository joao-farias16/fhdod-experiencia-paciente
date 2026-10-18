import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Arquivo com as contas fictícias da execução (ignorado pelo Git; apagado no teardown). */
export const FIXTURE_FILE = resolve(import.meta.dirname, '../playwright/.cache/e2e-fixture.json');

export interface E2EAccount {
  email: string;
  password: string;
}

export interface E2EFixture {
  hospitalId: string;
  accounts: { sa: E2EAccount; vi: E2EAccount };
}

/** Executa backend/scripts/e2e/fixture.ts (banco de teste e Supabase Auth locais). */
export function runFixture(command: 'setup' | 'teardown'): void {
  const result = spawnSync('npx', ['tsx', 'scripts/e2e/fixture.ts', command, FIXTURE_FILE], {
    cwd: resolve(import.meta.dirname, '../../backend'),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) throw new Error(`Falha ao preparar os dados E2E (${command}).`);
}

export function readFixture(): E2EFixture {
  if (!existsSync(FIXTURE_FILE))
    throw new Error('Dados E2E ausentes: o global-setup não foi executado.');
  return JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')) as E2EFixture;
}
