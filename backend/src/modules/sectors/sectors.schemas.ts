import { z } from 'zod';

import { queryBoolean, uuidSchema } from '../../utils/validation.js';

/** Código de setor e de equipe: A–Z, 0–9, _ e -, com 2 a 20 caracteres (RF12, RF16). */
export const STRUCTURE_CODE_PATTERN = /^[A-Z0-9_-]{2,20}$/;

export const structureCodeSchema = z
  .string({ error: 'Informe o código.' })
  .trim()
  .regex(STRUCTURE_CODE_PATTERN, 'Use de 2 a 20 caracteres: letras maiúsculas, números, _ ou -.');

export const structureNameSchema = z
  .string({ error: 'Informe o nome.' })
  .trim()
  .min(2, 'O nome deve ter ao menos 2 caracteres.')
  .max(120, 'O nome deve ter no máximo 120 caracteres.');

const descriptionSchema = z
  .string({ error: 'Informe um texto.' })
  .trim()
  .max(500, 'A descrição deve ter no máximo 500 caracteres.')
  .transform((value) => (value === '' ? null : value))
  .nullable();

/** E10 — GET /admin/sectors. */
export const listSectorsQuerySchema = z.strictObject({
  isActive: queryBoolean.optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

/** E11 — POST /admin/sectors (RF12). */
export const createSectorSchema = z.strictObject({
  code: structureCodeSchema,
  name: structureNameSchema,
  description: descriptionSchema.optional(),
});

export type CreateSectorInput = z.output<typeof createSectorSchema>;

/** E12 — PATCH /admin/sectors/:id. O código é imutável: enviar `code` → 400 (RF14). */
export const updateSectorSchema = z
  .strictObject({
    name: structureNameSchema.optional(),
    description: descriptionSchema.optional(),
    isActive: z.boolean({ error: 'Informe verdadeiro ou falso.' }).optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Informe ao menos um campo para alterar.',
  });

export type UpdateSectorInput = z.output<typeof updateSectorSchema>;

export const idParamsSchema = z.strictObject({ id: uuidSchema });
