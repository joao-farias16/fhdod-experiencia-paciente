/**
 * Integração com o Supabase Auth (src/lib/supabase.ts) com o cliente supabase-js simulado:
 * mapeamento das respostas de auth.getUser e das operações administrativas para os resultados
 * usados pelo backend (válido, bloqueado, inválido, e-mail repetido, senha fraca, indisponível).
 */
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
} from '@supabase/supabase-js';
import type * as SupabaseModule from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.fn();
const createUser = vi.fn();
const deleteUser = vi.fn();
const updateUserById = vi.fn();

vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const original = await importOriginal<typeof SupabaseModule>();
  return {
    ...original,
    createClient: vi.fn(() => ({
      auth: { getUser, admin: { createUser, deleteUser, updateUserById } },
    })),
  };
});

const { createClient } = await import('@supabase/supabase-js');
const { BAN_DURATION, createSupabaseAuth, isWellFormedJwt, readVerifiedClaims } =
  await import('../../src/lib/supabase.js');
const { AuthEmailAlreadyRegisteredError, AuthServiceUnavailableError, AuthWeakPasswordError } =
  await import('../../src/modules/auth/auth.types.js');

const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const SUB = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const IAT = 1_790_000_000;
const TOKEN = `${encode({ alg: 'ES256' })}.${encode({ sub: SUB, iat: IAT })}.c2lnbmF0dXJl`;

const apiError = (status: number, code?: string) => new AuthApiError('erro', status, code);

let auth: ReturnType<typeof createSupabaseAuth>;

beforeEach(() => {
  vi.clearAllMocks();
  auth = createSupabaseAuth({
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SECRET_KEY: 'chave-ficticia',
  });
});

describe('formato do token', () => {
  it('aceita somente JWT compacto de três segmentos base64url', () => {
    expect(isWellFormedJwt(TOKEN)).toBe(true);
    for (const token of ['', 'abc', 'a.b', 'a.b.c.d', 'a.b.c d', `a.${'b'.repeat(9000)}.c`]) {
      expect(isWellFormedJwt(token)).toBe(false);
    }
  });

  it('lê sub e iat do conteúdo; conteúdo ilegível → vazio', () => {
    expect(readVerifiedClaims(TOKEN)).toEqual({ sub: SUB, issuedAt: new Date(IAT * 1000) });
    expect(readVerifiedClaims('a.bm9wZQ.c')).toEqual({});
    expect(readVerifiedClaims(`a.${encode({ sub: 1 })}.c`)).toEqual({});
  });
});

describe('verificador (auth.getUser)', () => {
  it('cria o cliente sem persistir sessão no servidor', () => {
    expect(createClient).toHaveBeenCalledWith('http://127.0.0.1:54321', 'chave-ficticia', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  });

  it('token válido → valid com a emissão', async () => {
    getUser.mockResolvedValue({ data: { user: { id: SUB } }, error: null });
    await expect(auth.verifier.verify(TOKEN)).resolves.toEqual({
      status: 'valid',
      authUserId: SUB,
      issuedAt: new Date(IAT * 1000),
    });
    expect(getUser).toHaveBeenCalledWith(TOKEN);
  });

  it('token malformado não chega ao Supabase', async () => {
    await expect(auth.verifier.verify('malformado')).resolves.toEqual({ status: 'invalid' });
    expect(getUser).not.toHaveBeenCalled();
  });

  it.each([
    [403, 'bad_jwt'],
    [403, 'user_not_found'],
    [400, undefined],
    [401, 'session_not_found'],
  ])('erro %i %s → invalid', async (status, code) => {
    getUser.mockResolvedValue({ data: { user: null }, error: apiError(status, code) });
    await expect(auth.verifier.verify(TOKEN)).resolves.toEqual({ status: 'invalid' });
  });

  it('sessão encerrada por signOut (AuthSessionMissingError) → invalid', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() });
    await expect(auth.verifier.verify(TOKEN)).resolves.toEqual({ status: 'invalid' });
  });

  it('user_banned → banned com o sub do token já validado', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: apiError(403, 'user_banned') });
    await expect(auth.verifier.verify(TOKEN)).resolves.toEqual({
      status: 'banned',
      authUserId: SUB,
    });
  });

  it('falha de rede, 5xx ou exceção → AuthServiceUnavailableError', async () => {
    getUser.mockResolvedValueOnce({
      data: { user: null },
      error: new AuthRetryableFetchError('rede', 0),
    });
    await expect(auth.verifier.verify(TOKEN)).rejects.toBeInstanceOf(AuthServiceUnavailableError);
    getUser.mockResolvedValueOnce({ data: { user: null }, error: apiError(500) });
    await expect(auth.verifier.verify(TOKEN)).rejects.toBeInstanceOf(AuthServiceUnavailableError);
    getUser.mockRejectedValueOnce(new Error('exceção'));
    await expect(auth.verifier.verify(TOKEN)).rejects.toBeInstanceOf(AuthServiceUnavailableError);
  });
});

