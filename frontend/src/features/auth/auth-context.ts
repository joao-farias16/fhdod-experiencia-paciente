import { createContext, useContext } from 'react';

import type { ApiEnvelope, ApiRequestInit, DownloadedFile } from '../../lib/api-client';
import type { AuthClient } from './auth-client';
import type { Me } from './auth-types';

export type AuthState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  /** `explicit`: o usuário clicou em Sair (a próxima pessoa não volta à tela anterior). */
  | { status: 'signedOut'; notice?: string | undefined; explicit?: boolean }
  | { status: 'signedIn'; me: Me };

export interface AuthContextValue {
  state: AuthState;
  /** Login (RF01). Devolve o perfil ou a mensagem genérica de falha. */
  signIn: (
    email: string,
    password: string,
  ) => Promise<{ ok: true; me: Me } | { ok: false; message: string }>;
  /** Logout (RF02): signOut, limpeza do cache em memória e volta ao estado sem sessão. */
  signOut: (notice?: string) => Promise<void>;
  /** Troca da própria senha (E05) seguida de novo login com a senha nova. */
  changePassword: (newPassword: string) => Promise<void>;
  /** Recarrega o perfil (E04). */
  reload: () => Promise<void>;
  /** Requisição autenticada à API (token no cabeçalho; 401/403 de conta tratados aqui). */
  request: <T, M = undefined>(
    path: string,
    init?: Omit<ApiRequestInit, 'token'>,
  ) => Promise<ApiEnvelope<T, M>>;
  /** Download autenticado de arquivo (E34), com o mesmo tratamento de sessão de `request`. */
  download: (path: string, fallbackName: string) => Promise<DownloadedFile>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/** Permite injetar um cliente de autenticação falso nos testes. */
export const AuthClientContext = createContext<AuthClient | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) throw new Error('useAuth deve ser usado dentro de AuthProvider.');
  return value;
}

/** Perfil do usuário autenticado (somente dentro das rotas protegidas). */
export function useMe(): Me {
  const { state } = useAuth();
  if (state.status !== 'signedIn') throw new Error('useMe exige sessão ativa.');
  return state.me;
}
