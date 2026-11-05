import { type RequestHandler, Router } from 'express';

import type { Database } from '../../lib/database.js';
import { ipRateLimit } from '../../middlewares/rate-limit.js';
import type { Clock } from '../../utils/dates.js';
import { parseIdempotencyKey } from '../../utils/idempotency.js';
import { idParamsSchema, parseInput } from '../../utils/validation.js';
import { auditContextOf, authOf, requirePermission } from '../auth/auth.middleware.js';
import {
  createManifestationSchema,
  createNoteSchema,
  deleteContactSchema,
  listManifestationsQuerySchema,
  updateManifestationSchema,
} from './manifestations.schemas.js';
import {
  addNote,
  deleteContact,
  getContact,
  getManifestation,
  listManifestations,
  updateManifestation,
} from './ombudsman.service.js';
import {
  createManifestation,
  type PublicManifestationDeps,
} from './public-manifestation.service.js';

/** E03 — manifestação pública, sem login nem cookies; limite de 10/min por IP (Seção 10). */
export function publicManifestationRouter(deps: PublicManifestationDeps): Router {
  const router = Router();
  const create: RequestHandler = async (req, res) => {
    const idempotencyKey = parseIdempotencyKey(req.get('Idempotency-Key'));
    const input = parseInput(createManifestationSchema, req.body);
    const result = await createManifestation(deps, idempotencyKey, input);
    res.set('Cache-Control', 'no-store');
    if (result.replayed) res.set('Idempotent-Replayed', 'true');
    res.status(result.replayed ? 200 : 201).json({ data: result.data });
  };
  router.post(
    '/public/manifestations',
    ipRateLimit({ windowMs: 60_000, limit: 10 }),
    requirePermission('E03'),
    create,
  );
  return router;
}

export interface OmbudsmanRoutesDeps {
  db: Database;
  clock: Clock;
  ipSecret: string | undefined;
}

/** E35–E40 — Ouvidoria (somente OU, no escopo). Montado em /ouvidoria após a cadeia autenticada. */
export function ombudsmanRouter({ db, clock, ipSecret }: OmbudsmanRoutesDeps): Router {
  const router = Router();

  const list: RequestHandler = async (req, res) => {
    const query = parseInput(listManifestationsQuerySchema, req.query);
    const { items, total, period } = await listManifestations(db, authOf(req), query, clock.now());
    res.status(200).json({
      data: items,
      meta: { page: query.page, pageSize: query.pageSize, total, from: period.from, to: period.to },
    });
  };

  const show: RequestHandler = async (req, res) => {
    const { id } = parseInput(idParamsSchema, req.params);
    const detail = await getManifestation(db, authOf(req), auditContextOf(req, ipSecret), id);
    res.status(200).json({ data: detail });
  };

  const update: RequestHandler = async (req, res) => {
    const { id } = parseInput(idParamsSchema, req.params);
    const patch = parseInput(updateManifestationSchema, req.body);
    const detail = await updateManifestation(
      db,
      clock,
      authOf(req),
      auditContextOf(req, ipSecret),
      id,
      patch,
    );
    res.status(200).json({ data: detail });
  };

  const note: RequestHandler = async (req, res) => {
    const { id } = parseInput(idParamsSchema, req.params);
    const { content } = parseInput(createNoteSchema, req.body);
    const created = await addNote(
      db,
      clock,
      authOf(req),
      auditContextOf(req, ipSecret),
      id,
      content,
    );
    res.status(201).json({ data: created });
  };

  const contact: RequestHandler = async (req, res) => {
    const { id } = parseInput(idParamsSchema, req.params);
    const data = await getContact(db, authOf(req), auditContextOf(req, ipSecret), id);
    // RF48: contato nunca armazenado em cache (a cadeia autenticada já envia no-store).
    res.set('Cache-Control', 'no-store').status(200).json({ data });
  };

  const removeContact: RequestHandler = async (req, res) => {
    const { id } = parseInput(idParamsSchema, req.params);
    const { reason } = parseInput(deleteContactSchema, req.body ?? {});
    await deleteContact(db, clock, authOf(req), auditContextOf(req, ipSecret), id, reason);
    res.status(204).end();
  };

  router.get('/manifestations', requirePermission('E35'), list);
  router.get('/manifestations/:id', requirePermission('E36'), show);
  router.patch('/manifestations/:id', requirePermission('E37'), update);
  router.post('/manifestations/:id/notes', requirePermission('E38'), note);
  router.get('/manifestations/:id/contact', requirePermission('E39'), contact);
  router.delete('/manifestations/:id/contact', requirePermission('E40'), removeContact);
  return router;
}
