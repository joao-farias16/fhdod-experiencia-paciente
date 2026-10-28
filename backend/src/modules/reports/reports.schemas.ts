import { z } from 'zod';

import { csvList, refinePeriod } from '../../utils/period.js';
import { queryBoolean } from '../../utils/validation.js';
import { commonFilterShape } from '../dashboard/dashboard.schemas.js';
import {
  MANIFESTATION_STATUSES,
  MANIFESTATION_TYPES,
} from '../manifestations/manifestations.schemas.js';

export const REPORT_TYPES = ['responses', 'indicators', 'manifestations'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

/** Linha do catálogo de permissões por tipo de relatório (Tabela 13). */
export const REPORT_ENDPOINTS = {
  responses: 'E34-respostas',
  indicators: 'E34-indicadores',
  manifestations: 'E34-manifestacoes',
} as const satisfies Record<ReportType, string>;

/** RN29: até 50.000 linhas por aba. */
export const MAX_ROWS_PER_SHEET = 50_000;

/**
 * E34 — GET /reports/export (RF62–RF67): tipo, filtros comuns e, para manifestações, status,
 * manifestationType e includeText. Parâmetros de manifestação em outro tipo → 400.
 */
export const exportQuerySchema = z
  .strictObject({
    type: z.enum(REPORT_TYPES, { error: 'Use responses, indicators ou manifestations.' }),
    ...commonFilterShape,
    status: csvList(z.enum(MANIFESTATION_STATUSES, { error: 'Status inválido.' })).optional(),
    manifestationType: csvList(z.enum(MANIFESTATION_TYPES, { error: 'Tipo inválido.' })).optional(),
    includeText: queryBoolean.optional(),
  })
  .superRefine((query, ctx) => {
    refinePeriod(query, ctx);
    if (query.type === 'manifestations') return;
    for (const field of ['status', 'manifestationType', 'includeText'] as const) {
      if (query[field] !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: 'Filtro disponível somente no relatório de manifestações.',
        });
      }
    }
  });

export type ExportQuery = z.output<typeof exportQuerySchema>;
