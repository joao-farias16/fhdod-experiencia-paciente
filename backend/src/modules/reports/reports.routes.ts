import { type RequestHandler, Router } from 'express';

import type { PrismaClient } from '../../lib/prisma.js';
import { requirePermission } from '../../middlewares/authorize.js';
import { profileRateLimit } from '../../middlewares/rate-limit.js';
import type { Clock } from '../../utils/clock.js';
import { HttpError } from '../../utils/http-error.js';
import { parseInput, VALIDATION_MESSAGE } from '../../utils/validation.js';
import { auditContextOf, authOf } from '../auth/request-context.js';
import {
  exportQuerySchema,
  REPORT_ENDPOINTS,
  REPORT_TYPES,
  type ReportType,
} from './reports.schemas.js';
import { exportReport } from './reports.service.js';
import { XLSX_CONTENT_TYPE } from './xlsx.js';

export interface ReportsRoutesDeps {
  prisma: PrismaClient;
  clock: Clock;
  ipSecret: string | undefined;
}

function isReportType(value: unknown): value is ReportType {
  return typeof value === 'string' && (REPORT_TYPES as readonly string[]).includes(value);
}

/**
 * A permissão de E34 depende do tipo (Tabela 13): respostas e indicadores para SA, AS e GE;
 * manifestações somente para OU. O tipo é lido antes da validação completa para que um perfil sem
 * permissão receba 403 (auditado) e não detalhes de validação.
 */
const requireReportPermission: RequestHandler = (req, res, next) => {
  const { type } = req.query;
  if (!isReportType(type)) {
    throw new HttpError(400, 'VALIDATION_ERROR', VALIDATION_MESSAGE, [
      { field: 'type', message: 'Use responses, indicators ou manifestations.' },
    ]);
  }
  requirePermission(REPORT_ENDPOINTS[type])(req, res, next);
};

/** E34 — GET /reports/export (RF62–RF67): .xlsx como anexo, no-store, 10 a cada 10 min por perfil. */
export function reportsRouter({ prisma, clock, ipSecret }: ReportsRoutesDeps): Router {
  const router = Router();

  const download: RequestHandler = async (req, res) => {
    const query = parseInput(exportQuerySchema, req.query);
    const result = await exportReport(
      prisma,
      authOf(req),
      auditContextOf(req, ipSecret),
      query,
      clock.now(),
    );
    res
      .status(200)
      .set({
        'Content-Type': XLSX_CONTENT_TYPE,
        'Content-Disposition': `attachment; filename="${result.fileName}"`,
        'Content-Length': String(result.buffer.length),
        'Cache-Control': 'no-store',
      })
      .end(result.buffer);
  };

  router.get(
    '/export',
    requireReportPermission,
    profileRateLimit({ windowMs: 10 * 60_000, limit: 10 }),
    download,
  );
  return router;
}
