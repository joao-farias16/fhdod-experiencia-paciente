import { z } from 'zod';

/**
 * E42 — GET /tv-wall/summary (Tabela 19): entrada `period` (7d, 30d ou 90d) e a lista EXPLÍCITA
 * de campos da resposta (RF72, Seção 10: "campos por lista explícita"). A resposta é validada com
 * esquemas estritos antes de ser enviada: qualquer campo fora desta lista gera erro interno (500)
 * em vez de chegar à tela pública.
 */

/** Períodos aceitos e a quantidade de dias locais de cada um (o último dia é hoje). */
export const TV_WALL_PERIOD_DAYS = { '7d': 7, '30d': 30, '90d': 90 } as const;
export type TvWallPeriodKey = keyof typeof TV_WALL_PERIOD_DAYS;
export const TV_WALL_PERIODS = Object.keys(TV_WALL_PERIOD_DAYS) as [
  TvWallPeriodKey,
  ...TvWallPeriodKey[],
];

/** Padrão: últimos 30 dias, como os demais indicadores (RN25). */
export const DEFAULT_TV_WALL_PERIOD: TvWallPeriodKey = '30d';

/** RF68: até 8 setores na TV Wall. */
export const TV_WALL_MAX_SECTORS = 8;

/** Query string de E42: somente `period`; campos desconhecidos → 400 VALIDATION_ERROR (RNF11). */
export const tvWallQuerySchema = z.strictObject({
  period: z
    .enum(TV_WALL_PERIODS, { error: 'Use period=7d, 30d ou 90d.' })
    .default(DEFAULT_TV_WALL_PERIOD),
});

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const nullableNumber = z.number().nullable();

/** Indicador geral do hospital (RF68): NPS, n e percentuais de promotores e detratores. */
const overallSchema = z.strictObject({
  n: z.number().int().nonnegative().nullable(),
  nps: nullableNumber,
  promotersPercent: nullableNumber,
  detractorsPercent: nullableNumber,
  /** RF71: true quando o total tem de 1 a 4 respostas — todos os valores acima ficam nulos. */
  suppressed: z.boolean(),
});

/** Ponto da tendência (RF59/RF68): um por intervalo, sem lacunas; 1 a 4 respostas → nulos. */
const trendPointSchema = z.strictObject({
  start: localDate,
  end: localDate,
  n: z.number().int().nonnegative().nullable(),
  nps: nullableNumber,
  suppressed: z.boolean(),
});

/** Setor exibido (RF68, RF71): somente setores com 5 respostas ou mais; nunca códigos ou ids. */
const sectorSchema = z.strictObject({
  name: z.string(),
  n: z.number().int().min(5),
  nps: z.number(),
  promotersPercent: z.number(),
  detractorsPercent: z.number(),
});

export const tvWallSummarySchema = z.strictObject({
  period: z.strictObject({ key: z.enum(TV_WALL_PERIODS), from: localDate, to: localDate }),
  /** Instante (ISO 8601 UTC) em que os dados foram calculados. */
  generatedAt: z.iso.datetime(),
  /** Mínimo de respostas para um valor ser exibido (RN21). */
  suppressionThreshold: z.literal(5),
  overall: overallSchema,
  trend: z.strictObject({
    granularity: z.enum(['day', 'week']),
    points: z.array(trendPointSchema),
  }),
  sectors: z.array(sectorSchema).max(TV_WALL_MAX_SECTORS),
});

export type TvWallSummary = z.output<typeof tvWallSummarySchema>;
