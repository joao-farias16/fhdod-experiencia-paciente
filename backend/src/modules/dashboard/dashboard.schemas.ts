import { z } from 'zod';

import { daysInclusive } from '../../utils/dates.js';
import { csvList, localDateSchema, refinePeriod } from '../../utils/period.js';
import { uuidSchema } from '../../utils/validation.js';

export const SHIFT_PERIODS = ['morning', 'afternoon', 'night'] as const;
export const RESPONSE_ORIGINS = ['qr_code', 'link'] as const;
export const GRANULARITIES = ['day', 'week', 'month'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

/** RF59: um ponto por dia até 31 dias e por semana até 180 dias; por mês em qualquer período. */
export const GRANULARITY_MAX_DAYS: Readonly<Record<Granularity, number>> = {
  day: 31,
  week: 180,
  month: 366,
};

/**
 * Filtros comuns do dashboard e dos relatórios (Seção 4.3): from e to (AAAA-MM-DD, padrão últimos
 * 30 dias), sectorIds, surveyId, period, teamIds e origin. Campos desconhecidos → 400.
 */
export const commonFilterShape = {
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
  sectorIds: csvList(uuidSchema).optional(),
  surveyId: uuidSchema.optional(),
  period: z.enum(SHIFT_PERIODS, { error: 'Turno inválido.' }).optional(),
  teamIds: csvList(uuidSchema).optional(),
  origin: z.enum(RESPONSE_ORIGINS, { error: 'Origem inválida.' }).optional(),
};

export const filtersQuerySchema = z.strictObject(commonFilterShape).superRefine(refinePeriod);

export type DashboardFilters = z.output<typeof filtersQuerySchema>;

/** E28 — filtros comuns e compare=previous_period (RF58). */
export const summaryQuerySchema = z
  .strictObject({
    ...commonFilterShape,
    compare: z.literal('previous_period', { error: 'Use compare=previous_period.' }).optional(),
  })
  .superRefine(refinePeriod);

/** E32 — filtros comuns e granularity (RF59), validada contra a duração do período. */
export const trendsQuerySchema = z
  .strictObject({
    ...commonFilterShape,
    granularity: z.enum(GRANULARITIES, { error: 'Use day, week ou month.' }).optional(),
  })
  .superRefine((query, ctx) => {
    refinePeriod(query, ctx);
    if (query.granularity === undefined || query.from === undefined || query.to === undefined) {
      return;
    }
    const max = GRANULARITY_MAX_DAYS[query.granularity];
    if (query.from <= query.to && daysInclusive(query.from, query.to) > max) {
      ctx.addIssue({
        code: 'custom',
        path: ['granularity'],
        message: `Esta granularidade aceita períodos de até ${max} dias.`,
      });
    }
  });

/** E33 — filtros comuns e journeyStageId. */
export const questionsQuerySchema = z
  .strictObject({ ...commonFilterShape, journeyStageId: uuidSchema.optional() })
  .superRefine(refinePeriod);
