import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** URL de conexão PostgreSQL (postgres:// ou postgresql://). */
export const postgresUrl = z.url({
  protocol: /^postgres(ql)?$/,
  message: 'Informe uma URL postgresql:// válida.',
});

/**
 * Variáveis de ambiente usadas pela API (Tabela 15 da especificação).
 * DATABASE_URL entrou na ET02; SUPABASE_URL, SUPABASE_SECRET_KEY e AUDIT_IP_SECRET, na ET03
 * (autenticação e auditoria); PUBLIC_APP_URL (links e QR Code, ET05) e MANIFESTATION_TOKEN_SECRET
 * (token devolvido por E02, ET06). DIRECT_URL é lida só pelo Prisma CLI (prisma.config.ts);
 * TEST_DATABASE_URL e SEED_* só pelos testes e pelo seed.
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
  // Supabase Auth (ET03): a chave secreta existe somente no backend (Seção 10).
  SUPABASE_URL: z.url({ protocol: /^https?$/, message: 'Informe a URL http(s) do Supabase.' }),
  SUPABASE_SECRET_KEY: z.string().trim().min(1, 'Informe a chave secreta do Supabase.'),
  // HMAC do IP gravado em audit_logs.ip_hash (Seção 10); obrigatório em produção.
  AUDIT_IP_SECRET: z
    .string()
    .trim()
    .min(32, 'Use ao menos 32 caracteres.')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  // Endereço público do frontend: base das URLs de link e QR Code /p/<slug> (RF30, E27).
  PUBLIC_APP_URL: z
    .url({ protocol: /^https?$/, message: 'Informe a URL http(s) do frontend.' })
    .transform((value) => value.replace(/\/+$/, ''))
    .default('http://localhost:5173'),
  // HMAC do token de manifestação devolvido por E02 (Seção 4.3); obrigatório em produção.
  MANIFESTATION_TOKEN_SECRET: z
    .string()
    .trim()
    .min(32, 'Use ao menos 32 caracteres.')
    .optional()
    .or(z.literal('').transform(() => undefined)),
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
    if (!env.SUPABASE_URL.startsWith('https://')) {
      throw new EnvValidationError(['SUPABASE_URL: em produção, use https.']);
    }
    if (env.AUDIT_IP_SECRET === undefined) {
      throw new EnvValidationError(['AUDIT_IP_SECRET: obrigatória em produção.']);
    }
    if (env.MANIFESTATION_TOKEN_SECRET === undefined) {
      throw new EnvValidationError(['MANIFESTATION_TOKEN_SECRET: obrigatória em produção.']);
    }
    if (!env.PUBLIC_APP_URL.startsWith('https://')) {
      throw new EnvValidationError(['PUBLIC_APP_URL: em produção, use https.']);
    }
  }
  return env;
}
