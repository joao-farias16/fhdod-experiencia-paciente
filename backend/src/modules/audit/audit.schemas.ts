import { z } from 'zod';

import {
  localDateSchema,
  paginationSchema,
  refinePeriod,
  uuidSchema,
} from '../../utils/validation.js';

/** RF11: até 100 por página. Período (RN25): regras comuns de `utils/period.ts`. */
export const AUDIT_MAX_PAGE_SIZE = 100;

const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();

export const listAuditLogsQuerySchema = z
  .strictObject({
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
    actorProfileId: uuidSchema.optional(),
    action: optionalText(60),
    entityType: optionalText(40),
    entityId: optionalText(64),
    ...paginationSchema(AUDIT_MAX_PAGE_SIZE, 50),
  })
  .superRefine(refinePeriod);

export type ListAuditLogsQuery = z.output<typeof listAuditLogsQuerySchema>;
