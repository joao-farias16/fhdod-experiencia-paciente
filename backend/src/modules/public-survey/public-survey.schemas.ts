import { z } from 'zod';

import { uuidSchema } from '../../utils/validation.js';
import { MAX_ACTIVE_SPECIFIC_QUESTIONS, SLUG_PATTERN } from '../surveys/surveys.schemas.js';

/** E01 — slug kebab-case até 80 caracteres; fora do formato é tratado como inexistente (404). */
export function isPublicSlug(value: string): boolean {
  return value.length <= 80 && SLUG_PATTERN.test(value);
}

/**
 * E02 — POST /public/responses (RF34, RF35, RF37). Somente inteiros: NPS de 0 a 10 obrigatório e
 * específicas de 1 a 5, opcionais, sem repetir pergunta. Texto ("9") ou decimal (7,5) → 400.
 */
export const submitResponseSchema = z.strictObject({
  surveyVersionId: uuidSchema,
  origin: z.enum(['qr_code', 'link'], { error: 'Origem inválida.' }),
  npsScore: z
    .number({ error: 'Escolha uma nota de 0 a 10.' })
    .int('A nota deve ser um número inteiro.')
    .min(0, 'A nota deve estar entre 0 e 10.')
    .max(10, 'A nota deve estar entre 0 e 10.'),
  answers: z
    .array(
      z.strictObject({
        questionId: uuidSchema,
        score: z
          .number({ error: 'Escolha uma nota de 1 a 5.' })
          .int('A nota deve ser um número inteiro.')
          .min(1, 'A nota deve estar entre 1 e 5.')
          .max(5, 'A nota deve estar entre 1 e 5.'),
      }),
      { error: 'Envie a lista de respostas.' },
    )
    .max(MAX_ACTIVE_SPECIFIC_QUESTIONS, 'Envie no máximo 10 respostas específicas.')
    .refine(
      (answers) => new Set(answers.map((answer) => answer.questionId)).size === answers.length,
      'Não repita a mesma pergunta.',
    )
    .default([]),
});

export type SubmitResponseInput = z.output<typeof submitResponseSchema>;
