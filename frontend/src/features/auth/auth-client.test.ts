/**
 * Cliente de sessão sobre o supabase-js (simulado): toda recusa de login vira mensagem genérica,
 * exceto limite de tentativas e falha de rede; o logout sempre apaga a sessão guardada (RF02).
 */
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = {
  getSession: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChange: vi.fn(),
};

vi.mock('../../lib/supabase', () => ({
  AUTH_STORAGE_KEY: 'fhdod-admin-auth',
  getSupabase: () => ({ auth }),
}));
vi.mock('../../lib/env', () => ({
  env: { supabaseUrl: 'http://127.0.0.1:54321', supabasePublishableKey: 'sb_publishable_ficticia' },
}));

const { createSupabaseAuthClient } = await import('./auth-client');

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe('createSupabaseAuthClient', () => {
  it('devolve o access token da sessão atual ou null', async () => {
    auth.getSession.mockResolvedValueOnce({ data: { session: { access_token: 'abc' } } });
    auth.getSession.mockResolvedValueOnce({ data: { session: null } });
    const client = createSupabaseAuthClient();
    await expect(client.getAccessToken()).resolves.toBe('abc');
    await expect(client.getAccessToken()).resolves.toBeNull();
  });

  it('login válido devolve o token', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { session: { access_token: 'tok' } },
      error: null,
    });
    await expect(createSupabaseAuthClient().signIn('a@example.com', 'x')).resolves.toEqual({
      ok: true,
      accessToken: 'tok',
    });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@example.com', password: 'x' });
  });

  it.each([
    [
      'senha errada',
      new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'),
      'invalid_credentials',
    ],
    [
      'conta bloqueada',
      new AuthApiError('User is banned', 400, 'user_banned'),
      'invalid_credentials',
    ],
    [
      'muitas tentativas',
      new AuthApiError('Rate limit', 429, 'over_request_rate_limit'),
      'rate_limited',
    ],
    ['rede', new AuthRetryableFetchError('Failed to fetch', 0), 'network'],
  ])('%s → %s', async (_case, error, reason) => {
    auth.signInWithPassword.mockResolvedValue({ data: { session: null }, error });
    await expect(createSupabaseAuthClient().signIn('a@example.com', 'x')).resolves.toEqual({
      ok: false,
      reason,
    });
  });

  it('exceção inesperada no login vira falha de rede', async () => {
    auth.signInWithPassword.mockRejectedValue(new Error('boom'));
    await expect(createSupabaseAuthClient().signIn('a@example.com', 'x')).resolves.toEqual({
      ok: false,
      reason: 'network',
    });
  });

  it('signOut revoga (scope local) e apaga a sessão guardada mesmo se o Supabase falhar', async () => {
    sessionStorage.setItem('fhdod-admin-auth', '{"access_token":"x"}');
    sessionStorage.setItem('fhdod-admin-auth-code-verifier', 'y');
    sessionStorage.setItem('fhdod:outra', 'mantida');
    auth.signOut.mockRejectedValue(new Error('rede'));

    await expect(createSupabaseAuthClient().signOut()).resolves.toBeUndefined();

    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(sessionStorage.getItem('fhdod-admin-auth')).toBeNull();
    expect(sessionStorage.getItem('fhdod-admin-auth-code-verifier')).toBeNull();
    expect(sessionStorage.getItem('fhdod:outra')).toBe('mantida');
  });

  it('repassa mudanças de sessão e permite cancelar a inscrição', () => {
    const unsubscribe = vi.fn();
    let callback: ((event: string, session: { access_token: string } | null) => void) | undefined;
    auth.onAuthStateChange.mockImplementation((cb: typeof callback) => {
      callback = cb;
      return { data: { subscription: { unsubscribe } } };
    });
    const listener = vi.fn();

    const stop = createSupabaseAuthClient().onSessionChange(listener);
    callback?.('TOKEN_REFRESHED', { access_token: 'novo' });
    callback?.('SIGNED_OUT', null);
    stop();

    expect(listener.mock.calls).toEqual([['novo'], [null]]);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
