import { env } from './env';

/** Erro devolvido pela API no formato { error: { code, message, details, requestId } }. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorEnvelope {
  error: { code: string; message: string; requestId?: string };
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const { error } = value;
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
  );
}

/**
 * GET em JSON na API do FHDOD, devolvendo o conteúdo de { data }. Falhas de rede e respostas
 * fora do padrão viram ApiError com códigos NETWORK_ERROR ou UNEXPECTED_RESPONSE.
 */
export async function apiGet<T>(path: string, init?: { signal?: AbortSignal }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${env.apiBaseUrl}${path}`, {
      headers: { Accept: 'application/json' },
      ...(init?.signal ? { signal: init.signal } : {}),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(0, 'NETWORK_ERROR', 'Não foi possível conectar ao servidor.');
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    if (isErrorEnvelope(body)) {
      throw new ApiError(
        response.status,
        body.error.code,
        body.error.message,
        body.error.requestId,
      );
    }
    throw new ApiError(response.status, 'UNEXPECTED_RESPONSE', 'Resposta inesperada do servidor.');
  }
  if (typeof body !== 'object' || body === null || !('data' in body)) {
    throw new ApiError(response.status, 'UNEXPECTED_RESPONSE', 'Resposta inesperada do servidor.');
  }
  return body.data as T;
}
