import { z } from 'zod';

import { daysInclusive, isValidLocalDate, isValidLocalTime } from '../../utils/dates.js';
import { queryBoolean, uuidSchema } from '../../utils/validation.js';
import { SHIFT_PERIODS } from './shift-rules.js';

/** RF20: escala consultada em intervalos de até 62 dias. */
export const SHIFTS_MAX_RANGE_DAYS = 62;

const localDate = z.string().refine(isValidLocalDate, 'Use uma data válida no formato AAAA-MM-DD.');
const localTime = z
  .string({ error: 'Informe a hora.' })
  .refine(isValidLocalTime, 'Use uma hora válida no formato HH:MM.');

/** E17 — GET /admin/shifts. */
export const listShiftsQuerySchema = z
  .strictObject({
    sectorId: uuidSchema,
    from: localDate,
    to: localDate,
    teamId: uuidSchema.optional(),
    includeCancelled: queryBoolean.optional(),
  })
  .superRefine((query, ctx) => {
    if (query.from > query.to) {
      ctx.addIssue({
        code: 'custom',
        path: ['from'],
        message: 'A data inicial deve ser anterior ou igual à final.',
      });
    } else if (daysInclusive(query.from, query.to) > SHIFTS_MAX_RANGE_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: `O intervalo deve ter no máximo ${SHIFTS_MAX_RANGE_DAYS} dias.`,
      });
    }
  });

export type ListShiftsQuery = z.output<typeof listShiftsQuerySchema>;

/** E18 — POST /admin/shifts (RF19): data e horas locais do hospital. */
export const createShiftSchema = z.strictObject({
  teamId: uuidSchema,
  date: localDate,
  period: z.enum(SHIFT_PERIODS, { error: 'Escolha manhã, tarde ou noite.' }),
  startTime: localTime,
  endTime: localTime,
});

export type CreateShiftInput = z.output<typeof createShiftSchema>;

/** E19 — PATCH /admin/shifts/:id: cancelamento irreversível com motivo (RF21). */
export const cancelShiftSchema = z.strictObject({
  cancelled: z.literal(true, { error: 'Somente o cancelamento é permitido.' }),
  reason: z
    .string({ error: 'Informe o motivo do cancelamento.' })
    .trim()
    .min(5, 'O motivo deve ter ao menos 5 caracteres.')
    .max(300, 'O motivo deve ter no máximo 300 caracteres.'),
});

export type CancelShiftInput = z.output<typeof cancelShiftSchema>;
