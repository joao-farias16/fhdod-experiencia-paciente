import { type RequestHandler, Router } from 'express';

import { requirePermission } from '../../middlewares/authorize.js';
import { ipRateLimit } from '../../middlewares/rate-limit.js';
import { parseIdempotencyKey } from '../../services/idempotency.js';
import { parseInput } from '../../utils/validation.js';
import { isPublicSlug, submitResponseSchema } from './public-survey.schemas.js';
import {
  getPublicSurvey,
  type PublicSurveyDeps,
  submitResponse,
  surveyNotFound,
} from './public-survey.service.js';

/**
 * E01 e E02 — pesquisa pública, sem login nem cookies (RF33). Limites por IP (Seção 10): E01
 * 60/min e E02 30/min. E01 usa cache público de 60 s (Seção 9).
 */
export function publicSurveyRouter(deps: PublicSurveyDeps): Router {
  const router = Router();

  const show: RequestHandler = async (req, res) => {
    const slug = String(req.params.slug);
    if (!isPublicSlug(slug)) throw surveyNotFound();
    const survey = await getPublicSurvey(deps.prisma, slug);
    res.set('Cache-Control', 'public, max-age=60').status(200).json({ data: survey });
  };

  const submit: RequestHandler = async (req, res) => {
    const idempotencyKey = parseIdempotencyKey(req.get('Idempotency-Key'));
    const input = parseInput(submitResponseSchema, req.body);
    const result = await submitResponse(deps, idempotencyKey, input);
    res.set('Cache-Control', 'no-store');
    if (result.replayed) res.set('Idempotent-Replayed', 'true');
    res.status(result.replayed ? 200 : 201).json({ data: result.data });
  };

  router.get(
    '/public/surveys/:slug',
    ipRateLimit({ windowMs: 60_000, limit: 60 }),
    requirePermission('E01'),
    show,
  );
  router.post(
    '/public/responses',
    ipRateLimit({ windowMs: 60_000, limit: 30 }),
    requirePermission('E02'),
    submit,
  );
  return router;
}
