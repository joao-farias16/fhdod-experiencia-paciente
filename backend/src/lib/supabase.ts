import {
  type AuthError,
  createClient,
  isAuthApiError,
  isAuthSessionMissingError,
} from '@supabase/supabase-js';

import type { Env } from '../config/env.js';
import {
  type AuthAdmin,
  AuthEmailAlreadyRegisteredError,
  AuthServiceUnavailableError,
  AuthWeakPasswordError,
  type TokenVerification,
  type TokenVerifier,
} from '../modules/auth/auth.types.js';

/** Duração do bloqueio na desativação (RF09): 100 anos, revertida com 'none' na reativação. */
export const BAN_DURATION = '876000h';

/** JWT compacto: três segmentos base64url (cabeçalho, conteúdo e assinatura). */
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MAX_TOKEN_LENGTH = 8_192;

/** Indica se o texto tem o formato de um JWT; tokens malformados nem chegam ao Supabase. */
export function isWellFormedJwt(token: string): boolean {
  return token.length <= MAX_TOKEN_LENGTH && JWT_PATTERN.test(token);
}

/**
 * Lê `sub` e `iat` do JWT sem verificar a assinatura. Usado SOMENTE depois que o Supabase Auth já
 * validou o token: para ler a emissão de um token aceito e, na resposta `user_banned` (o bloqueio
 * só é avaliado após a verificação da assinatura), para identificar o perfil desativado e
 * responder 403 ACCOUNT_DISABLED.
 */
export function readVerifiedClaims(token: string): { sub?: string; issuedAt?: Date } {
  const payload = token.split('.')[1];
  if (payload === undefined) return {};
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof claims !== 'object' || claims === null) return {};
    const sub = 'sub' in claims && typeof claims.sub === 'string' ? claims.sub : undefined;
    const iat = 'iat' in claims && typeof claims.iat === 'number' ? claims.iat : undefined;
    return {
      ...(sub === undefined ? {} : { sub }),
      ...(iat === undefined ? {} : { issuedAt: new Date(iat * 1000) }),
    };
  } catch {
    return {};
  }
}

function isApiErrorWith(error: AuthError | null, code: string): boolean {
  return error !== null && isAuthApiError(error) && error.code === code;
}

/**
 * Erro "definitivo" do Auth (4xx): o token ou a operação foi recusado, não houve falha técnica.
 * Sessão encerrada por signOut chega como AuthSessionMissingError (session_not_found no GoTrue).
 */
function isClientError(error: AuthError): boolean {
  if (isAuthSessionMissingError(error)) return true;
  return isAuthApiError(error) && error.status >= 400 && error.status < 500;
}

type SupabaseEnv = Pick<Env, 'SUPABASE_URL' | 'SUPABASE_SECRET_KEY'>;

/**
 * Integração com o Supabase Auth pelo cliente oficial (supabase-js), com a chave secreta que
 * existe apenas no backend. Nenhuma sessão é persistida no servidor.
 */
export function createSupabaseAuth(env: SupabaseEnv): {
  verifier: TokenVerifier;
  admin: AuthAdmin;
} {
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const verifier: TokenVerifier = {
    async verify(accessToken): Promise<TokenVerification> {
      if (!isWellFormedJwt(accessToken)) return { status: 'invalid' };
      let result: Awaited<ReturnType<typeof client.auth.getUser>>;
      try {
        result = await client.auth.getUser(accessToken);
      } catch {
        throw new AuthServiceUnavailableError('getUser');
      }
      const { data, error } = result;
      if (error === null) {
        return {
          status: 'valid',
          authUserId: data.user.id,
          issuedAt: readVerifiedClaims(accessToken).issuedAt,
        };
      }
      if (isApiErrorWith(error, 'user_banned')) {
        const { sub } = readVerifiedClaims(accessToken);
        return sub === undefined ? { status: 'invalid' } : { status: 'banned', authUserId: sub };
      }
      if (isClientError(error)) return { status: 'invalid' };
      throw new AuthServiceUnavailableError('getUser');
    },
  };

  async function run(operation: string, call: () => Promise<{ error: AuthError | null }>) {
    let error: AuthError | null;
    try {
      ({ error } = await call());
    } catch {
      throw new AuthServiceUnavailableError(operation);
    }
    if (error === null) return;
    if (isApiErrorWith(error, 'weak_password')) throw new AuthWeakPasswordError();
    if (isApiErrorWith(error, 'email_exists')) throw new AuthEmailAlreadyRegisteredError();
    throw new AuthServiceUnavailableError(operation);
  }

  const admin: AuthAdmin = {
    async createUser({ email, password }) {
      let authUserId: string | undefined;
      await run('createUser', async () => {
        const { data, error } = await client.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        authUserId = data.user?.id;
        return { error };
      });
      if (authUserId === undefined) throw new AuthServiceUnavailableError('createUser');
      return { authUserId };
    },
    async deleteUser(authUserId) {
      await run('deleteUser', () => client.auth.admin.deleteUser(authUserId));
    },
    async updatePassword(authUserId, password) {
      await run('updatePassword', () => client.auth.admin.updateUserById(authUserId, { password }));
    },
    async setBanned(authUserId, banned) {
      await run('setBanned', () =>
        client.auth.admin.updateUserById(authUserId, {
          ban_duration: banned ? BAN_DURATION : 'none',
        }),
      );
    },
  };

  return { verifier, admin };
}
