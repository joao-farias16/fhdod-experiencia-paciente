import { z } from 'zod';

import { daysInclusive, isValidLocalDate } from '../../utils/dates.js';
import { paginationSchema, uuidSchema } from '../../utils/validation.js';

/** RN25: até 366 dias; padrão, últimos 30 dias (inclusive hoje). RF11: até 100 por página. */
export const AUDIT_MAX_RANGE_DAYS = 366;
export const AUDIT_DEFAULT_RANGE_DAYS = 30;
export const AUDIT_MAX_PAGE_SIZE = 100;

const localDate = z.string().refine(isValidLocalDate, 'Use uma data válida no formato AAAA-MM-DD.');

const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();

export const listAuditLogsQuerySchema = z
  .strictObject({
    from: localDate.optional(),
    to: localDate.optional(),
    actorProfileId: uuidSchema.optional(),
    action: optionalText(60),
    entityType: optionalText(40),
    entityId: optionalText(64),
    ...paginationSchema(AUDIT_MAX_PAGE_SIZE, 50),
  })
  .superRefine((query, ctx) => {
    if (query.from !== undefined && query.to !== undefined) {
      if (query.from > query.to) {
        ctx.addIssue({
          code: 'custom',
          path: ['from'],
          message: 'A data inicial deve ser anterior ou igual à final.',
        });
      } else if (daysInclusive(query.from, query.to) > AUDIT_MAX_RANGE_DAYS) {
        ctx.addIssue({
          code: 'custom',
          path: ['to'],
          message: `O período deve ter no máximo ${AUDIT_MAX_RANGE_DAYS} dias.`,
        });
      }
    }
  });

export type ListAuditLogsQuery = z.output<typeof listAuditLogsQuerySchema>;
