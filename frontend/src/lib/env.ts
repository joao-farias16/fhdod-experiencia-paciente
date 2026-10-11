/** Ambientes reconhecidos pela interface. */
export type AppEnv = 'development' | 'test' | 'production';

export interface PublicEnv {
  apiBaseUrl: string;
  appEnv: AppEnv;
}

const APP_ENVS: readonly AppEnv[] = ['development', 'test', 'production'];

function isAppEnv(value: string): value is AppEnv {
  return (APP_ENVS as readonly string[]).includes(value);
}

/**
 * Lê e valida as variáveis públicas do Vite (somente VITE_*). Em produção, a URL da API
 * absoluta deve usar HTTPS (RNF09).
 */
export function parsePublicEnv(source: Record<string, string | undefined>): PublicEnv {
  const apiBaseUrl = (source.VITE_API_BASE_URL ?? '/api/v1').trim().replace(/\/+$/, '');
  const appEnv = (source.VITE_APP_ENV ?? 'development').trim();

  if (!isAppEnv(appEnv)) {
    throw new Error(`VITE_APP_ENV inválido. Use: ${APP_ENVS.join(', ')}.`);
  }
  const isRelative = apiBaseUrl.startsWith('/');
  if (!isRelative && !/^https?:\/\//.test(apiBaseUrl)) {
    throw new Error('VITE_API_BASE_URL deve ser um caminho relativo (/api/v1) ou uma URL http(s).');
  }
  if (appEnv === 'production' && !isRelative && !apiBaseUrl.startsWith('https://')) {
    throw new Error('Em produção, VITE_API_BASE_URL deve usar https://.');
  }
  return { apiBaseUrl, appEnv };
}

export const env: PublicEnv = parsePublicEnv(import.meta.env);
