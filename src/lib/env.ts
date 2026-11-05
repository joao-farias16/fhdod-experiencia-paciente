import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** Variável vazia no .env equivale a ausente. */
const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === '' ? undefined : value));

const booleanText = z
  .enum(['true', 'false', ''])
  .optional()
  .transform((value) => value === 'true');

/** Nome de banco MySQL: letras, números e _ (até 64 caracteres). */
export const databaseName = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_]{1,64}$/, 'Use somente letras, números e _ (até 64 caracteres).');

/** Segredo de 32+ caracteres (HMAC e assinatura de tokens). */
const secret = (message: string) => z.string().trim().min(32, message);

/**
 * Variáveis de ambiente usadas pela API (Tabela 15 da especificação, atualizada na Etapa 3).
 * Banco MySQL: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, DB_CONNECTION_LIMIT, DB_SSL e
 * DB_SSL_CA. Autenticação própria: JWT_SECRET, JWT_ACCESS_TOKEN_TTL_SECONDS,
 * REFRESH_TOKEN_TTL_DAYS e BCRYPT_ROUNDS. TEST_DB_* e SEED_* são lidas só pelos testes e scripts.
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

  // --- MySQL (Etapa 3) ---
  DB_HOST: z.string().trim().min(1, 'Informe o servidor MySQL.').default('localhost'),
  DB_PORT: z.coerce.number().int().min(1).max(65_535).default(3306),
  DB_USER: z.string().trim().min(1, 'Informe o usuário do MySQL.'),
  // Pode ser vazia somente em instalação local sem senha (proibido em produção).
  DB_PASSWORD: z.string().default(''),
  DB_NAME: databaseName.default('fhdod'),
  DB_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
  // TLS obrigatório na nuvem (true); localmente, normalmente false.
  DB_SSL: booleanText,
  // Caminho do certificado da autoridade (PEM) exigido por alguns provedores; opcional.
  DB_SSL_CA: optionalText,

  // --- Autenticação própria (Etapa 3, substitui o Supabase Auth) ---
  // Assinatura HS256 dos tokens de acesso; somente no backend.
  JWT_SECRET: secret('Use ao menos 32 caracteres.'),
  JWT_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3600),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  // Custo do bcrypt: 12 em produção; os testes usam 4 para rodar rápido.
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),

  // HMAC do IP gravado em audit_logs.ip_hash (Seção 10); obrigatório em produção.
  AUDIT_IP_SECRET: secret('Use ao menos 32 caracteres.')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  // Endereço público do frontend: base das URLs de link e QR Code /p/<slug> (RF30, E27).
  PUBLIC_APP_URL: z
    .url({ protocol: /^https?$/, message: 'Informe a URL http(s) do frontend.' })
    .transform((value) => value.replace(/\/+$/, ''))
    .default('http://localhost:5173'),
  // HMAC do token de manifestação devolvido por E02 (Seção 4.3); obrigatório em produção.
  MANIFESTATION_TOKEN_SECRET: secret('Use ao menos 32 caracteres.')
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
  // RNF09 e Seção 10: exigências adicionais em produção.
  if (env.NODE_ENV === 'production') {
    const insecure = env.CORS_ORIGIN.filter((origin) => !origin.startsWith('https://'));
    if (insecure.length > 0) {
      throw new EnvValidationError([
        'CORS_ORIGIN: em produção, todas as origens devem usar https.',
      ]);
    }
    if (env.DB_PASSWORD === '') {
      throw new EnvValidationError(['DB_PASSWORD: obrigatória em produção.']);
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
    if (env.BCRYPT_ROUNDS < 10) {
      throw new EnvValidationError(['BCRYPT_ROUNDS: em produção, use ao menos 10.']);
    }
  }
  return env;
}

/** Somente as variáveis de conexão (scripts de banco, sem exigir as demais). */
export const databaseEnvSchema = envSchema.pick({
  DB_HOST: true,
  DB_PORT: true,
  DB_USER: true,
  DB_PASSWORD: true,
  DB_NAME: true,
  DB_CONNECTION_LIMIT: true,
  DB_SSL: true,
  DB_SSL_CA: true,
});

export type DatabaseConnectionEnv = z.infer<typeof databaseEnvSchema>;

export function loadDatabaseEnv(source: NodeJS.ProcessEnv = process.env): DatabaseConnectionEnv {
  const result = databaseEnvSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return result.data;
}
