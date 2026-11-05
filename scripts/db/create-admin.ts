/**
 * Cria o primeiro superadministrador de uma instalação nova (produção ou homologação), já que
 * o cadastro de usuários (E07) exige um SA autenticado. Usa o hospital existente (seed
 * database/seeds/001_dados_base.sql) e grava a senha somente como hash bcrypt, com troca
 * obrigatória no primeiro acesso (RF04).
 *
 * Uso (variáveis só na linha de comando, nunca versionadas):
 *   ADMIN_EMAIL=nome@dominio ADMIN_NAME="Nome Completo" ADMIN_PASSWORD=SenhaInicial123 \
 *     npm run db:create-admin
 * Opcional: ADMIN_HOSPITAL_SHORT_NAME (padrão: o único hospital cadastrado).
 * Recusa a criação se o e-mail já existir. Funciona também com servidor remoto (instalação na
 * nuvem): não apaga nem altera dados existentes.
 */
import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { loadDatabaseEnv } from '../../src/lib/env.js';
import { passwordSchema } from '../../src/modules/auth/password-policy.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { connect, describeEnv, loadDotEnv } from './connection.js';

loadDotEnv();

const adminSchema = z.object({
  ADMIN_EMAIL: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  ADMIN_NAME: z.string().trim().min(1).max(120),
  ADMIN_PASSWORD: passwordSchema,
  ADMIN_HOSPITAL_SHORT_NAME: z.string().trim().optional(),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
});

async function main(): Promise<void> {
  const parsed = adminSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Variáveis inválidas: ${parsed.error.issues.map((issue) => `${issue.path.join('.')} (${issue.message})`).join('; ')}`,
    );
  }
  const input = parsed.data;
  const env = loadDatabaseEnv();
  const connection = await connect(env);
  try {
    const [hospitals] = await connection.query(
      input.ADMIN_HOSPITAL_SHORT_NAME === undefined
        ? 'SELECT id, short_name FROM hospitals'
        : 'SELECT id, short_name FROM hospitals WHERE short_name = ?',
      input.ADMIN_HOSPITAL_SHORT_NAME === undefined ? [] : [input.ADMIN_HOSPITAL_SHORT_NAME],
    );
    const list = hospitals as { id: string; short_name: string }[];
    if (list.length !== 1) {
      throw new Error(
        list.length === 0
          ? 'Nenhum hospital encontrado. Execute database/seeds/001_dados_base.sql antes.'
          : 'Há mais de um hospital: informe ADMIN_HOSPITAL_SHORT_NAME.',
      );
    }
    const hospital = list[0] as { id: string; short_name: string };
    const [existing] = await connection.query('SELECT id FROM profiles WHERE email = ?', [
      input.ADMIN_EMAIL,
    ]);
    if ((existing as unknown[]).length > 0)
      throw new Error('Já existe um usuário com este e-mail.');

    const passwordHash = await hashPassword(input.ADMIN_PASSWORD, input.BCRYPT_ROUNDS);
    await connection.query(
      `INSERT INTO profiles (id, hospital_id, full_name, email, password_hash, role, all_sectors, must_change_password)
       VALUES (?, ?, ?, ?, ?, 'superadmin', TRUE, TRUE)`,
      [randomUUID(), hospital.id, input.ADMIN_NAME, input.ADMIN_EMAIL, passwordHash],
    );
    console.info(
      `Superadministrador ${input.ADMIN_EMAIL} criado em ${describeEnv(env)} (hospital ${hospital.short_name}). ` +
        'A senha deve ser trocada no primeiro acesso.',
    );
  } finally {
    await connection.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
