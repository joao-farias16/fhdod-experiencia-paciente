import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** URL de conexão PostgreSQL (postgres:// ou postgresql://). */
export const postgresUrl = z.url({
  protocol: /^postgres(ql)?$/,
  message: 'Informe uma URL postgresql:// válida.',
});

/**
 * Variáveis de ambiente usadas pela API (Tabela 15 da especificação).
 * DATABASE_URL entrou na ET02; as variáveis do Supabase Auth e os segredos HMAC entram no
 * esquema nas etapas que efetivamente as utilizarem. DIRECT_URL é lida só pelo Prisma CLI
 * (prisma.config.ts); TEST_DATABASE_URL e SEED_* só pelos testes e pelo seed.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3333),
  CORS_ORIGIN: z
    .string()
    .trim()
    .min(1, 'Informe ao menos uma origem permitida.')
    .transform((value) => value.split(',').map((origin) => origin.trim()))
    .pipe(z.array(z.url({ protocol: /^https?$/, message: 'Origem inválida.' })).min(1)),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  // Pooler do Supabase em modo transação (porta 6543) em produção; PostgreSQL local em desenvolvimento.
  DATABASE_URL: postgresUrl,
});

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Configuração de ambiente inválida:\n- ${issues.join('\n- ')}`);
    this.name = 'EnvValidationError';
  }
}

/** Valida as variáveis de ambiente; lança EnvValidationError sem expor os valores recebidos. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => {
        const path = issue.path.join('.');
        return `${path === '' ? '(raiz)' : path}: ${issue.message}`;
      }),
    );
  }
  const env = result.data;
  // RNF09: em produção, as origens autorizadas devem usar HTTPS.
  if (env.NODE_ENV === 'production') {
    const insecure = env.CORS_ORIGIN.filter((origin) => !origin.startsWith('https://'));
    if (insecure.length > 0) {
      throw new EnvValidationError([
        'CORS_ORIGIN: em produção, todas as origens devem usar https.',
      ]);
    }
  }
  return env;
}
