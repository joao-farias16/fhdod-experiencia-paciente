import { z } from 'zod';

import { queryBoolean, uuidSchema } from '../../utils/validation.js';
import { structureCodeSchema, structureNameSchema } from '../sectors/sectors.schemas.js';

/** E13 — GET /admin/teams. */
export const listTeamsQuerySchema = z.strictObject({
  sectorId: uuidSchema.optional(),
  isActive: queryBoolean.optional(),
});

export type ListTeamsQuery = z.output<typeof listTeamsQuerySchema>;

/** E14 — POST /admin/teams (RF16): equipe sem integrantes, código único no setor. */
export const createTeamSchema = z.strictObject({
  sectorId: uuidSchema,
  code: structureCodeSchema,
  name: structureNameSchema,
});

export type CreateTeamInput = z.output<typeof createTeamSchema>;

/** E15 — PATCH /admin/teams/:id: nome e situação; código e setor imutáveis (RF17). */
export const updateTeamSchema = z
  .strictObject({
    name: structureNameSchema.optional(),
    isActive: z.boolean({ error: 'Informe verdadeiro ou falso.' }).optional(),
  })
  .refine((input) => input.name !== undefined || input.isActive !== undefined, {
    message: 'Informe ao menos um campo para alterar.',
  });

export type UpdateTeamInput = z.output<typeof updateTeamSchema>;
