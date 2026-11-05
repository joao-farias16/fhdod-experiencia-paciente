import { type RequestHandler, Router } from 'express';
import multer from 'multer';

import type { Database } from '../../lib/database.js';
import { profileRateLimit } from '../../middlewares/rate-limit.js';
import type { Clock } from '../../utils/dates.js';
import { HttpError } from '../../utils/errors.js';
import { idParamsSchema, invalidField, parseInput } from '../../utils/validation.js';
import { auditContextOf, authOf, requirePermission } from '../auth/auth.middleware.js';
import { ROSTER_MAX_BYTES } from './roster-csv.js';
import { confirmRosterImport, validateRosterImport } from './rosters.service.js';
import { cancelShiftSchema, createShiftSchema, listShiftsQuerySchema } from './shifts.schemas.js';
import { cancelShift, createShift, listShifts } from './shifts.service.js';

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
            : invalidField('file', 'Envie somente o arquivo CSV no campo "file".'),
        );
        return;
      }
      next(error);
    });
  };
}

export interface ShiftsRoutesDeps {
  db: Database;
  clock: Clock;
  ipSecret: string | undefined;
}

/**
 * Escala de turnos, montada em /admin: E17–E19 (consulta, cadastro manual e cancelamento) e
 * E20–E21 (importação de escala CSV: pré-validação e confirmação).
 */
export function shiftsRouter({ db, clock, ipSecret }: ShiftsRoutesDeps): Router {
  const router = Router();

  const list: RequestHandler = async (req, res) => {
    const query = parseInput(listShiftsQuerySchema, req.query);
    res.status(200).json({ data: await listShifts(db, authOf(req), query) });
  };

  const create: RequestHandler = async (req, res) => {
    const input = parseInput(createShiftSchema, req.body);
    const shift = await createShift(db, clock, authOf(req), auditContextOf(req, ipSecret), input);
    res.status(201).json({ data: shift });
  };

  const cancel: RequestHandler = async (req, res) => {
    const { id } = parseInput(idParamsSchema, req.params);
    const input = parseInput(cancelShiftSchema, req.body);
    const shift = await cancelShift(
      db,
      clock,
      authOf(req),
      auditContextOf(req, ipSecret),
      id,
      input,
    );
    res.status(200).json({ data: shift });
  };

  const validate: RequestHandler = async (req, res) => {
    if (req.file === undefined) {
      throw invalidField('file', 'Envie o arquivo CSV da escala.');
    }
    const result = await validateRosterImport(
      db,
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
      db,
      clock,
      authOf(req),
      auditContextOf(req, ipSecret),
      id,
    );
    res.status(200).json({ data: result });
  };

  router.get('/shifts', requirePermission('E17'), list);
  router.post('/shifts', requirePermission('E18'), create);
  router.patch('/shifts/:id', requirePermission('E19'), cancel);
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
