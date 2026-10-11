import type { RequestHandler } from 'express';

import { HttpError } from '../utils/http-error.js';

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404, 'ROUTE_NOT_FOUND', 'O recurso solicitado não existe.'));
};
