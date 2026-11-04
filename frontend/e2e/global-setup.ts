import { runFixture } from './support';

/**
 * Cria os dados E2E (banco de teste e Supabase Auth locais) antes da execução; a função devolvida
 * é o teardown do Playwright, que exclui as contas fictícias ao final.
 */
export default function globalSetup(): () => void {
  runFixture('setup');
  return () => {
    runFixture('teardown');
  };
}
