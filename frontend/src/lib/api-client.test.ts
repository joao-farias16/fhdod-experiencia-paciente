import { describe, expect, it, vi } from 'vitest';

import { ApiError, apiGet, apiRequest } from './api-client';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('apiGet', () => {
  it('chama a base da API e devolve o conteúdo de data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { status: 'ok' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiGet('/health')).resolves.toEqual({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/health',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });

  it('converte o envelope de erro da API em ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 'RATE_LIMITED',
              message: 'Muitas requisições.',
              details: [],
              requestId: 'c1d6f0c2-4b7e-4f43-9a35-0f1f6a8e2b11',
            },
          },
          429,
        ),
      ),
    );

    await expect(apiGet('/health')).rejects.toMatchObject({
      name: 'ApiError',
      status: 429,
      code: 'RATE_LIMITED',
      requestId: 'c1d6f0c2-4b7e-4f43-9a35-0f1f6a8e2b11',
    });
  });

  it('trata falha de rede como NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const error: unknown = await apiGet('/health').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });

  it('trata resposta sem o envelope esperado como UNEXPECTED_RESPONSE', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 502 })));

    await expect(apiGet('/health')).rejects.toMatchObject({
      status: 502,
      code: 'UNEXPECTED_RESPONSE',
    });
  });

  it('rejeita resposta 200 sem data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ status: 'ok' })));

    await expect(apiGet('/health')).rejects.toMatchObject({ code: 'UNEXPECTED_RESPONSE' });
  });
});

describe('apiRequest (rotas autenticadas)', () => {
  it('envia o token só no cabeçalho Authorization, JSON no corpo e sem cache', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: [1], meta: { page: 1, pageSize: 20, total: 1 } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      apiRequest('/admin/users', { method: 'POST', token: 'abc', body: { a: 1 } }),
    ).resolves.toEqual({
      data: [1],
      meta: { page: 1, pageSize: 20, total: 1 },
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/admin/users', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer abc',
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      body: '{"a":1}',
    });
  });

  it('204 devolve data indefinido; erros trazem os detalhes por campo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(
      apiRequest('/me/password', { method: 'POST', token: 't', body: {} }),
    ).resolves.toEqual({
      data: undefined,
      meta: undefined,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Inválido.',
              details: [{ field: 'email', message: 'Informe.' }],
              requestId: 'r',
            },
          },
          400,
        ),
      ),
    );
    await expect(
      apiRequest('/admin/users', { method: 'POST', token: 't', body: {} }),
    ).rejects.toMatchObject({
      status: 400,
      details: [{ field: 'email', message: 'Informe.' }],
    });
  });
});
