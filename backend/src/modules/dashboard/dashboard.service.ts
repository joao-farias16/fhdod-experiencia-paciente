import { Prisma, type PrismaClient } from '../../lib/prisma.js';
import { computeNps } from '../../services/nps.js';
import { isSectorInScope, resolveSectorFilter, sectorOutOfScope } from '../../services/scope.js';
import { addDays, daysInclusive, HOSPITAL_TIME_ZONE, startOfLocalDay } from '../../utils/dates.js';
import { type LocalPeriod, resolvePeriod } from '../../utils/period.js';
import type { AuthContext } from '../auth/auth.types.js';
import {
  type DashboardFilters,
  type Granularity,
  GRANULARITY_MAX_DAYS,
  SHIFT_PERIODS,
} from './dashboard.schemas.js';

/** RN21: para o Visualizador, valores calculados sobre menos de 5 respostas são ocultados. */
export const SUPPRESSION_THRESHOLD = 5;

type Db = Pick<PrismaClient, '$queryRaw' | 'surveyConfig' | 'team'>;

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
  prisma: Pick<PrismaClient, 'surveyConfig' | 'team'>,
  auth: AuthContext,
  query: DashboardFilters,
  now: Date,
): Promise<ResolvedFilters> {
  const sectorIds = resolveSectorFilter(auth.scope, query.sectorIds);
  if (query.surveyId !== undefined) {
    const survey = await prisma.surveyConfig.findUnique({
      where: { id: query.surveyId },
      select: { sectorId: true, sector: { select: { hospitalId: true } } },
    });
    if (
      survey !== null &&
      (survey.sector.hospitalId !== auth.hospitalId ||
        !isSectorInScope(auth.scope, survey.sectorId))
    ) {
      throw sectorOutOfScope();
    }
  }
  if (query.teamIds !== undefined) {
    const teams = await prisma.team.findMany({
      where: { id: { in: query.teamIds } },
      select: { sectorId: true, sector: { select: { hospitalId: true } } },
    });
    if (
      teams.some(
        (team) =>
          team.sector.hospitalId !== auth.hospitalId || !isSectorInScope(auth.scope, team.sectorId),
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

/**
 * Condições sobre responses r (e survey_versions sv). `cuts`: inclui os recortes por turno e
 * equipe, que só alcançam respostas atribuídas (RN14, RF57); sem eles, o mesmo recorte serve de
 * base para a cobertura de atribuição.
 */
export function responseConditions(filters: ResolvedFilters, cuts = true): Prisma.Sql {
  const conditions = [
    Prisma.sql`r.submitted_at >= ${startOfLocalDay(filters.from)}`,
    Prisma.sql`r.submitted_at < ${startOfLocalDay(addDays(filters.to, 1))}`,
  ];
  if (filters.sectorIds !== undefined) {
    conditions.push(Prisma.sql`r.sector_id = ANY(${[...filters.sectorIds]}::uuid[])`);
  }
  if (filters.surveyId !== undefined) {
    conditions.push(Prisma.sql`sv.survey_config_id = ${filters.surveyId}::uuid`);
  }
  if (filters.origin !== undefined) {
    conditions.push(Prisma.sql`r.origin = ${filters.origin}::response_origin`);
  }
  if (cuts && filters.period !== undefined) {
    conditions.push(Prisma.sql`r.shift_period = ${filters.period}::shift_period`);
  }
  if (cuts && filters.teamIds !== undefined) {
    conditions.push(Prisma.sql`r.team_id = ANY(${[...filters.teamIds]}::uuid[])`);
  }
  return Prisma.join(conditions, ' AND ');
}

/** Respostas do hospital com setor e versão (para os filtros por pesquisa). */
export const RESPONSES_FROM = Prisma.sql`
  responses r
  JOIN sectors s ON s.id = r.sector_id
  JOIN survey_versions sv ON sv.id = r.survey_version_id`;

/**
 * Contagens e NPS do RN03 calculados no PostgreSQL (Seção 8): ROUND do PostgreSQL arredonda a
 * metade afastando-se de zero, como computeNps (RF51, T05). COUNT(r.id) permite LEFT JOIN.
 */
const NPS_COLUMNS = Prisma.sql`
  COUNT(r.id)::int AS total,
  COUNT(r.id) FILTER (WHERE r.nps_score >= 9)::int AS promoters,
  COUNT(r.id) FILTER (WHERE r.nps_score IN (7, 8))::int AS passives,
  COUNT(r.id) FILTER (WHERE r.nps_score <= 6)::int AS detractors,
  ROUND(100.0 * (COUNT(r.id) FILTER (WHERE r.nps_score >= 9)
                 - COUNT(r.id) FILTER (WHERE r.nps_score <= 6))
        / NULLIF(COUNT(r.id), 0), 1)::float8 AS nps,
  ROUND(100.0 * COUNT(r.id) FILTER (WHERE r.nps_score >= 9) / NULLIF(COUNT(r.id), 0), 1)::float8
    AS promoters_percent,
  ROUND(100.0 * COUNT(r.id) FILTER (WHERE r.nps_score IN (7, 8)) / NULLIF(COUNT(r.id), 0), 1)::float8
    AS passives_percent,
  ROUND(100.0 * COUNT(r.id) FILTER (WHERE r.nps_score <= 6) / NULLIF(COUNT(r.id), 0), 1)::float8
    AS detractors_percent`;

interface NpsRow {
  total: number;
  promoters: number;
  passives: number;
  detractors: number;
  nps: number | null;
  promoters_percent: number | null;
  passives_percent: number | null;
  detractors_percent: number | null;
}

/** Indicadores de NPS sempre com o n considerado (RF53); `suppressed` conforme RN21. */
export interface NpsIndicator {
  n: number | null;
  nps: number | null;
  promoters: number | null;
  passives: number | null;
  detractors: number | null;
  promotersPercent: number | null;
  passivesPercent: number | null;
  detractorsPercent: number | null;
  suppressed: boolean;
}

/** RN21: grupo com 1 a 4 respostas é ocultado para o Visualizador (0 respostas não esconde nada). */
export function isSuppressed(filters: Pick<ResolvedFilters, 'suppress'>, n: number): boolean {
  return filters.suppress && n > 0 && n < SUPPRESSION_THRESHOLD;
}

const SUPPRESSED_NPS: NpsIndicator = {
  n: null,
  nps: null,
  promoters: null,
  passives: null,
  detractors: null,
  promotersPercent: null,
  passivesPercent: null,
  detractorsPercent: null,
  suppressed: true,
};

function npsIndicator(row: NpsRow | undefined, filters: ResolvedFilters): NpsIndicator {
  const total = row?.total ?? 0;
  if (isSuppressed(filters, total)) return SUPPRESSED_NPS;
  return {
    n: total,
    nps: row?.nps ?? null,
    promoters: row?.promoters ?? 0,
    passives: row?.passives ?? 0,
    detractors: row?.detractors ?? 0,
    promotersPercent: row?.promoters_percent ?? null,
    passivesPercent: row?.passives_percent ?? null,
    detractorsPercent: row?.detractors_percent ?? null,
    suppressed: false,
  };
}

async function npsOf(db: Db, filters: ResolvedFilters): Promise<NpsRow | undefined> {
  const rows = await db.$queryRaw<NpsRow[]>`
    SELECT ${NPS_COLUMNS}
    FROM ${RESPONSES_FROM}
    WHERE s.hospital_id = ${filters.hospitalId}::uuid AND ${responseConditions(filters)}`;
  return rows[0];
}

/** Cobertura de atribuição do recorte sem os filtros de turno e equipe (RF50, RF57). */
export interface Coverage {
  total: number | null;
  attributed: number | null;
  percent: number | null;
  suppressed: boolean;
}

async function coverageOf(db: Db, filters: ResolvedFilters): Promise<Coverage> {
  const rows = await db.$queryRaw<{ total: number; attributed: number; percent: number | null }[]>`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE r.attribution_status = 'attributed')::int AS attributed,
           ROUND(100.0 * COUNT(*) FILTER (WHERE r.attribution_status = 'attributed')
                 / NULLIF(COUNT(*), 0), 1)::float8 AS percent
    FROM ${RESPONSES_FROM}
    WHERE s.hospital_id = ${filters.hospitalId}::uuid AND ${responseConditions(filters, false)}`;
  const row = rows[0] ?? { total: 0, attributed: 0, percent: null };
  if (isSuppressed(filters, row.total)) {
    return { total: null, attributed: null, percent: null, suppressed: true };
  }
  return { ...row, suppressed: false };
}

export interface DistributionItem {
  score: number;
  count: number;
  percent: number | null;
}

export interface SummaryDto {
  period: LocalPeriod;
  indicators: NpsIndicator;
  /** RF52: quantidade e percentual de cada nota de 0 a 10; nulo quando suprimido. */
  distribution: DistributionItem[] | null;
  manifestations: {
    total: number | null;
    compliment: number | null;
    complaint: number | null;
    suggestion: number | null;
    suppressed: boolean;
  };
  coverage: Coverage;
  comparison: {
    period: LocalPeriod;
    indicators: NpsIndicator;
    /** RF58: variação em pontos; nula sem respostas no período anterior ou com supressão. */
    delta: number | null;
    noPreviousData: boolean;
  } | null;
}

/** Período anterior de mesma duração, imediatamente antes de `from` (RF58). */
export function previousPeriod({ from, to }: LocalPeriod): LocalPeriod {
  const days = daysInclusive(from, to);
  return { from: addDays(from, -days), to: addDays(from, -1) };
}

/** Diferença em pontos com uma casa decimal (os dois NPS já têm uma casa). */
export function npsDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return Math.round((current - previous) * 10) / 10;
}

/**
 * E28 — indicadores gerais (RF50–RF53, RF58, RF60): NPS, contagens e percentuais, distribuição
 * 0–10, manifestações por tipo, cobertura e comparação opcional. Sem dados: total 0 e nulos.
 */
export async function getSummary(
  db: Db,
  filters: ResolvedFilters,
  compare: boolean,
): Promise<SummaryDto> {
  const where = Prisma.sql`s.hospital_id = ${filters.hospitalId}::uuid AND ${responseConditions(filters)}`;
  const [npsRow, distributionRows, manifestationRows, coverage] = await Promise.all([
    npsOf(db, filters),
    db.$queryRaw<{ score: number; count: number; percent: number }[]>`
      SELECT r.nps_score::int AS score, COUNT(*)::int AS count,
             ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1)::float8 AS percent
      FROM ${RESPONSES_FROM} WHERE ${where}
      GROUP BY r.nps_score`,
    db.$queryRaw<{ type: 'compliment' | 'complaint' | 'suggestion'; count: number }[]>`
      SELECT m.type::text AS type, COUNT(*)::int AS count
      FROM manifestations m JOIN ${RESPONSES_FROM} ON r.id = m.response_id
      WHERE ${where}
      GROUP BY m.type`,
    coverageOf(db, filters),
  ]);
  const indicators = npsIndicator(npsRow, filters);
  const distribution = indicators.suppressed
    ? null
    : Array.from({ length: 11 }, (_, score) => {
        const row = distributionRows.find((item) => item.score === score);
        return {
          score,
          count: row?.count ?? 0,
          percent: row === undefined ? (indicators.n === 0 ? null : 0) : row.percent,
        };
      });
  const byType = (type: 'compliment' | 'complaint' | 'suggestion') =>
    manifestationRows.find((row) => row.type === type)?.count ?? 0;
  const manifestationTotal = manifestationRows.reduce((sum, row) => sum + row.count, 0);
  const manifestations = isSuppressed(filters, manifestationTotal)
    ? { total: null, compliment: null, complaint: null, suggestion: null, suppressed: true }
    : {
        total: manifestationTotal,
        compliment: byType('compliment'),
        complaint: byType('complaint'),
        suggestion: byType('suggestion'),
        suppressed: false,
      };

  let comparison: SummaryDto['comparison'] = null;
  if (compare) {
    const period = previousPeriod(filters);
    const previous = npsIndicator(await npsOf(db, { ...filters, ...period }), filters);
    comparison = {
      period,
      indicators: previous,
      delta:
        indicators.suppressed || previous.suppressed
          ? null
          : npsDelta(indicators.nps, previous.nps),
      noPreviousData: previous.n === 0,
    };
  }
  return {
    period: { from: filters.from, to: filters.to },
    indicators,
    distribution,
    manifestations,
    coverage,
    comparison,
  };
}

/** Ordem do RF55: maior NPS primeiro; sem respostas (ou suprimidos) ao final; depois pelo nome. */
function byNps<T extends { indicators: NpsIndicator; name: string }>(a: T, b: T): number {
  const left = a.indicators.nps;
  const right = b.indicators.nps;
  if (left === null && right !== null) return 1;
  if (left !== null && right === null) return -1;
  if (left !== null && right !== null && left !== right) return right - left;
  return a.name.localeCompare(b.name, 'pt-BR');
}

export interface SectorResultDto {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  indicators: NpsIndicator;
}

/**
 * E29 — NPS e n por setor do escopo (RF55), ordenados por NPS; setores sem respostas ao final;
 * setores fora do escopo nunca aparecem. Setor inativo aparece somente se tiver respostas.
 */
export async function getSectors(db: Db, filters: ResolvedFilters): Promise<SectorResultDto[]> {
  const sectorFilter =
    filters.sectorIds === undefined
      ? Prisma.empty
      : Prisma.sql`AND s.id = ANY(${[...filters.sectorIds]}::uuid[])`;
  const rows = await db.$queryRaw<
    (NpsRow & { id: string; code: string; name: string; is_active: boolean })[]
  >`
    SELECT s.id::text AS id, s.code, s.name, s.is_active, ${NPS_COLUMNS}
    FROM sectors s
    LEFT JOIN (responses r JOIN survey_versions sv ON sv.id = r.survey_version_id)
      ON r.sector_id = s.id AND ${responseConditions(filters)}
    WHERE s.hospital_id = ${filters.hospitalId}::uuid ${sectorFilter}
    GROUP BY s.id
    HAVING s.is_active OR COUNT(r.id) > 0`;
  return rows
    .map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      isActive: row.is_active,
      indicators: npsIndicator(row, filters),
    }))
    .sort(byNps);
}

