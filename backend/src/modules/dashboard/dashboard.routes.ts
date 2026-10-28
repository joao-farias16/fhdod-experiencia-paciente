import { type RequestHandler, Router } from 'express';

import type { PrismaClient } from '../../lib/prisma.js';
import { requirePermission } from '../../middlewares/authorize.js';
import type { Clock } from '../../utils/clock.js';
import { parseInput } from '../../utils/validation.js';
import { authOf } from '../auth/request-context.js';
import {
  filtersQuerySchema,
  questionsQuerySchema,
  summaryQuerySchema,
  trendsQuerySchema,
} from './dashboard.schemas.js';
import {
  getQuestions,
  getSectors,
  getShifts,
  getSummary,
  getTeams,
  getTrends,
  resolveFilters,
} from './dashboard.service.js';

export interface DashboardRoutesDeps {
  prisma: PrismaClient;
  clock: Clock;
}

/**
 * E28–E33 — indicadores do dashboard (todos os perfis administrativos, no escopo; VI com
 * supressão, RN21). Sem cache no servidor (RF61): cada chamada consulta o banco e a cadeia
 * autenticada responde com Cache-Control: no-store. Montado em /dashboard.
 */
export function dashboardRouter({ prisma, clock }: DashboardRoutesDeps): Router {
  const router = Router();

  const summary: RequestHandler = async (req, res) => {
    const { compare, ...query } = parseInput(summaryQuerySchema, req.query);
    const filters = await resolveFilters(prisma, authOf(req), query, clock.now());
    res.status(200).json({ data: await getSummary(prisma, filters, compare !== undefined) });
  };

  const sectors: RequestHandler = async (req, res) => {
    const filters = await resolveFilters(
      prisma,
      authOf(req),
      parseInput(filtersQuerySchema, req.query),
      clock.now(),
    );
    res.status(200).json({ data: await getSectors(prisma, filters), meta: periodOf(filters) });
  };

  const shifts: RequestHandler = async (req, res) => {
    const filters = await resolveFilters(
      prisma,
      authOf(req),
      parseInput(filtersQuerySchema, req.query),
      clock.now(),
    );
    const { items, coverage } = await getShifts(prisma, filters);
    res.status(200).json({ data: items, meta: { ...periodOf(filters), coverage } });
  };

  const teams: RequestHandler = async (req, res) => {
    const filters = await resolveFilters(
      prisma,
      authOf(req),
      parseInput(filtersQuerySchema, req.query),
      clock.now(),
    );
    const { items, coverage } = await getTeams(prisma, filters);
    res.status(200).json({ data: items, meta: { ...periodOf(filters), coverage } });
  };

  const trends: RequestHandler = async (req, res) => {
    const { granularity, ...query } = parseInput(trendsQuerySchema, req.query);
    const filters = await resolveFilters(prisma, authOf(req), query, clock.now());
    const result = await getTrends(prisma, filters, granularity);
    res.status(200).json({
      data: result.points,
      meta: { ...periodOf(filters), granularity: result.granularity },
    });
  };

  const questions: RequestHandler = async (req, res) => {
    const { journeyStageId, ...query } = parseInput(questionsQuerySchema, req.query);
    const filters = await resolveFilters(prisma, authOf(req), query, clock.now());
    const result = await getQuestions(prisma, filters, journeyStageId);
    res
      .status(200)
      .json({ data: result.items, meta: { ...periodOf(filters), total: result.total } });
  };

  router.get('/summary', requirePermission('E28'), summary);
  router.get('/sectors', requirePermission('E29'), sectors);
  router.get('/shifts', requirePermission('E30'), shifts);
  router.get('/teams', requirePermission('E31'), teams);
  router.get('/trends', requirePermission('E32'), trends);
  router.get('/questions', requirePermission('E33'), questions);
  return router;
}

function periodOf(filters: { from: string; to: string }) {
  return { from: filters.from, to: filters.to };
}
