/**
 * Middlewares e auxiliares de requisição da autenticação e da autorização (Seção 6): authenticate,
 * requirePasswordChanged, requirePermission, auditoria das negativas e leitura de req.auth.
 */
import type { ErrorRequestHandler, Request, RequestHandler } from 'express';

import type { PrismaClient } from '../../lib/prisma.js';
import { AuthorizationDeniedError, HttpError, unauthenticated } from '../../utils/errors.js';
import { type AuditContext, hashIp, recordAudit } from '../audit/audit.service.js';
import { type AuthProfileReader, findAuthProfile } from './auth.service.js';
import type { AuthContext, TokenVerifier } from './auth.types.js';
import { type EndpointId, ENDPOINTS, hasPermission } from './permissions.js';

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

export interface AuthenticateDeps {
  verifier: TokenVerifier;
  prisma: AuthProfileReader;
}

const BEARER = /^Bearer ([^\s]+)$/i;

function accountDisabled(): HttpError {
  return new HttpError(
    403,
    'ACCOUNT_DISABLED',
    'Sua conta está desativada. Procure o superadministrador.',
  );
}

/**
 * authenticate (Seção 6): valida o token Bearer no Supabase Auth (auth.getUser) e carrega o
 * perfil, a situação da conta e o escopo a cada requisição. Token ausente, malformado, expirado
 * ou revogado → 401; perfil inexistente → 401; conta desativada (perfil inativo ou bloqueio no
 * Supabase) → 403 ACCOUNT_DISABLED, mesmo com o token ainda válido (RF09).
 * Respostas autenticadas usam Cache-Control: no-store (Seção 9).
 */
export function authenticate({ verifier, prisma }: AuthenticateDeps): RequestHandler {
  return async (req, res, next) => {
    res.set('Cache-Control', 'no-store');

    const header = req.get('authorization');
    const token = header === undefined ? undefined : BEARER.exec(header.trim())?.[1];
    if (token === undefined) throw unauthenticated();

    const verification = await verifier.verify(token);
    if (verification.status === 'invalid') throw unauthenticated();

    const profile = await findAuthProfile(prisma, verification.authUserId);
    if (profile === null) throw unauthenticated();
    if (!profile.isActive || verification.status === 'banned') throw accountDisabled();

    req.auth = {
      profileId: profile.profileId,
      authUserId: profile.authUserId,
      hospitalId: profile.hospitalId,
      role: profile.role,
      scope: profile.scope,
      mustChangePassword: profile.mustChangePassword,
      tokenIssuedAt: verification.issuedAt,
    };
    next();
  };
}

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
