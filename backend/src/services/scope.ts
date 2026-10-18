import type { SectorScope } from '../modules/auth/auth.types.js';
import { AuthorizationDeniedError, HttpError } from '../utils/http-error.js';

/**
 * Aplicação do escopo de setores (RN10, RN18, RF08) nos serviços e nas consultas. O escopo vem de
 * req.auth e é parâmetro obrigatório dos serviços; a interface nunca é o controle de acesso.
 */

export function sectorOutOfScope(): AuthorizationDeniedError {
  return new AuthorizationDeniedError(
    'SECTOR_OUT_OF_SCOPE',
    'O filtro inclui setores fora do seu escopo de acesso.',
  );
}

export function resourceNotFound(): HttpError {
  return new HttpError(404, 'NOT_FOUND', 'O recurso solicitado não foi encontrado.');
}

export function isSectorInScope(scope: SectorScope, sectorId: string): boolean {
  return scope.all || scope.sectorIds.includes(sectorId);
}

/**
 * Interseção entre o filtro pedido e o escopo (RN10). Devolve a lista de setores que a consulta
 * deve usar, ou `undefined` quando não há restrição (escopo global sem filtro).
 * Filtro com qualquer setor fora do escopo → 403 SECTOR_OUT_OF_SCOPE.
 */
export function resolveSectorFilter(
  scope: SectorScope,
  requested?: readonly string[],
): readonly string[] | undefined {
  if (requested !== undefined && requested.length > 0) {
    if (!scope.all && requested.some((sectorId) => !scope.sectorIds.includes(sectorId))) {
      throw sectorOutOfScope();
    }
    return [...new Set(requested)];
  }
  return scope.all ? undefined : scope.sectorIds;
}

/** Condição Prisma `{ sectorId: { in } }` (ou `{}`) para a coluna de setor do recurso. */
export function sectorWhere(
  scope: SectorScope,
  requested?: readonly string[],
): { sectorId?: { in: string[] } } {
  const sectorIds = resolveSectorFilter(scope, requested);
  return sectorIds === undefined ? {} : { sectorId: { in: [...sectorIds] } };
}

/**
 * Recurso individual de um setor fora do escopo → 404, sem revelar sua existência (RN10).
 * Use também quando o recurso não existe, para que as duas situações sejam indistinguíveis.
 */
export function assertResourceInScope(scope: SectorScope, sectorId: string | undefined): void {
  if (sectorId === undefined || !isSectorInScope(scope, sectorId)) throw resourceNotFound();
}
