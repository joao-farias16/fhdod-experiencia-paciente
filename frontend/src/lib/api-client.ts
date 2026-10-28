import { env } from './env';

/** Detalhe de validação por campo devolvido pela API. */
export interface ApiErrorDetail {
  field: string;
  message: string;
}

/** Erro devolvido pela API no formato { error: { code, message, details, requestId } }. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly details: ApiErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorEnvelope {
  error: { code: string; message: string; requestId?: string; details?: ApiErrorDetail[] };
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

/** Erro da API a partir do corpo de uma resposta sem sucesso. */
function errorOf(status: number, body: unknown): ApiError {
  if (isErrorEnvelope(body)) {
    return new ApiError(
      status,
      body.error.code,
      body.error.message,
      body.error.requestId,
      body.error.details ?? [],
    );
  }
  return new ApiError(status, 'UNEXPECTED_RESPONSE', 'Resposta inesperada do servidor.');
}

/** Metadados das listas paginadas (Seção 7). */
export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
}

export interface ApiEnvelope<T, M = undefined> {
  data: T;
  meta: M;
}

export interface ApiRequestInit {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Access token do Supabase Auth (rotas administrativas). */
  token?: string | undefined;
  /** JSON (serializado aqui) ou FormData (envio de arquivo, multipart). */
  body?: unknown;
  /** Cabeçalhos adicionais, como Idempotency-Key (E02). */
  headers?: Record<string, string>;
  signal?: AbortSignal | undefined;
}

/**
 * Requisição JSON à API do FHDOD, devolvendo { data, meta } (204 → data indefinido). Falhas de rede
 * e respostas fora do padrão viram ApiError com NETWORK_ERROR ou UNEXPECTED_RESPONSE. O token vai
 * somente no cabeçalho Authorization (sem cookies, Seção 10).
 */
export async function apiRequest<T, M = undefined>(
  path: string,
  init: ApiRequestInit = {},
): Promise<ApiEnvelope<T, M>> {
  const headers: Record<string, string> = { ...init.headers, Accept: 'application/json' };
  if (init.token !== undefined) headers.Authorization = `Bearer ${init.token}`;
  const isForm = init.body instanceof FormData;
  if (init.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${env.apiBaseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers,
      cache: 'no-store',
      ...(init.body === undefined
        ? {}
        : { body: isForm ? (init.body as FormData) : JSON.stringify(init.body) }),
      ...(init.signal ? { signal: init.signal } : {}),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(0, 'NETWORK_ERROR', 'Não foi possível conectar ao servidor.');
  }

  if (response.status === 204) return { data: undefined as T, meta: undefined as M };

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) throw errorOf(response.status, body);
  if (typeof body !== 'object' || body === null || !('data' in body)) {
    throw new ApiError(response.status, 'UNEXPECTED_RESPONSE', 'Resposta inesperada do servidor.');
  }
  return {
    data: body.data as T,
    meta: ('meta' in body ? body.meta : undefined) as M,
  };
}

/** GET público em JSON, devolvendo somente o conteúdo de { data } (rota de saúde, ET01). */
export async function apiGet<T>(path: string, init?: { signal?: AbortSignal }): Promise<T> {
  const { data } = await apiRequest<T>(path, { signal: init?.signal });
  return data;
}

/** Arquivo baixado da API (E34): conteúdo e nome informado em Content-Disposition. */
export interface DownloadedFile {
  blob: Blob;
  fileName: string;
}

function fileNameOf(disposition: string | null, fallback: string): string {
  const match = disposition === null ? null : /filename="([^"]+)"/.exec(disposition);
  return match?.[1] ?? fallback;
}

/**
 * Download autenticado de arquivo (relatórios Excel). Erros chegam como JSON no padrão da API e
 * viram ApiError, como em apiRequest.
 */
export async function apiDownload(
  path: string,
  init: { token: string; signal?: AbortSignal | undefined; fallbackName: string },
): Promise<DownloadedFile> {
  let response: Response;
  try {
    response = await fetch(`${env.apiBaseUrl}${path}`, {
      headers: { Authorization: `Bearer ${init.token}` },
      cache: 'no-store',
      ...(init.signal ? { signal: init.signal } : {}),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(0, 'NETWORK_ERROR', 'Não foi possível conectar ao servidor.');
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw errorOf(response.status, body);
  }
  return {
    blob: await response.blob(),
    fileName: fileNameOf(response.headers.get('Content-Disposition'), init.fallbackName),
  };
}

/** Entrega o arquivo ao navegador como download. */
export function saveFile({ blob, fileName }: DownloadedFile): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
