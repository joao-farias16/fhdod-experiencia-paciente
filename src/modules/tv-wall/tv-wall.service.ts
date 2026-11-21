import type { Queryable } from '../../lib/database.js';
import { addDays, localDateOf } from '../../utils/dates.js';
import { HttpError } from '../../utils/errors.js';
import {
  isSuppressed,
  type ResolvedFilters,
  SUPPRESSION_THRESHOLD,
} from '../dashboard/dashboard.filters.js';
import { getTrends } from '../dashboard/dashboard.service.js';
import { computeNps, percentOf } from '../dashboard/nps.js';
import {
  countHospitalResponses,
  countSectorResponses,
  findTvWallHospitalIds,
} from './tv-wall.repository.js';
import {
  TV_WALL_MAX_SECTORS,
  TV_WALL_PERIOD_DAYS,
  type TvWallPeriodKey,
  type TvWallSummary,
  tvWallSummarySchema,
} from './tv-wall.schemas.js';

export interface TvWallDeps {
  db: Queryable;
  /** short_name do hospital exibido (TV_WALL_HOSPITAL_SHORT_NAME); sem valor, o único cadastrado. */
  hospitalShortName: string | undefined;
}

/** TV Wall sem hospital definido (nenhum ou mais de um sem configuração): 503 sem detalhes. */
export class TvWallUnavailableError extends HttpError {
  constructor(readonly reason: 'hospital_not_found' | 'multiple_hospitals') {
    super(503, 'SERVICE_UNAVAILABLE', 'A TV Wall está temporariamente indisponível.');
    this.name = 'TvWallUnavailableError';
  }
}

async function resolveHospitalId(deps: TvWallDeps): Promise<string> {
  const ids = await findTvWallHospitalIds(deps.db, deps.hospitalShortName);
  if (ids.length === 0) throw new TvWallUnavailableError('hospital_not_found');
  if (ids.length > 1) throw new TvWallUnavailableError('multiple_hospitals');
  return ids[0] as string;
}

/** Período local inclusivo terminando hoje (America/Sao_Paulo), com `days` dias (RN25). */
export function tvWallPeriod(key: TvWallPeriodKey, now: Date): { from: string; to: string } {
  const to = localDateOf(now);
  return { from: addDays(to, -(TV_WALL_PERIOD_DAYS[key] - 1)), to };
}

/** Ordem do RF55 (mesma agregação de E29): maior NPS primeiro; empate pelo nome. */
function byNpsThenName(a: { nps: number; name: string }, b: { nps: number; name: string }): number {
  return b.nps - a.nps || a.name.localeCompare(b.name, 'pt-BR');
}

/**
 * E42 — indicadores agregados da TV Wall (RF68–RF72, RN09, RN21), calculados a cada chamada sobre
 * as respostas persistidas do hospital (RN14):
 * - overall: NPS, n e percentuais de promotores e detratores; com 1 a 4 respostas, tudo nulo e
 *   `suppressed: true` (RF71: "total 4 sem valores");
 * - trend: série do E32 (dia para 7 e 30 dias, semana para 90), cada ponto com 1 a 4 respostas
 *   anulado;
 * - sectors: até 8 setores com 5 respostas ou mais (HAVING no banco), ordenados por NPS.
 * Sem recortes por turno, equipe, pesquisa ou origem; nenhum texto, contato, protocolo ou usuário.
 * O resultado passa pela lista explícita de campos (tvWallSummarySchema) antes de sair.
 */
export async function getTvWallSummary(
  deps: TvWallDeps,
  key: TvWallPeriodKey,
  now: Date,
): Promise<TvWallSummary> {
  const hospitalId = await resolveHospitalId(deps);
  const filters: ResolvedFilters = {
    ...tvWallPeriod(key, now),
    hospitalId,
    sectorIds: undefined,
    surveyId: undefined,
    period: undefined,
    teamIds: undefined,
    origin: undefined,
    // RN21: na TV Wall a supressão vale sempre, para qualquer pessoa.
    suppress: true,
  };

  const [overallCounts, sectorCounts, trend] = await Promise.all([
    countHospitalResponses(deps.db, filters),
    countSectorResponses(deps.db, filters, SUPPRESSION_THRESHOLD),
    getTrends(deps.db, filters),
  ]);

  const overallSuppressed = isSuppressed(filters, overallCounts.total);
  const overall = overallSuppressed
    ? { n: null, nps: null, promotersPercent: null, detractorsPercent: null, suppressed: true }
    : {
        n: overallCounts.total,
        nps: computeNps(overallCounts),
        promotersPercent: percentOf(overallCounts.promoters, overallCounts.total),
        detractorsPercent: percentOf(overallCounts.detractors, overallCounts.total),
        suppressed: false,
      };

  const sectors = sectorCounts
    .filter((row) => row.total >= SUPPRESSION_THRESHOLD)
    .map((row) => ({
      name: row.name,
      n: row.total,
      // total ≥ 5: NPS e percentuais nunca são nulos aqui.
      nps: computeNps(row) ?? 0,
      promotersPercent: percentOf(row.promoters, row.total) ?? 0,
      detractorsPercent: percentOf(row.detractors, row.total) ?? 0,
    }))
    .sort(byNpsThenName)
    .slice(0, TV_WALL_MAX_SECTORS);

  if (trend.granularity === 'month') {
    // Os períodos da TV Wall têm no máximo 90 dias: a granularidade é sempre dia ou semana.
    throw new HttpError(500, 'INTERNAL_ERROR', 'Ocorreu um erro inesperado. Tente novamente.');
  }

  return tvWallSummarySchema.parse({
    period: { key, from: filters.from, to: filters.to },
    generatedAt: now.toISOString(),
    suppressionThreshold: SUPPRESSION_THRESHOLD,
    overall,
    trend: {
      granularity: trend.granularity,
      points: trend.points.map((point) => ({
        start: point.start,
        end: point.end,
        n: point.n,
        nps: point.nps,
        suppressed: point.suppressed,
      })),
    },
    sectors,
  });
}
