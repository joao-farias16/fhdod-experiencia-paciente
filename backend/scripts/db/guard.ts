/**
 * Proteções de ambiente para scripts de banco (seed, reinicialização e testes).
 * Nenhum script destrutivo ou de carga roda contra um banco remoto sem autorização explícita
 * (SEED_ALLOW_REMOTE=true, Tabela 15). A reinicialização e os testes nunca rodam fora do local.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Indica se a URL aponta para um servidor local (Supabase CLI, Docker ou serviço da CI). */
export function isLocalUrl(rawUrl: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(rawUrl).hostname);
  } catch {
    return false;
  }
}

/** Descreve a URL sem credenciais, para mensagens e evidências. */
export function describeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.protocol}//${url.hostname}:${url.port || '(padrão)'}${url.pathname}`;
  } catch {
    return '(URL inválida)';
  }
}

export class UnsafeTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeTargetError';
  }
}

/** Exige que todas as URLs informadas sejam locais; caso contrário, interrompe o script. */
export function assertLocalTargets(urls: Record<string, string | undefined>, action: string): void {
  for (const [name, value] of Object.entries(urls)) {
    if (value !== undefined && value !== '' && !isLocalUrl(value)) {
      throw new UnsafeTargetError(
        `Operação recusada (${action}): ${name} aponta para ${describeUrl(value)}, que não é um servidor local.`,
      );
    }
  }
}
