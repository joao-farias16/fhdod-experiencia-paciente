import type { RequestHandler } from 'express';

import { type AuthProfileReader, findAuthProfile } from '../modules/auth/auth.repository.js';
import type { TokenVerifier } from '../modules/auth/auth.types.js';
import { HttpError } from '../utils/http-error.js';

export interface AuthenticateDeps {
  verifier: TokenVerifier;
  prisma: AuthProfileReader;
}

const BEARER = /^Bearer ([^\s]+)$/i;

export function unauthenticated(): HttpError {
  return new HttpError(
    401,
    'UNAUTHENTICATED',
    'Sua sessão é inválida ou expirou. Entre novamente.',
  );
}

export function accountDisabled(): HttpError {
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