export interface ShiftResultDto {
  period: (typeof SHIFT_PERIODS)[number];
  indicators: NpsIndicator;
}

/** E30 — por período de turno, somente respostas atribuídas (RN14), com cobertura (RF57). */
export async function getShifts(
  db: Db,
  filters: ResolvedFilters,
): Promise<{ items: ShiftResultDto[]; coverage: Coverage }> {
  const [rows, coverage] = await Promise.all([
    db.$queryRaw<(NpsRow & { period: string })[]>`
      SELECT r.shift_period::text AS period, ${NPS_COLUMNS}
      FROM ${RESPONSES_FROM}
      WHERE s.hospital_id = ${filters.hospitalId}::uuid AND ${responseConditions(filters)}
        AND r.attribution_status = 'attributed'
      GROUP BY r.shift_period`,
    coverageOf(db, filters),
  ]);
  const periods = filters.period === undefined ? SHIFT_PERIODS : [filters.period];
  return {
    items: periods.map((period) => ({
      period,
      indicators: npsIndicator(
        rows.find((row) => row.period === period),
        filters,
      ),
    })),
    coverage,
  };
}

export interface TeamResultDto {
  id: string;
  code: string;
  name: string;
  sector: { id: string; name: string };
  indicators: NpsIndicator;
}

