import { type RequestHandler, Router } from 'express';

import type { PrismaClient } from '../../lib/prisma.js';
import type { Clock } from '../../utils/dates.js';
import { parseInput } from '../../utils/validation.js';
import { authOf, requirePermission } from '../auth/auth.middleware.js';
import { listAuditLogsQuerySchema } from './audit.schemas.js';
import { listAuditLogs } from './audit.service.js';

export interface AuditRoutesDeps {
  prisma: PrismaClient;
  clock: Clock;
}

/** E41 — GET /admin/audit-logs (somente SA). Montado em /admin. */
export function auditRouter({ prisma, clock }: AuditRoutesDeps): Router {
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