describe('operações administrativas', () => {
  it('createUser confirma o e-mail e devolve o id; e-mail repetido → erro específico', async () => {
    createUser.mockResolvedValueOnce({ data: { user: { id: SUB } }, error: null });
    await expect(
      auth.admin.createUser({ email: 'a@example.com', password: 'Senha12345' }),
    ).resolves.toEqual({ authUserId: SUB });
    expect(createUser).toHaveBeenCalledWith({
      email: 'a@example.com',
      password: 'Senha12345',
      email_confirm: true,
    });

    createUser.mockResolvedValueOnce({
      data: { user: null },
      error: apiError(422, 'email_exists'),
    });
    await expect(
      auth.admin.createUser({ email: 'a@example.com', password: 'x' }),
    ).rejects.toBeInstanceOf(AuthEmailAlreadyRegisteredError);

    createUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(
      auth.admin.createUser({ email: 'a@example.com', password: 'x' }),
    ).rejects.toBeInstanceOf(AuthServiceUnavailableError);
  });

  it('updatePassword: senha fraca → AuthWeakPasswordError; outra falha → indisponível', async () => {
    updateUserById.mockResolvedValueOnce({ data: {}, error: null });
    await expect(auth.admin.updatePassword(SUB, 'Senha12345')).resolves.toBeUndefined();
    expect(updateUserById).toHaveBeenCalledWith(SUB, { password: 'Senha12345' });

    updateUserById.mockResolvedValueOnce({ data: {}, error: apiError(422, 'weak_password') });
    await expect(auth.admin.updatePassword(SUB, 'fraca')).rejects.toBeInstanceOf(
      AuthWeakPasswordError,
    );

    updateUserById.mockRejectedValueOnce(new Error('rede'));
    await expect(auth.admin.updatePassword(SUB, 'x')).rejects.toBeInstanceOf(
      AuthServiceUnavailableError,
    );
  });

  it('setBanned usa ban_duration (bloqueio longo e "none" na reativação)', async () => {
    updateUserById.mockResolvedValue({ data: {}, error: null });
    await auth.admin.setBanned(SUB, true);
    await auth.admin.setBanned(SUB, false);
    expect(updateUserById).toHaveBeenNthCalledWith(1, SUB, { ban_duration: BAN_DURATION });
    expect(updateUserById).toHaveBeenNthCalledWith(2, SUB, { ban_duration: 'none' });
  });

  it('deleteUser propaga indisponibilidade', async () => {
    deleteUser.mockResolvedValueOnce({ data: {}, error: null });
    await expect(auth.admin.deleteUser(SUB)).resolves.toBeUndefined();
    deleteUser.mockResolvedValueOnce({ data: {}, error: apiError(500) });
    await expect(auth.admin.deleteUser(SUB)).rejects.toBeInstanceOf(AuthServiceUnavailableError);
  });
});
