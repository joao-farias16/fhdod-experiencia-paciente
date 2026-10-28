import { render } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { vi } from 'vitest';

import { App } from '../app/App';
import { createQueryClient } from '../app/query-client';
import { routes } from '../app/routes';
import type { AuthClient, SignInResult } from '../features/auth/auth-client';
import type { Me } from '../features/auth/auth-types';

// A área administrativa é carregada sob demanda pelas rotas; pré-carregá-la evita que o primeiro
// teste de cada arquivo dependa do tempo de transformação do módulo.
await import('../features/admin/admin-area');

/** Cliente de autenticação falso: contas em memória, sem Supabase. */
export class FakeAuthClient implements AuthClient {
  token: string | null = null;
  signOutCalls = 0;
  readonly signInCalls: { email: string; password: string }[] = [];
  private readonly accounts = new Map<string, { password: string; token: string }>();
  private listeners = new Set<(token: string | null) => void>();

  addAccount(email: string, password: string, token: string): this {
    this.accounts.set(email, { password, token });
    return this;
  }

  getAccessToken() {
    return Promise.resolve(this.token);
  }

  signIn(email: string, password: string): Promise<SignInResult> {
    this.signInCalls.push({ email, password });
    const account = this.accounts.get(email);
    if (account?.password !== password)
      return Promise.resolve({ ok: false, reason: 'invalid_credentials' });
    this.token = account.token;
    return Promise.resolve({ ok: true, accessToken: account.token });
  }

  signOut() {
    this.signOutCalls += 1;
    this.token = null;
    return Promise.resolve();
  }

  onSessionChange(listener: (token: string | null) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Simula sessão expirada/encerrada (evento do supabase-js). */
  expire(): void {
    this.token = null;
    for (const listener of this.listeners) listener(null);
  }
}

export const ALL_PERMISSIONS_SA = [
  'profile:read',
  'profile:change_password',
  'users:read',
  'users:create',
  'users:update',
  'users:reset_password',
  'sectors:read',
  'teams:read',
  'dashboard:read',
  'audit_logs:read',
];

export function meOf(overrides: Partial<Me> = {}): Me {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    fullName: 'Superadministrador Fictício',
    email: 'superadmin@example.com',
    role: 'superadmin',
    allSectors: true,
    sectors: [],
    mustChangePassword: false,
    permissions: ALL_PERMISSIONS_SA,
    ...overrides,
  };
}

export const VIEWER: Me = meOf({
  id: '22222222-2222-4222-8222-222222222222',
  fullName: 'Visualizador Fictício',
  email: 'visualizador@example.com',
  role: 'viewer',
  allSectors: false,
  sectors: [{ id: 'setor-a', code: 'PA', name: 'Pronto Atendimento', isActive: true }],
  permissions: [
    'profile:read',
    'profile:change_password',
    'sectors:read',
    'teams:read',
    'dashboard:read',
  ],
});

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function apiError(
  status: number,
  code: string,
  message = 'Erro.',
  details: unknown[] = [],
): Response {
  return json(
    { error: { code, message, details, requestId: '9f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' } },
    status,
  );
}

export interface ApiCall {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  authorization: string | null;
  idempotencyKey: string | null;
}

type Handler = (call: ApiCall) => Response | Promise<Response>;

/**
 * Simula a API: cada rota "MÉTODO /caminho" (sem query) tem um handler. Chamadas não previstas
 * falham o teste com 500. Registra todas as chamadas para as verificações.
 */
export function mockApi(handlers: Record<string, Handler>) {
  const calls: ApiCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, 'http://localhost');
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const call: ApiCall = {
      method,
      path,
      query: url.searchParams,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      authorization: headers.get('Authorization'),
      idempotencyKey: headers.get('Idempotency-Key'),
    };
    calls.push(call);
    const handler = handlers[`${method} ${path}`];
    if (handler === undefined)
      return apiError(500, 'INTERNAL_ERROR', `Rota não simulada: ${method} ${path}`);
    return handler(call);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export function renderApp(path: string, authClient: AuthClient) {
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(<App router={router} queryClient={queryClient} authClient={authClient} />);
  return { ...view, router, queryClient };
}