/** E31 — por equipe, somente respostas atribuídas (RN07, RN14), com cobertura (RF57). */
export async function getTeams(
  db: Db,
  filters: ResolvedFilters,
): Promise<{ items: TeamResultDto[]; coverage: Coverage }> {
  const [rows, coverage] = await Promise.all([
    db.$queryRaw<
      (NpsRow & {
        id: string;
        code: string;
        name: string;
        sector_id: string;
        sector_name: string;
      })[]
    >`
      SELECT t.id::text AS id, t.code, t.name, s.id::text AS sector_id, s.name AS sector_name,
             ${NPS_COLUMNS}
      FROM ${RESPONSES_FROM} JOIN teams t ON t.id = r.team_id
      WHERE s.hospital_id = ${filters.hospitalId}::uuid AND ${responseConditions(filters)}
        AND r.attribution_status = 'attributed'
      GROUP BY t.id, s.id`,
    coverageOf(db, filters),
  ]);
  return {
    items: rows
      .map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        sector: { id: row.sector_id, name: row.sector_name },
        indicators: npsIndicator(row, filters),
      }))
      .sort(byNps),
    coverage,
  };
}

export interface TrendPointDto {
  /** Primeiro e último dia (inclusivos) do intervalo. */
  start: string;
  end: string;
  n: number | null;
  nps: number | null;
  suppressed: boolean;
}

