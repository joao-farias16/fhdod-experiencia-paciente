import { type RequestHandler, Router } from 'express';

import { requirePermission } from '../../middlewares/authorize.js';
import { parseInput } from '../../utils/validation.js';
import { auditContextOf, authOf } from '../auth/request-context.js';
import { idParamsSchema } from '../sectors/sectors.schemas.js';
import {
  createSurveySchema,
  listSurveysQuerySchema,
  updateSurveySchema,
} from './surveys.schemas.js';
import {
  createSurvey,
  getSurvey,
  getSurveyLinks,
  listSurveys,
  publishSurvey,
  type SurveysDeps,
  updateSurvey,
} from './surveys.service.js';

export interface SurveysRoutesDeps extends SurveysDeps {
  ipSecret: string | undefined;
}

/** E22–E27 — pesquisas, perguntas, publicação, link e QR Code (SA e AS). Montado em /admin. */
export function surveysRouter(deps: SurveysRoutesDeps): Router {
  const router = Router();

  const list: RequestHandler = async (req, res) => {
    const query = parseInput(listSurveysQuerySchema, req.query);
    const { items, total } = await listSurveys(deps.prisma, authOf(req), query);
    res
      .status(200)
      .json({ data: items, meta: { page: query.page, pageSize: query.pageSize, total } });
  };

  const detail: RequestHandler = async (req, res) => {
    const { id } = parseInput(idParamsSchema, req.params);
    res.status(200).json({ data: await getSurvey(deps, authOf(req), id) });
  };

  const create: RequestHandler = async (req, res) => {
    const input = parseInput(createSurveySchema, req.body);
    const survey = await createSurvey(deps, authOf(req), auditContextOf(req, deps.ipSecret), input);
    res.status(201).json({ data: survey });
  };

  const update: RequestHandler = async (req, res) => {
    const { id } = parseInput(idParamsSchema, req.params);
    const patch = parseInput(updateSurveySchema, req.body);
    const survey = await updateSurvey(
      deps,
      authOf(req),
      auditContextOf(req, deps.ipSecret),
      id,
      patch,
    );
    res.status(200).json({ data: survey });
  };

  const publish: RequestHandler = async (req, res) => {
    const { id } = parseInput(idParamsSchema, req.params);
    const version = await publishSurvey(deps, authOf(req), auditContextOf(req, deps.ipSecret), id);
    res.status(201).json({ data: version });
  };

  const qr: RequestHandler = async (req, res) => {
    const { id } = parseInput(idParamsSchema, req.params);
    res.status(200).json({ data: await getSurveyLinks(deps, authOf(req), id) });
  };

  router.get('/surveys', requirePermission('E22'), list);
  router.get('/surveys/:id', requirePermission('E23'), detail);
  router.post('/surveys', requirePermission('E24'), create);
  router.patch('/surveys/:id', requirePermission('E25'), update);
  router.post('/surveys/:id/publish', requirePermission('E26'), publish);
  router.get('/surveys/:id/qr', requirePermission('E27'), qr);
  return router;
}
