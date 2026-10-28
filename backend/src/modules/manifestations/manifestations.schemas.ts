import { z } from 'zod';

import { csvList, localDateSchema, refinePeriod } from '../../utils/period.js';
import { paginationSchema, queryBoolean, uuidSchema } from '../../utils/validation.js';

/** RF41: descrição de 10 a 2.000 caracteres; RF47: nota interna de 1 a 2.000. */
export const DESCRIPTION_MIN = 10;
export const TEXT_MAX = 2000;
/** RN23: concluir exige providências com 10 caracteres ou mais. */
export const ACTIONS_MIN = 10;
/** Versão do texto de finalidade do contato aceito pelo respondente (Seção 4.3). */
export const PURPOSE_TEXT_VERSION = 'v1';
export const PURPOSE_TEXT =
  'Seus dados de contato serão usados somente pela Ouvidoria da Fundação Hospitalar Dr. Oswaldo ' +
  'Diesel para dar retorno sobre esta manifestação. Eles não aparecem nos resultados da pesquisa.';

export const MANIFESTATION_TYPES = ['compliment', 'complaint', 'suggestion'] as const;
export const MANIFESTATION_STATUSES = [
  'received',
  'in_review',
  'forwarded',
  'resolved',
  'archived',
] as const;
export const MANIFESTATION_PRIORITIES = ['low', 'medium', 'high'] as const;
export const CONTACT_DELETION_REASONS = ['holder_request', 'return_completed', 'other'] as const;

export type ManifestationStatusValue = (typeof MANIFESTATION_STATUSES)[number];

/** RN23: transições permitidas de status. */
export const STATUS_TRANSITIONS: Readonly<
  Record<ManifestationStatusValue, readonly ManifestationStatusValue[]>
> = {
  received: ['in_review', 'archived'],
  in_review: ['forwarded', 'resolved', 'archived'],
  forwarded: ['in_review', 'resolved'],
  resolved: ['in_review'],
  archived: ['in_review'],
};

export function canTransition(from: ManifestationStatusValue, to: ManifestationStatusValue) {
  return STATUS_TRANSITIONS[from].includes(to);
}

const trimmedText = (min: number, max: number, minMessage: string) =>
  z
    .string({ error: 'Escreva o texto.' })
    .trim()
    .min(min, minMessage)
    .max(max, `Use no máximo ${max.toLocaleString('pt-BR')} caracteres.`);

/**
 * RF43: nome e telefone ou e-mail, com aceite da finalidade. Telefone somente com dígitos e DDD
 * (10 ou 11 dígitos); máscaras comuns são removidas antes da validação.
 */
const contactSchema = z
  .strictObject({
    fullName: z
      .string({ error: 'Informe seu nome.' })
      .trim()
      .min(1, 'Informe seu nome.')
      .max(120, 'Use no máximo 120 caracteres.'),
    phone: z
      .string()
      .transform((value) => value.replace(/[\s().-]/g, ''))
      .pipe(z.string().regex(/^\d{10,11}$/, 'Informe o telefone com DDD (10 ou 11 dígitos).'))
      .optional(),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.email('Informe um e-mail válido.').max(254))
      .optional(),
    consent: z.literal(true, { error: 'Aceite a finalidade para informar o contato.' }),
  })
  .refine((contact) => contact.phone !== undefined || contact.email !== undefined, {
    path: ['email'],
    message: 'Informe um telefone ou um e-mail.',
  });

/**
 * E03 — POST /public/manifestations (RF41–RF43, RN04, RN12, RN22). Anônima é a opção padrão;
 * contato somente em manifestação não anônima (anonymous: true com contato → 400).
 */
export const createManifestationSchema = z
  .strictObject({
    responseId: uuidSchema,
    manifestationToken: z
      .string({ error: 'Envie o token da manifestação.' })
      .min(1, 'Envie o token da manifestação.')
      .max(128, 'Token inválido.'),
    type: z.enum(MANIFESTATION_TYPES, { error: 'Escolha elogio, reclamação ou sugestão.' }),
    description: trimmedText(
      DESCRIPTION_MIN,
      TEXT_MAX,
      `Escreva pelo menos ${DESCRIPTION_MIN} caracteres.`,
    ),
    anonymous: z.boolean({ error: 'Informe se a manifestação é anônima.' }).default(true),
    contact: contactSchema.optional(),
  })
  .superRefine((input, ctx) => {
    if (input.anonymous && input.contact !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['contact'],
        message: 'Manifestação anônima não recebe dados de contato.',
      });
    }
    if (!input.anonymous && input.contact === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['contact'],
        message: 'Informe seu contato ou envie sem se identificar.',
      });
    }
  });

export type CreateManifestationInput = z.output<typeof createManifestationSchema>;

// -------------------------------------------------------------------------------------------
// Ouvidoria (E35–E40)
// -------------------------------------------------------------------------------------------

export const MANIFESTATION_SORTS = [
  'received_desc',
  'received_asc',
  'priority_desc',
  'status_asc',
] as const;

/** E35 — filtros da lista da Ouvidoria (RF44). */
export const listManifestationsQuerySchema = z
  .strictObject({
    status: csvList(z.enum(MANIFESTATION_STATUSES, { error: 'Status inválido.' })).optional(),
    type: csvList(z.enum(MANIFESTATION_TYPES, { error: 'Tipo inválido.' })).optional(),
    priority: csvList(
      z.enum(MANIFESTATION_PRIORITIES, { error: 'Prioridade inválida.' }),
    ).optional(),
    sectorIds: csvList(uuidSchema).optional(),
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
    protocol: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^FHD-\d{4}-\d{6}$/, 'Use o protocolo no formato FHD-AAAA-NNNNNN.')
      .optional(),
    hasContact: queryBoolean.optional(),
    sort: z.enum(MANIFESTATION_SORTS, { error: 'Ordenação inválida.' }).default('received_desc'),
    ...paginationSchema(100, 25),
  })
  .superRefine(refinePeriod);

export type ListManifestationsQuery = z.output<typeof listManifestationsQuerySchema>;

export const idParamsSchema = z.strictObject({ id: uuidSchema });

/** E37 — status (RN23), prioridade e providências com controle de concorrência (RF46). */
export const updateManifestationSchema = z
  .strictObject({
    updatedAt: z.iso.datetime({ error: 'Envie a data da última atualização (updatedAt).' }),
    status: z.enum(MANIFESTATION_STATUSES, { error: 'Status inválido.' }).optional(),
    priority: z.enum(MANIFESTATION_PRIORITIES, { error: 'Prioridade inválida.' }).optional(),
    actionsTaken: trimmedText(1, TEXT_MAX, 'Descreva as providências.').optional(),
    note: trimmedText(1, TEXT_MAX, 'Escreva a nota.').optional(),
  })
  .refine(
    (patch) =>
      patch.status !== undefined ||
      patch.priority !== undefined ||
      patch.actionsTaken !== undefined,
    { path: ['status'], message: 'Informe status, prioridade ou providências.' },
  );

export type UpdateManifestationInput = z.output<typeof updateManifestationSchema>;

/** E38 — nota interna (RF47). */
export const createNoteSchema = z.strictObject({
  content: trimmedText(1, TEXT_MAX, 'Escreva a nota.'),
});

/** E40 — motivo da eliminação do contato (RF49). */
export const deleteContactSchema = z.strictObject({
  reason: z.enum(CONTACT_DELETION_REASONS, { error: 'Informe o motivo da eliminação.' }),
});