/** Granularidade efetiva: a informada ou a mais fina permitida pela duração (RF59). */
export function granularityFor(period: LocalPeriod, requested?: Granularity): Granularity {
  if (requested !== undefined) return requested;
  const days = daysInclusive(period.from, period.to);
  if (days <= GRANULARITY_MAX_DAYS.day) return 'day';
  if (days <= GRANULARITY_MAX_DAYS.week) return 'week';
  return 'month';
}

/**
 * Intervalos contíguos que cobrem [from, to] sem lacunas: dias; semanas de 7 dias a partir de
 * `from` (a última pode ser menor); meses do calendário recortados pelo período.
 */
export function trendBuckets(period: LocalPeriod, granularity: Granularity): LocalPeriod[] {
  const buckets: LocalPeriod[] = [];
  let start = period.from;
  while (start <= period.to) {
    let end: string;
    if (granularity === 'day') end = start;
    else if (granularity === 'week') end = addDays(start, 6);
    else {
      const [year, month] = start.split('-').map(Number) as [number, number];
      end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    }
    if (end > period.to) end = period.to;
    buckets.push({ from: start, to: end });
    start = addDays(end, 1);
  }
  return buckets;
}

/**
 * E32 — série de NPS e n (RF59), um ponto por intervalo e sem lacunas. As contagens vêm do banco
 * por dia local; o NPS de cada intervalo usa computeNps, idêntico ao ROUND do SQL (RF51).
 */
