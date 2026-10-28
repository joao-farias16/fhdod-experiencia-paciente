import { type RequestHandler, Router } from 'express';

import type { PrismaClient } from '../../lib/prisma.js';
import { requirePermission } from '../../middlewares/authorize.js';
import type { Clock } from '../../utils/clock.js';
import { parseInput } from '../../utils/validation.js';
import { authOf } from '../auth/request-context.js';
import { listAuditLogsQuerySchema } from './audit-logs.schemas.js';
import { listAuditLogs } from './audit-logs.service.js';

export interface AuditLogsRoutesDeps {
  prisma: PrismaClient;
  clock: Clock;
}

/** E41 — GET /admin/audit-logs (somente SA). Montado em /admin. */
export function auditLogsRouter({ prisma, clock }: AuditLogsRoutesDeps): Router {
  const router = Router();
  const list: RequestHandler = async (req, res) => {
    const query = parseInput(listAuditLogsQuerySchema, req.query);
    const { items, total, period } = await listAuditLogs(
      prisma,
      authOf(req).hospitalId,
      query,
      clock.now(),
    );
    res.status(200).json({
      data: items,
      meta: { page: query.page, pageSize: query.pageSize, total, from: period.from, to: period.to },
    });
  };
  router.get('/audit-logs', requirePermission('E41'), list);
  return router;
}
