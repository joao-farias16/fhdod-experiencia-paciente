import { type RequestHandler, Router } from 'express';

import type { PrismaClient } from '../../lib/prisma.js';
import { requirePermission } from '../../middlewares/authorize.js';
import type { Clock } from '../../utils/clock.js';
import { parseInput } from '../../utils/validation.js';
import { auditContextOf, authOf } from '../auth/request-context.js';
import { idParamsSchema } from '../sectors/sectors.schemas.js';
import { cancelShiftSchema, createShiftSchema, listShiftsQuerySchema } from './shifts.schemas.js';
import { cancelShift, createShift, listShifts } from './shifts.service.js';

export interface ShiftsRoutesDeps {
  prisma: PrismaClient;
  clock: Clock;
  ipSecret: string | undefined;
}

/** E17–E19 — escala de turnos: consulta, cadastro manual e cancelamento. Montado em /admin. */
export function shiftsRouter({ prisma, clock, ipSecret }: ShiftsRoutesDeps): Router {
  const router = Router();

  const list: RequestHandler = async (req, res) => {
    const query = parseInput(listShiftsQuerySchema, req.query);
    res.status(200).json({ data: await listShifts(prisma, authOf(req), query) });
  };

  const create: RequestHandler = async (req, res) => {
    const input = parseInput(createShiftSchema, req.body);
    const shift = await createShift(
      prisma,
      clock,
      authOf(req),
      auditContextOf(req, ipSecret),
      input,
    );
    res.status(201).json({ data: shift });
  };

  const cancel: RequestHandler = async (req, res) => {
    const { id } = parseInput(idParamsSchema, req.params);
    const input = parseInput(cancelShiftSchema, req.body);
    const shift = await cancelShift(
      prisma,
      clock,
      authOf(req),
      auditContextOf(req, ipSecret),
      id,
      input,
    );
    res.status(200).json({ data: shift });
  };

  router.get('/shifts', requirePermission('E17'), list);
  router.post('/shifts', requirePermission('E18'), create);
  router.patch('/shifts/:id', requirePermission('E19'), cancel);
  return router;
}