export async function getTrends(
  db: Db,
  filters: ResolvedFilters,
  requested?: Granularity,
): Promise<{ granularity: Granularity; points: TrendPointDto[] }> {
  const granularity = granularityFor(filters, requested);
  const rows = await db.$queryRaw<
    { day: string; promoters: number; passives: number; detractors: number }[]
  >`
    SELECT to_char(r.submitted_at AT TIME ZONE ${HOSPITAL_TIME_ZONE}, 'YYYY-MM-DD') AS day,
           COUNT(*) FILTER (WHERE r.nps_score >= 9)::int AS promoters,
           COUNT(*) FILTER (WHERE r.nps_score IN (7, 8))::int AS passives,
           COUNT(*) FILTER (WHERE r.nps_score <= 6)::int AS detractors
    FROM ${RESPONSES_FROM}
    WHERE s.hospital_id = ${filters.hospitalId}::uuid AND ${responseConditions(filters)}
    GROUP BY 1`;
  const points = trendBuckets(filters, granularity).map((bucket) => {
    const counts = { promoters: 0, passives: 0, detractors: 0 };
    for (const row of rows) {
      if (row.day < bucket.from || row.day > bucket.to) continue;
      counts.promoters += row.promoters;
      counts.passives += row.passives;
      counts.detractors += row.detractors;
    }
    const n = counts.promoters + counts.passives + counts.detractors;
    if (isSuppressed(filters, n)) {
      return { start: bucket.from, end: bucket.to, n: null, nps: null, suppressed: true };
    }
    return { start: bucket.from, end: bucket.to, n, nps: computeNps(counts), suppressed: false };
  });
  return { granularity, points };
}

