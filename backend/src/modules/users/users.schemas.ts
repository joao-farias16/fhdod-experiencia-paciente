import { z } from 'zod';

import type { UserRole } from '../../lib/prisma.js';
import type { ErrorDetail } from '../../utils/http-error.js';
import { paginationSchema, queryBoolean, uuidSchema } from '../../utils/validation.js';

export const USER_ROLES = [
  'superadmin',
  'sector_admin',
  'management',
  'ombudsman',
  'viewer',
] as const satisfies readonly UserRole[];

export const MAX_SECTORS_PER_USER = 50;

const roleSchema = z.enum(USER_ROLES, { error: 'Escolha um perfil válido.' });

const fullNameSchema = z
  .string({ error: 'Informe o nome completo.' })
  .trim()
  .min(3, 'O nome deve ter ao menos 3 caracteres.')
  .max(120, 'O nome deve ter no máximo 120 caracteres.');

const emailSchema = z
  .string({ error: 'Informe o e-mail.' })
  .trim()
  .toLowerCase()
  .max(254, 'O e-mail deve ter no máximo 254 caracteres.')
  .pipe(z.email({ error: 'Informe um e-mail válido.' }));

const sectorIdsSchema = z
  .array(uuidSchema, { error: 'Informe a lista de setores.' })
  .max(MAX_SECTORS_PER_USER, `Associe no máximo ${MAX_SECTORS_PER_USER} setores.`)
  .refine((ids) => new Set(ids).size === ids.length, 'Não repita setores.');

/**
 * RN18: SA tem escopo global; AS tem ao menos um setor e nunca escopo global; GE, OU e VI são
 * globais (all_sectors) ou têm ao menos um setor. Violação → 400 VALIDATION_ERROR (RF06).
 */
export function scopeViolations(
  role: UserRole,
  allSectors: boolean,
  sectorIds: readonly string[],
): ErrorDetail[] {
  if (role === 'superadmin') {
    if (!allSectors || sectorIds.length > 0) {
      return [{ field: 'allSectors', message: 'O superadministrador tem sempre escopo global.' }];
    }
    return [];
  }
  if (role === 'sector_admin') {
    if (allSectors) {
      return [
        { field: 'allSectors', message: 'O administrador de setor não pode ter escopo global.' },
      ];
    }
    if (sectorIds.length === 0) {
      return [
        { field: 'sectorIds', message: 'Associe ao menos um setor ao administrador de setor.' },
      ];
    }
    return [];
  }
  if (allSectors && sectorIds.length > 0) {
    return [{ field: 'sectorIds', message: 'Com escopo global, não informe setores.' }];
  }
  if (!allSectors && sectorIds.length === 0) {
    return [{ field: 'sectorIds', message: 'Escolha o escopo global ou ao menos um setor.' }];
  }
  return [];
}

/** E07 — POST /admin/users. Para o SA, `allSectors` é verdadeiro por padrão. */
export const createUserSchema = z
  .strictObject({
    fullName: fullNameSchema,
    email: emailSchema,
    role: roleSchema,
    allSectors: z.boolean({ error: 'Informe verdadeiro ou falso.' }).optional(),
    sectorIds: sectorIdsSchema.default([]),
  })
  .transform((input, ctx) => {
    const allSectors = input.allSectors ?? input.role === 'superadmin';
    for (const violation of scopeViolations(input.role, allSectors, input.sectorIds)) {
      ctx.addIssue({ code: 'custom', path: [violation.field], message: violation.message });
    }
    return { ...input, allSectors };
  });

export type CreateUserInput = z.output<typeof createUserSchema>;

/**
 * E08 — PATCH /admin/users/:id. O e-mail é imutável (campo desconhecido → 400). Para si mesmo, o
 * SA só pode alterar o nome (422 SELF_MODIFICATION_FORBIDDEN).
 */
export const updateUserSchema = z
  .strictObject({
    fullName: fullNameSchema.optional(),
    role: roleSchema.optional(),
    allSectors: z.boolean({ error: 'Informe verdadeiro ou falso.' }).optional(),
    sectorIds: sectorIdsSchema.optional(),
    isActive: z.boolean({ error: 'Informe verdadeiro ou falso.' }).optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Informe ao menos um campo para alterar.',
  });

export type UpdateUserInput = z.output<typeof updateUserSchema>;

/** E06 — GET /admin/users: filtros e paginação (máximo de 100 por página). */
export const listUsersQuerySchema = z.strictObject({
  role: roleSchema.optional(),
  isActive: queryBoolean.optional(),
  sectorId: uuidSchema.optional(),
  search: z.string().trim().min(1).max(120).optional(),
  ...paginationSchema(100, 20),
});

export type ListUsersQuery = z.output<typeof listUsersQuerySchema>;

export const userIdParamsSchema = z.strictObject({ id: uuidSchema });
