import type { Request } from 'express';

import { type AuditContext, hashIp } from '../../services/audit.service.js';
import { HttpError } from '../../utils/http-error.js';
import type { AuthContext } from './auth.types.js';
import type { EndpointId } from './permissions.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** Identidade, perfil e escopo preenchidos por `authenticate` (Seção 6). */
    auth?: AuthContext;
    /** Endpoint da Tabela 19 atendido, definido por `requirePermission`. */
    endpointId?: EndpointId;
  }
}

/** Contexto autenticado da requisição; ausente apenas por erro de montagem das rotas. */
export function authOf(req: Request): AuthContext {
  if (req.auth === undefined) {
    throw new HttpError(500, 'INTERNAL_ERROR', 'Ocorreu um erro inesperado. Tente novamente.');
  }
  return req.auth;
}

/** Autor, requestId e HMAC do IP para os registros de auditoria (Seção 10). */
export function auditContextOf(req: Request, ipSecret: string | undefined): AuditContext {
  const actor =
    req.auth === undefined ? null : { profileId: req.auth.profileId, role: req.auth.role };
  return {
    actor,
    requestId: typeof req.id === 'string' ? req.id : undefined,
    ipHash: hashIp(req.ip, ipSecret),
  };
}