export interface QuestionResultDto {
  questionId: string;
  text: string;
  journeyStage: { id: string | null; name: string | null; position: number | null };
  survey: { id: string; title: string };
  /** Respostas consideradas (em branco não entram, RF54). */
  n: number | null;
  average: number | null;
  /** Quantidade de cada nota de 1 a 5. */
  distribution: { score: number; count: number }[] | null;
  /** Percentual de notas 4 e 5. */
  topTwoPercent: number | null;
  suppressed: boolean;
}

/**
 * E33 — resultados por pergunta específica (RF54): respostas, média com duas casas, distribuição
 * 1–5 e percentual de notas 4 e 5. Agrupa por pergunta (o texto publicado é imutável, RN17) e usa
 * os instantâneos das versões (RN15); o título é o da versão mais recente do recorte.
 */
export async function getQuestions(
  db: Db,
  filters: ResolvedFilters,
  journeyStageId?: string,
): Promise<{ total: number | null; items: QuestionResultDto[] }> {
  const stageFilter =
    journeyStageId === undefined
      ? Prisma.empty
      : Prisma.sql`AND svq.journey_stage_id = ${journeyStageId}::uuid`;
  const [rows, npsRow] = await Promise.all([
    db.$queryRaw<
      {
        question_id: string;
        text: string;
        stage_id: string | null;
        stage_name: string | null;
        stage_position: number | null;
        position: number;
        survey_id: string;
        survey_title: string;
        n: number;
        average: number;
        s1: number;
        s2: number;
        s3: number;
        s4: number;
        s5: number;
        top_two: number;
      }[]
    >`
      SELECT svq.question_id::text AS question_id,
             MIN(svq.text) AS text,
             svq.journey_stage_id::text AS stage_id,
             MIN(svq.journey_stage_name) AS stage_name,
             MIN(svq.journey_stage_position)::int AS stage_position,
             MIN(svq.position)::int AS position,
             sv.survey_config_id::text AS survey_id,
             (array_agg(sv.title ORDER BY sv.version_number DESC))[1] AS survey_title,
             COUNT(*)::int AS n,
             ROUND(AVG(a.score)::numeric, 2)::float8 AS average,
             COUNT(*) FILTER (WHERE a.score = 1)::int AS s1,
             COUNT(*) FILTER (WHERE a.score = 2)::int AS s2,
             COUNT(*) FILTER (WHERE a.score = 3)::int AS s3,
             COUNT(*) FILTER (WHERE a.score = 4)::int AS s4,
             COUNT(*) FILTER (WHERE a.score = 5)::int AS s5,
             ROUND(100.0 * COUNT(*) FILTER (WHERE a.score >= 4) / COUNT(*), 1)::float8 AS top_two
      FROM response_answers a
      JOIN ${RESPONSES_FROM} ON r.id = a.response_id
      JOIN survey_version_questions svq ON svq.id = a.survey_version_question_id
      WHERE s.hospital_id = ${filters.hospitalId}::uuid AND ${responseConditions(filters)} ${stageFilter}
      GROUP BY svq.question_id, svq.journey_stage_id, sv.survey_config_id
      ORDER BY stage_position NULLS LAST, survey_title, position`,
    npsOf(db, filters),
  ]);
  const total = npsRow?.total ?? 0;
  return {
    total: isSuppressed(filters, total) ? null : total,
    items: rows.map((row) => {
      const base = {
        questionId: row.question_id,
        text: row.text,
        journeyStage: { id: row.stage_id, name: row.stage_name, position: row.stage_position },
        survey: { id: row.survey_id, title: row.survey_title },
      };
      if (isSuppressed(filters, row.n)) {
        return {
          ...base,
          n: null,
          average: null,
          distribution: null,
          topTwoPercent: null,
          suppressed: true,
        };
      }
      return {
        ...base,
        n: row.n,
        average: row.average,
        distribution: [row.s1, row.s2, row.s3, row.s4, row.s5].map((count, index) => ({
          score: index + 1,
          count,
        })),
        topTwoPercent: row.top_two,
        suppressed: false,
      };
    }),
  };
}
