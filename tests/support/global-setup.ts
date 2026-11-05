/**
 * Preparação dos testes de banco (Seção 12: integração com MySQL real).
 * 1. lê TEST_DB_* (cada uma cai para a DB_* correspondente; banco padrão `fhdod_test`) e exige
 *    servidor LOCAL e banco diferente do de desenvolvimento (DB_NAME);
 * 2. recria o banco de testes do zero (DROP/CREATE: ele só contém dados de teste);
 * 3. aplica as migrations versionadas de database/migrations com o mesmo executor da CLI.
 */
import { applyPendingMigrations } from '../../scripts/db/migrations.js';
import {
  connect,
  describeEnv,
  loadDotEnv,
  loadTestDatabaseEnv,
  recreateLocalDatabase,
} from '../../scripts/db/connection.js';

export default async function setup(): Promise<void> {
  loadDotEnv();
  let env;
  try {
    env = loadTestDatabaseEnv();
  } catch (error) {
    throw new Error(
      `Banco de testes não configurado (${error instanceof Error ? error.message : String(error)}). ` +
        'Defina DB_USER/DB_PASSWORD (e, se preciso, TEST_DB_*) no .env conforme .env.example.',
      { cause: error },
    );
  }
  await recreateLocalDatabase(env);
  const connection = await connect(env);
  try {
    await applyPendingMigrations(connection);
  } catch (error) {
    throw new Error(
      `Falha ao migrar ${describeEnv(env)}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  } finally {
    await connection.end();
  }
}
