import { type RequestHandler, Router } from 'express';

import type { Database } from '../../lib/database.js';
import type { Clock } from '../../utils/dates.js';
import { idParamsSchema, parseInput } from '../../utils/validation.js';
import { auditContextOf, authOf, requirePermission } from '../auth/auth.middleware.js';
import { createTeamSchema, listTeamsQuerySchema, updateTeamSchema } from './teams.schemas.js';
import { createTeam, listJourneyStages, listTeams, updateTeam } from './teams.service.js';

export interface TeamsRoutesDeps {
  db: Database;
  clock: Clock;
  ipSecret: string | undefined;
}

/** E13–E15 (equipes) e E16 (etapas da jornada). Montado em /admin. */
export function teamsRouter({ db, clock, ipSecret }: TeamsRoutesDeps): Router {
  const router = Router();

  const list: RequestHandler = async (req, res) => {
    const filters = parseInput(listTeamsQuerySchema, req.query);
    res.status(200).json({ data: await listTeams(db, authOf(req), filters) });
  };

  const create: RequestHandler = async (req, res) => {
    const input = parseInput(createTeamSchema, req.body);
    const team = await createTeam(db, authOf(req), auditContextOf(req, ipSecret), input);
    res.status(201).json({ data: team });
  };

  const update: RequestHandler = async (req, res) => {
    const { id } = parseInput(idParamsSchema, req.params);
    const patch = parseInput(updateTeamSchema, req.body);
    const team = await updateTeam(db, clock, authOf(req), auditContextOf(req, ipSecret), id, patch);
    res.status(200).json({ data: team });
  };

  const stages: RequestHandler = async (req, res) => {
    res.status(200).json({ data: await listJourneyStages(db, authOf(req)) });
  };

  router.get('/teams', requirePermission('E13'), list);
  router.post('/teams', requirePermission('E14'), create);
  router.patch('/teams/:id', requirePermission('E15'), update);
  router.get('/journey-stages', requirePermission('E16'), stages);
  return router;
}
