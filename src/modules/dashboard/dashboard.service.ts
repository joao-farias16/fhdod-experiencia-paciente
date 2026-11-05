import { type Queryable, toNumber } from '../../lib/database.js';
import { sql, type SqlStatement } from '../../lib/sql.js';
import { addDays, daysInclusive, localDateOf } from '../../utils/dates.js';
import type { LocalPeriod } from '../../utils/validation.js';
import { SHIFT_PERIODS } from '../shifts/shift-rules.js';
import {
  isSuppressed,
  type ResolvedFilters,
  responseConditions,
  RESPONSES_FROM,
} from './dashboard.filters.js';
import { type Granularity, GRANULARITY_MAX_DAYS } from './dashboard.schemas.js';
import { computeNps, percentOf, roundedRatio } from './nps.js';

type Db = Queryable;

/**
 * Contagens do RN03 calculadas no MySQL (Seção 8); NPS e percentuais calculados a partir delas
 * com aritmética inteira (computeNps e percentOf), que reproduzem exatamente o ROUND do SQL
 * (metade afastando-se de zero, RF51, T05). COUNT(r.id) permite LEFT JOIN.
 */
const NPS_COLUMNS = sql`
  COUNT(r.id) AS total,
  COUNT(CASE WHEN r.nps_score >= 9 THEN 1 END) AS promoters,
  COUNT(CASE WHEN r.nps_score IN (7, 8) THEN 1 END) AS passives,
  COUNT(CASE WHEN r.nps_score <= 6 THEN 1 END) AS detractors`;

interface NpsCountsRow {
  total: number;
  promoters: number;
  passives: number;
  detractors: number;
}

interface NpsRow extends NpsCountsRow {
  nps: number | null;
  promoters_percent: number | null;
  passives_percent: number | null;
  detractors_percent: number | null;
}

/** Converte as contagens do banco (BIGINT) e calcula NPS e percentuais. */
function withNps<T extends NpsCountsRow>(row: T): T & NpsRow {
  const total = toNumber(row.total);
  const promoters = toNumber(row.promoters);
  const passives = toNumber(row.passives);
  const detractors = toNumber(row.detractors);
  return {
    ...row,
    total,
    promoters,
    passives,
    detractors,
    nps: computeNps({ promoters, passives, detractors }),
    promoters_percent: percentOf(promoters, total),
    passives_percent: percentOf(passives, total),
    detractors_percent: percentOf(detractors, total),
  };
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
  const rows = await db.query<NpsCountsRow>(sql`
    SELECT ${NPS_COLUMNS}
    FROM ${RESPONSES_FROM}
    WHERE s.hospital_id = ${filters.hospitalId} AND ${responseConditions(filters)}`);
  return rows[0] === undefined ? undefined : withNps(rows[0]);
}

/** Cobertura de atribuição do recorte sem os filtros de turno e equipe (RF50, RF57). */
export interface Coverage {
  total: number | null;
  attributed: number | null;
  percent: number | null;
  suppressed: boolean;
}

