/**
 * Proteções de ambiente para scripts de banco (seed, reinicialização e testes).
 * Nenhum script destrutivo ou de carga roda contra um servidor MySQL remoto sem autorização
 * explícita (SEED_ALLOW_REMOTE=true). A reinicialização e os testes nunca rodam fora do local.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Indica se o host do MySQL é local (instalação na máquina, Docker ou serviço da CI). */
export function isLocalHost(host: string | undefined): boolean {
  return host !== undefined && LOCAL_HOSTS.has(host.trim().toLowerCase());
}

/** Descreve o destino sem credenciais, para mensagens e evidências. */
export function describeTarget(target: { host: string; port: number; database?: string }): string {
  return `mysql://${target.host}:${target.port}${target.database === undefined ? '' : `/${target.database}`}`;
}

export class UnsafeTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeTargetError';
  }
}

/** Exige que todos os hosts informados sejam locais; caso contrário, interrompe o script. */
export function assertLocalTargets(
  hosts: Record<string, string | undefined>,
  action: string,
): void {
  for (const [name, value] of Object.entries(hosts)) {
    if (value !== undefined && value !== '' && !isLocalHost(value)) {
      throw new UnsafeTargetError(
        `Operação recusada (${action}): ${name}=${value} não é um servidor local.`,
      );
    }
  }
}
