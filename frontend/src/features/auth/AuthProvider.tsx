import { useQueryClient } from '@tanstack/react-query';
import {
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { ApiError, type ApiRequestInit, apiRequest } from '../../lib/api-client';
import { type AuthClient, createSupabaseAuthClient } from './auth-client';
import {
  AuthClientContext,
  type AuthContextValue,
  AuthContext,
  type AuthState,
} from './auth-context';
import type { Me } from './auth-types';

/** Mensagem única para qualquer falha de login: não revela se o e-mail existe (RF01). */
export const GENERIC_LOGIN_ERROR =
  'E-mail ou senha incorretos. Confira os dados e tente novamente.';

const SIGN_IN_MESSAGES = {
  invalid_credentials: GENERIC_LOGIN_ERROR,
  rate_limited: 'Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.',
  network: 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.',
  unavailable: 'O acesso administrativo não está configurado neste ambiente.',
} as const;

const SESSION_EXPIRED = 'Sua sessão terminou. Entre novamente para continuar.';
const ACCOUNT_DISABLED = 'Sua conta está desativada. Procure o superadministrador.';

async function fetchMe(token: string): Promise<Me> {
  const { data } = await apiRequest<Me>('/me', { token });
  return data;
}

/**
 * Estado da sessão administrativa (Seção 6, fluxo de acesso): login no Supabase Auth, perfil e
 * permissões pelo E04, troca de senha pendente, logout com limpeza dos dados em memória.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const injected = useContext(AuthClientContext);
  const client = useMemo<AuthClient>(() => injected ?? createSupabaseAuthClient(), [injected]);
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const signOut = useCallback(
    async (notice?: string) => {
      try {
        await client.signOut();
      } finally {
        // RF02: nenhum dado administrativo permanece em memória após sair.
        queryClient.clear();
        // Sem aviso = Sair explícito; com aviso = sessão expirada ou conta desativada.
        setState({ status: 'signedOut', notice, explicit: notice === undefined });
      }
    },
    [client, queryClient],
  );

  /** Converte a sessão guardada pelo Supabase (token ou nada) em perfil carregado pelo E04. */
  const resolveSession = useCallback(
    async (token: string | null) => {
      if (token === null) {
        setState({ status: 'signedOut' });
        return;
      }
      try {
        setState({ status: 'signedIn', me: await fetchMe(token) });
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          await signOut(error.code === 'ACCOUNT_DISABLED' ? ACCOUNT_DISABLED : SESSION_EXPIRED);
          return;
        }
        setState({ status: 'error', message: 'Não foi possível verificar sua sessão.' });
      }
    },
    [signOut],
  );

  const sessionUnavailable = useCallback(() => {
    setState({ status: 'error', message: 'Não foi possível verificar sua sessão.' });
  }, []);

  useEffect(() => {
    // O estado inicial já é "loading"; os setState ocorrem só depois da leitura assíncrona.
    void client.getAccessToken().then(resolveSession, sessionUnavailable);
    return client.onSessionChange((token) => {
      // Sessão expirada ou encerrada em outra aba: volta ao login sem dados em memória.
      if (token === null && stateRef.current.status === 'signedIn') {
        queryClient.clear();
        setState({ status: 'signedOut', notice: SESSION_EXPIRED });
      }
    });
  }, [client, resolveSession, sessionUnavailable, queryClient]);

  const request = useCallback(
    async <T, M = undefined>(path: string, init: Omit<ApiRequestInit, 'token'> = {}) => {
      const token = await client.getAccessToken();
      if (token === null) {
        await signOut(SESSION_EXPIRED);
        throw new ApiError(401, 'UNAUTHENTICATED', SESSION_EXPIRED);
      }
      try {
        return await apiRequest<T, M>(path, { ...init, token });
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.status === 401) await signOut(SESSION_EXPIRED);
          else if (error.code === 'ACCOUNT_DISABLED') await signOut(ACCOUNT_DISABLED);
          else if (error.code === 'PASSWORD_CHANGE_REQUIRED') {
            const me = stateRef.current.status === 'signedIn' ? stateRef.current.me : null;
            if (me !== null)
              setState({ status: 'signedIn', me: { ...me, mustChangePassword: true } });
          }
        }
        throw error;
      }
    },
    [client, signOut],
  );

  const signIn = useCallback<AuthContextValue['signIn']>(
    async (email, password) => {
      const result = await client.signIn(email.trim(), password);
      if (!result.ok) return { ok: false, message: SIGN_IN_MESSAGES[result.reason] };
      try {
        const me = await fetchMe(result.accessToken);
        queryClient.clear();
        setState({ status: 'signedIn', me });
        return { ok: true, me };
      } catch (error) {
        await client.signOut();
        // Conta sem perfil ou desativada: mesma mensagem genérica do login inválido.
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          return { ok: false, message: GENERIC_LOGIN_ERROR };
        }
        return { ok: false, message: SIGN_IN_MESSAGES.network };
      }
    },
    [client, queryClient],
  );

  const changePassword = useCallback<AuthContextValue['changePassword']>(
    async (newPassword) => {
      const current = stateRef.current;
      if (current.status !== 'signedIn')
        throw new ApiError(401, 'UNAUTHENTICATED', SESSION_EXPIRED);
      await request('/me/password', { method: 'POST', body: { newPassword } });
      // A troca revoga os tokens de renovação no Supabase: entra de novo com a senha nova.
      const again = await client.signIn(current.me.email, newPassword);
      if (!again.ok) {
        await signOut('Senha alterada. Entre novamente com a nova senha.');
        return;
      }
      setState({ status: 'signedIn', me: await fetchMe(again.accessToken) });
    },
    [client, request, signOut],
  );

  const reload = useCallback(async () => {
    setState({ status: 'loading' });
    await client.getAccessToken().then(resolveSession, sessionUnavailable);
  }, [client, resolveSession, sessionUnavailable]);

  const value = useMemo<AuthContextValue>(
    () => ({ state, signIn, signOut, changePassword, reload, request }),
    [state, signIn, signOut, changePassword, reload, request],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
