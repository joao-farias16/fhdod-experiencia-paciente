import { z } from 'zod';

import { paginationSchema, uuidSchema } from '../../utils/validation.js';

/** Textos padrão da Seção 4.3 (provisórios até a aprovação do hospital, Tabela 4). */
export const DEFAULT_NPS_TEXT =
  'Em uma escala de 0 a 10, o quanto você recomendaria o atendimento deste setor a um amigo ou familiar?';
export const DEFAULT_THANK_YOU_MESSAGE =
  'Obrigado por responder. Sua opinião ajuda a melhorar o atendimento.';

/** RN27: no máximo 10 perguntas específicas ativas por pesquisa. */
export const MAX_ACTIVE_SPECIFIC_QUESTIONS = 10;

/** Slug kebab-case com até 80 caracteres (CHECK survey_configs_slug_kebab_case). */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const slugSchema = z
  .string({ error: 'Informe o endereço da pesquisa.' })
  .trim()
  .max(80, 'O endereço deve ter no máximo 80 caracteres.')
  .regex(SLUG_PATTERN, 'Use letras minúsculas, números e hífens (exemplo: pronto-atendimento).');

const titleSchema = z
  .string({ error: 'Informe o título.' })
  .trim()
  .min(3, 'O título deve ter ao menos 3 caracteres.')
  .max(120, 'O título deve ter no máximo 120 caracteres.');

const introSchema = z
  .string({ error: 'Informe um texto.' })
  .trim()
  .max(500, 'A introdução deve ter no máximo 500 caracteres.')
  .transform((value) => (value === '' ? null : value))
  .nullable();

const thankYouSchema = z
  .string({ error: 'Informe o agradecimento.' })
  .trim()
  .min(3, 'O agradecimento deve ter ao menos 3 caracteres.')
  .max(500, 'O agradecimento deve ter no máximo 500 caracteres.');

const questionTextSchema = z
  .string({ error: 'Informe o texto da pergunta.' })
  .trim()
  .min(5, 'A pergunta deve ter ao menos 5 caracteres.')
  .max(200, 'A pergunta deve ter no máximo 200 caracteres.');

/** E22 — GET /admin/surveys. */
export const listSurveysQuerySchema = z.strictObject({
  sectorId: uuidSchema.optional(),
  status: z.enum(['draft', 'active', 'inactive']).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  ...paginationSchema(100, 20),
});

export type ListSurveysQuery = z.output<typeof listSurveysQuerySchema>;

/** E24 — POST /admin/surveys (RF25): rascunho com a pergunta geral criada automaticamente. */
export const createSurveySchema = z.strictObject({
  sectorId: uuidSchema,
  title: titleSchema,
  slug: slugSchema,
  introText: introSchema.optional(),
  thankYouMessage: thankYouSchema.optional(),
});

export type CreateSurveyInput = z.output<typeof createSurveySchema>;

/**
 * Inclusão (sem `id`, exige texto e etapa) ou alteração (com `id`) de pergunta (RF27, RF28).
 * Tipo e obrigatoriedade são definidos pelo sistema: específicas são sempre escala 1–5 opcional.
 */
const questionChangeSchema = z
  .strictObject({
    id: uuidSchema.optional(),
    text: questionTextSchema.optional(),
    journeyStageId: uuidSchema.optional(),
    position: z.number().int().min(1).max(100).optional(),
    isActive: z.boolean({ error: 'Informe verdadeiro ou falso.' }).optional(),
  })
  .superRefine((question, ctx) => {
    if (question.id !== undefined) return;
    if (question.text === undefined) {
      ctx.addIssue({ code: 'custom', path: ['text'], message: 'Informe o texto da pergunta.' });
    }
    if (question.journeyStageId === undefined) {
      ctx.addIssue({ code: 'custom', path: ['journeyStageId'], message: 'Escolha a etapa.' });
    }
  });

export type QuestionChange = z.output<typeof questionChangeSchema>;

/**
 * E25 — PATCH /admin/surveys/:id (RF26–RF28, RF31). Textos editáveis a qualquer tempo; setor, slug
 * e texto da pergunta geral só antes da primeira publicação (422 FIELD_LOCKED_AFTER_PUBLICATION).
 */
export const updateSurveySchema = z
  .strictObject({
    title: titleSchema.optional(),
    introText: introSchema.optional(),
    thankYouMessage: thankYouSchema.optional(),
    slug: slugSchema.optional(),
    sectorId: uuidSchema.optional(),
    npsQuestionText: questionTextSchema.optional(),
    isActive: z.boolean({ error: 'Informe verdadeiro ou falso.' }).optional(),
    questions: z
      .array(questionChangeSchema)
      .max(30, 'Envie no máximo 30 alterações de perguntas por vez.')
      .refine((items) => {
        const ids = items.flatMap((item) => (item.id === undefined ? [] : [item.id]));
        return new Set(ids).size === ids.length;
      }, 'Não repita a mesma pergunta.')
      .optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Informe ao menos um campo para alterar.',
  });

export type UpdateSurveyInput = z.output<typeof updateSurveySchema>;
