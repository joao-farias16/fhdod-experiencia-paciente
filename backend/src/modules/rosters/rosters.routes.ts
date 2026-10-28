import { type RequestHandler, Router } from 'express';
import multer from 'multer';

import type { PrismaClient } from '../../lib/prisma.js';
import { requirePermission } from '../../middlewares/authorize.js';
import { profileRateLimit } from '../../middlewares/rate-limit.js';
import type { Clock } from '../../utils/clock.js';
import { HttpError } from '../../utils/http-error.js';
import { parseInput, VALIDATION_MESSAGE } from '../../utils/validation.js';
import { auditContextOf, authOf } from '../auth/request-context.js';
import { idParamsSchema } from '../sectors/sectors.schemas.js';
import { ROSTER_MAX_BYTES } from './roster-csv.js';
import { confirmRosterImport, validateRosterImport } from './rosters.service.js';

export interface RostersRoutesDeps {
  prisma: PrismaClient;
  clock: Clock;
  ipSecret: string | undefined;
}

/**
 * Recebe um único arquivo no campo `file`, somente em memória (Seção 10: CSV em memória).
 * Acima de 1 MB → 413 FILE_TOO_LARGE; demais problemas do multipart → 400.
 */
function receiveCsv(): RequestHandler {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: ROSTER_MAX_BYTES, files: 1, fields: 0, parts: 2 },
  }).single('file');
  return (req, res, next) => {
    upload(req, res, (error: unknown) => {
      if (error instanceof multer.MulterError) {
        next(
          error.code === 'LIMIT_FILE_SIZE'
            ? new HttpError(413, 'FILE_TOO_LARGE', 'O arquivo excede o limite de 1 MB.')
            : new HttpError(400, 'VALIDATION_ERROR', VALIDATION_MESSAGE, [
                { field: 'file', message: 'Envie somente o arquivo CSV no campo "file".' },
              ]),
        );
        return;
      }
      next(error);
    });
  };
}

/** E20 e E21 — importação de escala CSV (pré-validação e confirmação). Montado em /admin. */
export function rostersRouter({ prisma, clock, ipSecret }: RostersRoutesDeps): Router {
  const router = Router();

  const validate: RequestHandler = async (req, res) => {
    if (req.file === undefined) {
      throw new HttpError(400, 'VALIDATION_ERROR', VALIDATION_MESSAGE, [
        { field: 'file', message: 'Envie o arquivo CSV da escala.' },
      ]);
    }
    const result = await validateRosterImport(
      prisma,
      clock,
      authOf(req),
      auditContextOf(req, ipSecret),
      { originalName: req.file.originalname, buffer: req.file.buffer },
    );
    res.status(201).json({ data: result });
  };

  const confirm: RequestHandler = async (req, res) => {
    const { id } = parseInput(idParamsSchema, req.params);
    const result = await confirmRosterImport(
      prisma,
      clock,
      authOf(req),
      auditContextOf(req, ipSecret),
      id,
    );
    res.status(200).json({ data: result });
  };

  router.post(
    '/rosters/import',
    requirePermission('E20'),
    // Seção 10: E20 limitado a 10 envios por hora por perfil.
    profileRateLimit({ windowMs: 3_600_000, limit: 10 }),
    receiveCsv(),
    validate,
  );
  router.post('/rosters/imports/:id/confirm', requirePermission('E21'), confirm);
  return router;
}
