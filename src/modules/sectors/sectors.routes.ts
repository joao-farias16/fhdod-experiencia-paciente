import { type RequestHandler, Router } from 'express';

import type { Database } from '../../lib/database.js';
import type { Clock } from '../../utils/dates.js';
import { idParamsSchema, parseInput } from '../../utils/validation.js';
import { auditContextOf, authOf, requirePermission } from '../auth/auth.middleware.js';
import {
  createSectorSchema,
  listSectorsQuerySchema,
  updateSectorSchema,
} from './sectors.schemas.js';
import { createSector, listSectors, updateSector } from './sectors.service.js';

export interface SectorsRoutesDeps {
  db: Database;
  clock: Clock;
  ipSecret: string | undefined;
}

/** E10–E12 — setores (consulta no escopo; cadastro e alteração pelo SA). Montado em /admin. */
export function sectorsRouter({ db, clock, ipSecret }: SectorsRoutesDeps): Router {
  const router = Router();

  const list: RequestHandler = async (req, res) => {
    const filters = parseInput(listSectorsQuerySchema, req.query);
    res.status(200).json({ data: await listSectors(db, authOf(req), filters) });
  };

  const create: RequestHandler = async (req, res) => {
    const input = parseInput(createSectorSchema, req.body);
    const sector = await createSector(db, authOf(req), auditContextOf(req, ipSecret), input);
    res.status(201).json({ data: sector });
  };

  const update: RequestHandler = async (req, res) => {
    const { id } = parseInput(idParamsSchema, req.params);
    const patch = parseInput(updateSectorSchema, req.body);
    const sector = await updateSector(
      db,
      clock,
      authOf(req),
      auditContextOf(req, ipSecret),
      id,
      patch,
    );
    res.status(200).json({ data: sector });
  };

  router.get('/sectors', requirePermission('E10'), list);
  router.post('/sectors', requirePermission('E11'), create);
  router.patch('/sectors/:id', requirePermission('E12'), update);
  return router;
}