async function coverageOf(db: Db, filters: ResolvedFilters): Promise<Coverage> {
  const rows = await db.query<{ total: number; attributed: number }>(sql`
    SELECT COUNT(*) AS total,
           COUNT(CASE WHEN r.attribution_status = 'attributed' THEN 1 END) AS attributed
    FROM ${RESPONSES_FROM}
    WHERE s.hospital_id = ${filters.hospitalId} AND ${responseConditions(filters, false)}`);
  const total = toNumber(rows[0]?.total ?? 0);
  const attributed = toNumber(rows[0]?.attributed ?? 0);
  if (isSuppressed(filters, total)) {
    return { total: null, attributed: null, percent: null, suppressed: true };
  }
  return { total, attributed, percent: percentOf(attributed, total), suppressed: false };
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
  const where = sql`s.hospital_id = ${filters.hospitalId} AND ${responseConditions(filters)}`;
  const [npsRow, scoreRows, typeRows, coverage] = await Promise.all([
    npsOf(db, filters),
    db.query<{ score: number; count: number }>(sql`
      SELECT r.nps_score AS score, COUNT(*) AS count
      FROM ${RESPONSES_FROM} WHERE ${where}
      GROUP BY r.nps_score`),
    db.query<{ type: 'compliment' | 'complaint' | 'suggestion'; count: number }>(sql`
      SELECT m.type, COUNT(*) AS count
      FROM manifestations m JOIN ${RESPONSES_FROM} ON r.id = m.response_id
      WHERE ${where}
      GROUP BY m.type`),
    coverageOf(db, filters),
  ]);
  const scoreTotal = scoreRows.reduce((sum, row) => sum + toNumber(row.count), 0);
  const distributionRows = scoreRows.map((row) => ({
    score: toNumber(row.score),
    count: toNumber(row.count),
    percent: percentOf(toNumber(row.count), scoreTotal),
  }));
  const manifestationRows = typeRows.map((row) => ({ type: row.type, count: toNumber(row.count) }));
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
  if (filters.sectorIds?.length === 0) return [];
  const sectorFilter: SqlStatement =
    filters.sectorIds === undefined ? sql.empty : sql`AND s.id IN (${sql.list(filters.sectorIds)})`;
  const counts = await db.query<
    NpsCountsRow & { id: string; code: string; name: string; is_active: boolean }
  >(sql`
    SELECT s.id, s.code, s.name, s.is_active, ${NPS_COLUMNS}
    FROM sectors s
    LEFT JOIN (responses r JOIN survey_versions sv ON sv.id = r.survey_version_id)
      ON r.sector_id = s.id AND ${responseConditions(filters)}
    WHERE s.hospital_id = ${filters.hospitalId} ${sectorFilter}
    GROUP BY s.id
    HAVING s.is_active OR COUNT(r.id) > 0`);
  return counts
    .map(withNps)
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
  const [counts, coverage] = await Promise.all([
    db.query<NpsCountsRow & { period: string }>(sql`
      SELECT r.shift_period AS period, ${NPS_COLUMNS}
      FROM ${RESPONSES_FROM}
      WHERE s.hospital_id = ${filters.hospitalId} AND ${responseConditions(filters)}
        AND r.attribution_status = 'attributed'
      GROUP BY r.shift_period`),
    coverageOf(db, filters),
  ]);
  const rows = counts.map(withNps);
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
  const [counts, coverage] = await Promise.all([
    db.query<
      NpsCountsRow & {
        id: string;
        code: string;
        name: string;
        sector_id: string;
        sector_name: string;
      }
    >(sql`
      SELECT t.id, t.code, t.name, s.id AS sector_id, s.name AS sector_name, ${NPS_COLUMNS}
      FROM ${RESPONSES_FROM} JOIN teams t ON t.id = r.team_id
      WHERE s.hospital_id = ${filters.hospitalId} AND ${responseConditions(filters)}
        AND r.attribution_status = 'attributed'
      GROUP BY t.id, s.id`),
    coverageOf(db, filters),
  ]);
  return {
    items: counts
      .map(withNps)
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
 * por hora UTC e são somadas por dia local (America/Sao_Paulo) no TypeScript — sem depender das
 * tabelas de fuso horário do servidor MySQL; o NPS de cada intervalo usa computeNps (RF51).
 */
export async function getTrends(
  db: Db,
  filters: ResolvedFilters,
  requested?: Granularity,
): Promise<{ granularity: Granularity; points: TrendPointDto[] }> {
  const granularity = granularityFor(filters, requested);
  const hourly = await db.query<{
    hour: string;
    promoters: number;
    passives: number;
    detractors: number;
  }>(sql`
    SELECT DATE_FORMAT(r.submitted_at, '%Y-%m-%dT%H:00:00Z') AS hour,
           COUNT(CASE WHEN r.nps_score >= 9 THEN 1 END) AS promoters,
           COUNT(CASE WHEN r.nps_score IN (7, 8) THEN 1 END) AS passives,
           COUNT(CASE WHEN r.nps_score <= 6 THEN 1 END) AS detractors
    FROM ${RESPONSES_FROM}
    WHERE s.hospital_id = ${filters.hospitalId} AND ${responseConditions(filters)}
    GROUP BY hour`);
  // Os deslocamentos do fuso do hospital são em horas inteiras: cada hora UTC cai num único dia local.
  const rows = hourly.map((row) => ({
    day: localDateOf(new Date(row.hour)),
    promoters: toNumber(row.promoters),
    passives: toNumber(row.passives),
    detractors: toNumber(row.detractors),
  }));
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
  const stageFilter: SqlStatement =
    journeyStageId === undefined ? sql.empty : sql`AND svq.journey_stage_id = ${journeyStageId}`;
  const [grouped, npsRow] = await Promise.all([
    db.query<{
      question_id: string;
      text: string;
      stage_id: string | null;
      stage_name: string | null;
      stage_position: number | null;
      position: number;
      survey_id: string;
      latest_version: number;
      n: number;
      score_sum: number;
      s1: number;
      s2: number;
      s3: number;
      s4: number;
      s5: number;
    }>(sql`
      SELECT svq.question_id,
             MIN(svq.text) AS text,
             svq.journey_stage_id AS stage_id,
             MIN(svq.journey_stage_name) AS stage_name,
             MIN(svq.journey_stage_position) AS stage_position,
             MIN(svq.position) AS position,
             sv.survey_config_id AS survey_id,
             MAX(sv.version_number) AS latest_version,
             COUNT(*) AS n,
             SUM(a.score) AS score_sum,
             COUNT(CASE WHEN a.score = 1 THEN 1 END) AS s1,
             COUNT(CASE WHEN a.score = 2 THEN 1 END) AS s2,
             COUNT(CASE WHEN a.score = 3 THEN 1 END) AS s3,
             COUNT(CASE WHEN a.score = 4 THEN 1 END) AS s4,
             COUNT(CASE WHEN a.score = 5 THEN 1 END) AS s5
      FROM response_answers a
      JOIN ${RESPONSES_FROM} ON r.id = a.response_id
      JOIN survey_version_questions svq ON svq.id = a.survey_version_question_id
      WHERE s.hospital_id = ${filters.hospitalId} AND ${responseConditions(filters)} ${stageFilter}
      GROUP BY svq.question_id, svq.journey_stage_id, sv.survey_config_id`),
    npsOf(db, filters),
  ]);
  // Título da versão mais recente do recorte, por pesquisa.
  const titles = new Map<string, string>();
  if (grouped.length > 0) {
    const pairs = [
      ...new Map(
        grouped.map((row) => [`${row.survey_id}:${String(row.latest_version)}`, row]),
      ).values(),
    ].map((row) => sql`(${row.survey_id}, ${toNumber(row.latest_version)})`);
    const versions = await db.query<{
      survey_config_id: string;
      version_number: number;
      title: string;
    }>(
      sql`
        SELECT survey_config_id, version_number, title FROM survey_versions
        WHERE (survey_config_id, version_number) IN (${sql.join(pairs, ', ')})`,
    );
    for (const version of versions) {
      titles.set(`${version.survey_config_id}:${String(version.version_number)}`, version.title);
    }
  }
  const rows = grouped
    .map((row) => {
      const n = toNumber(row.n);
      const s4 = toNumber(row.s4);
      const s5 = toNumber(row.s5);
      return {
        ...row,
        stage_position: row.stage_position === null ? null : toNumber(row.stage_position),
        position: toNumber(row.position),
        survey_title: titles.get(`${row.survey_id}:${String(row.latest_version)}`) ?? '',
        n,
        average: roundedRatio(toNumber(row.score_sum), n, 1, 2) ?? 0,
        s1: toNumber(row.s1),
        s2: toNumber(row.s2),
        s3: toNumber(row.s3),
        s4,
        s5,
        top_two: percentOf(s4 + s5, n) ?? 0,
      };
    })
    // Ordem anterior: etapa (sem etapa por último), título da pesquisa e posição da pergunta.
    .sort(
      (a, b) =>
        (a.stage_position ?? Number.MAX_SAFE_INTEGER) -
          (b.stage_position ?? Number.MAX_SAFE_INTEGER) ||
        a.survey_title.localeCompare(b.survey_title, 'pt-BR') ||
        a.position - b.position,
    );
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
