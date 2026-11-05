import type { Queryable } from '../../lib/database.js';
import { sql, type SqlStatement } from '../../lib/sql.js';
import { addDays, startOfLocalDay } from '../../utils/dates.js';
import { type LocalPeriod, resolvePeriod } from '../../utils/validation.js';
import type { AuthContext } from '../auth/auth.types.js';
import { isSectorInScope, resolveSectorFilter, sectorOutOfScope } from '../auth/scope.js';
import { findSurveyScope } from '../surveys/surveys.repository.js';
import { findTeamsByIds } from '../teams/teams.repository.js';
import type { DashboardFilters } from './dashboard.schemas.js';

/**
 * Filtros comuns do dashboard (E28–E33) e dos relatórios (E34): resolução do pedido contra o
 * escopo e as condições SQL parametrizadas sobre as respostas.
 */

/** RN21: para o Visualizador, valores calculados sobre menos de 5 respostas são ocultados. */
export const SUPPRESSION_THRESHOLD = 5;

/** Filtros já resolvidos: período efetivo e interseção com o escopo (RN10). */
export interface ResolvedFilters extends LocalPeriod {
  hospitalId: string;
  /** undefined = todos os setores do hospital (escopo global sem filtro). */
  sectorIds: readonly string[] | undefined;
  surveyId: string | undefined;
  period: DashboardFilters['period'];
  teamIds: readonly string[] | undefined;
  origin: DashboardFilters['origin'];
  /** RN21: supressão para o Visualizador. */
  suppress: boolean;
}

/**
 * Período, setores e recortes do pedido. Setores, pesquisa ou equipes fora do escopo → 403
 * SECTOR_OUT_OF_SCOPE (RN10); identificadores inexistentes simplesmente não trazem dados.
 */
export async function resolveFilters(
  db: Queryable,
  auth: AuthContext,
  query: DashboardFilters,
  now: Date,
): Promise<ResolvedFilters> {
  const sectorIds = resolveSectorFilter(auth.scope, query.sectorIds);
  if (query.surveyId !== undefined) {
    const survey = await findSurveyScope(db, query.surveyId);
    if (
      survey !== null &&
      (survey.hospitalId !== auth.hospitalId || !isSectorInScope(auth.scope, survey.sectorId))
    ) {
      throw sectorOutOfScope();
    }
  }
  if (query.teamIds !== undefined) {
    const teams = await findTeamsByIds(db, query.teamIds);
    if (
      teams.some(
        (team) =>
          team.hospitalId !== auth.hospitalId || !isSectorInScope(auth.scope, team.sectorId),
      )
    ) {
      throw sectorOutOfScope();
    }
  }
  return {
    ...resolvePeriod(query, now),
    hospitalId: auth.hospitalId,
    sectorIds,
    surveyId: query.surveyId,
    period: query.period,
    teamIds: query.teamIds,
    origin: query.origin,
    suppress: auth.role === 'viewer',
  };
}

/** Lista para IN; lista vazia não casa com nada (escopo restrito sem setores). */
function inList(column: SqlStatement, values: readonly string[]): SqlStatement {
  return values.length === 0 ? sql`FALSE` : sql`${column} IN (${sql.list(values)})`;
}

/**
 * Condições sobre responses r (e survey_versions sv). `cuts`: inclui os recortes por turno e
 * equipe, que só alcançam respostas atribuídas (RN14, RF57); sem eles, o mesmo recorte serve de
 * base para a cobertura de atribuição.
 */
export function responseConditions(filters: ResolvedFilters, cuts = true): SqlStatement {
  const conditions = [
    sql`r.submitted_at >= ${startOfLocalDay(filters.from)}`,
    sql`r.submitted_at < ${startOfLocalDay(addDays(filters.to, 1))}`,
  ];
  if (filters.sectorIds !== undefined) {
    conditions.push(inList(sql`r.sector_id`, filters.sectorIds));
  }
  if (filters.surveyId !== undefined) {
    conditions.push(sql`sv.survey_config_id = ${filters.surveyId}`);
  }
  if (filters.origin !== undefined) {
    conditions.push(sql`r.origin = ${filters.origin}`);
  }
  if (cuts && filters.period !== undefined) {
    conditions.push(sql`r.shift_period = ${filters.period}`);
  }
  if (cuts && filters.teamIds !== undefined) {
    conditions.push(inList(sql`r.team_id`, filters.teamIds));
  }
  return sql.join(conditions, ' AND ');
}

/** Respostas do hospital com setor e versão (para os filtros por pesquisa). */
export const RESPONSES_FROM = sql`
  responses r
  JOIN sectors s ON s.id = r.sector_id
  JOIN survey_versions sv ON sv.id = r.survey_version_id`;

/** RN21: grupo com 1 a 4 respostas é ocultado para o Visualizador (0 respostas não esconde nada). */
export function isSuppressed(filters: Pick<ResolvedFilters, 'suppress'>, n: number): boolean {
  return filters.suppress && n > 0 && n < SUPPRESSION_THRESHOLD;
}
