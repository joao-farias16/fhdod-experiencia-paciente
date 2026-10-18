import { type RequestHandler, Router } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../../lib/prisma.js';
import { requirePermission } from '../../middlewares/authorize.js';
import { parseInput, queryBoolean } from '../../utils/validation.js';
import { authOf } from '../auth/request-context.js';
import { listSectors } from './sectors.service.js';

const listSectorsQuerySchema = z.strictObject({
  isActive: queryBoolean.optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

/** E10 — GET /admin/sectors (todos os perfis administrativos, no escopo). Montado em /admin. */
export function sectorsRouter({ prisma }: { prisma: PrismaClient }): Router {
  const router = Router();
  const list: RequestHandler = async (req, res) => {
    const filters = parseInput(listSectorsQuerySchema, req.query);
    res.status(200).json({ data: await listSectors(prisma, authOf(req), filters) });
  };
  router.get('/sectors', requirePermission('E10'), list);
  return router;
}
