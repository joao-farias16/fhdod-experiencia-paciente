import { isAuthApiError, isAuthRetryableFetchError } from '@supabase/supabase-js';

import { env } from '../../lib/env';
import { AUTH_STORAGE_KEY, getSupabase } from '../../lib/supabase';

export type SignInFailure = 'invalid_credentials' | 'rate_limited' | 'network' | 'unavailable';

export type SignInResult = { ok: true; accessToken: string } | { ok: false; reason: SignInFailure };

/**
 * Sessão administrativa no Supabase Auth, isolada atrás desta interface para que as telas sejam
 * testadas sem Supabase. A senha nunca é guardada pela aplicação.
 */
export interface AuthClient {
  /** Access token válido (renovado pelo supabase-js quando necessário) ou null. */
  getAccessToken(): Promise<string | null>;
  signIn(email: string, password: string): Promise<SignInResult>;
  /** Encerra a sessão: revoga o token de renovação (signOut) e apaga os dados locais (RF02). */
  signOut(): Promise<void>;
  onSessionChange(listener: (accessToken: string | null) => void): () => void;
}

/** Remove qualquer resto da sessão do armazenamento do navegador. */
function purgeStoredSession(): void {
  try {
    for (const key of Object.keys(window.sessionStorage)) {
      if (key.startsWith(AUTH_STORAGE_KEY)) window.sessionStorage.removeItem(key);
    }
  } catch {
    // Armazenamento indisponível (modo privado): nada a limpar.
  }
}

export function createSupabaseAuthClient(): AuthClient {
  return {
    async getAccessToken() {
      const { data } = await getSupabase().auth.getSession();
      return data.session?.access_token ?? null;
    },
    async signIn(email, password) {
      if (env.supabaseUrl === '' || env.supabasePublishableKey === '') {
        return { ok: false, reason: 'unavailable' };
      }
      try {
        const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
        if (error === null) return { ok: true, accessToken: data.session.access_token };
        if (isAuthRetryableFetchError(error)) return { ok: false, reason: 'network' };
        if (isAuthApiError(error) && error.status === 429)
          return { ok: false, reason: 'rate_limited' };
        // Qualquer outra recusa (senha errada, e-mail inexistente, conta bloqueada) é genérica.
        return { ok: false, reason: 'invalid_credentials' };
      } catch {
        return { ok: false, reason: 'network' };
      }
    },
    async signOut() {
      try {
        await getSupabase().auth.signOut({ scope: 'local' });
      } catch {
        // Sem rede, a revogação no servidor falha; a sessão local é apagada mesmo assim.
      } finally {
        purgeStoredSession();
      }
    },
    onSessionChange(listener) {
      const { data } = getSupabase().auth.onAuthStateChange((_event, session) => {
        listener(session?.access_token ?? null);
      });
      return () => {
        data.subscription.unsubscribe();
      };
    },
  };
}
