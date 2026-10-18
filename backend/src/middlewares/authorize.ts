import type { ErrorRequestHandler, RequestHandler } from 'express';

import type { PrismaClient } from '../lib/prisma.js';
import { auditContextOf, authOf } from '../modules/auth/request-context.js';
import { ENDPOINTS, type EndpointId, hasPermission } from '../modules/auth/permissions.js';
import { recordAudit } from '../services/audit.service.js';
import { AuthorizationDeniedError, HttpError } from '../utils/http-error.js';

/**
 * requirePasswordChanged (RF04, RN28): com troca de senha pendente, toda rota autenticada
 * diferente de E04 e E05 responde 403 PASSWORD_CHANGE_REQUIRED.
 */
export const requirePasswordChanged: RequestHandler = (req, _res, next) => {
  if (authOf(req).mustChangePassword) {
    throw new HttpError(
      403,
      'PASSWORD_CHANGE_REQUIRED',
      'Troque sua senha para continuar usando o sistema.',
    );
  }
  next();
};

/**
 * requirePermission (Seção 6, Tabela 13): exige a permissão do endpoint da Tabela 19.
 * Sem permissão → 403 FORBIDDEN, auditado como AUTHORIZATION_DENIED.
 */
export function requirePermission(endpointId: EndpointId): RequestHandler {
  const { access } = ENDPOINTS[endpointId];
  return (req, _res, next) => {
    req.endpointId = endpointId;
    if (access === 'public') {
      next();
      return;
    }
    if (!hasPermission(authOf(req).role, access)) {
      throw new AuthorizationDeniedError(
        'FORBIDDEN',
        'Você não tem permissão para realizar esta ação.',
        access,
      );
    }
    next();
  };
}

export interface DenialAuditDeps {
  prisma: Pick<PrismaClient, 'auditLog'>;
  ipSecret: string | undefined;
}

/**
 * Registra cada negativa de autorização (FORBIDDEN e SECTOR_OUT_OF_SCOPE) exatamente uma vez em
 * audit_logs (Seção 10). Falha ao auditar não libera o acesso: a resposta continua 403.
 */
export function auditAuthorizationDenials({
  prisma,
  ipSecret,
}: DenialAuditDeps): ErrorRequestHandler {
  return async (error: unknown, req, _res, next) => {
    if (error instanceof AuthorizationDeniedError && req.auth !== undefined && !error.audited) {
      error.audited = true;
      try {
        await recordAudit(prisma, auditContextOf(req, ipSecret), {
          action: 'AUTHORIZATION_DENIED',
          entityType: 'endpoint',
          entityId: req.endpointId ?? `${req.method} ${req.baseUrl}${req.path}`.slice(0, 64),
          details: {
            code: error.code,
            method: req.method,
            permission: error.permission ?? null,
          },
        });
      } catch (auditError) {
        req.log.error({ err: auditError }, 'Falha ao auditar negativa de autorização');
      }
    }
    next(error);
  };
}
