import type { ErrorRequestHandler } from 'express';

import { Prisma } from '../lib/prisma.js';
import { AuthServiceUnavailableError } from '../modules/auth/auth.types.js';
import { HttpError } from '../utils/http-error.js';

/** Códigos do Prisma para banco inacessível, tempo esgotado ou conexão encerrada. */
const PRISMA_UNAVAILABLE_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024']);

function serviceUnavailable(): HttpError {
  return new HttpError(503, 'SERVICE_UNAVAILABLE', 'O serviço está temporariamente indisponível.');
}

/** Converte erros conhecidos (inclusive os do body-parser do Express) para o padrão da API. */
function normalizeError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  // Tabela 18: SERVICE_UNAVAILABLE quando o banco ou o Supabase Auth não respondem.
  if (error instanceof AuthServiceUnavailableError) return serviceUnavailable();
  if (error instanceof Prisma.PrismaClientInitializationError) return serviceUnavailable();
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    PRISMA_UNAVAILABLE_CODES.has(error.code)
  ) {
    return serviceUnavailable();
  }

  const type =
    typeof error === 'object' && error !== null && 'type' in error ? error.type : undefined;
  switch (type) {
    case 'entity.parse.failed':
      return new HttpError(400, 'MALFORMED_JSON', 'O corpo da requisição não é um JSON válido.');
    case 'entity.too.large':
      return new HttpError(413, 'PAYLOAD_TOO_LARGE', 'O corpo da requisição excede o limite.');
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Codificação não suportada.');
    default:
      return new HttpError(500, 'INTERNAL_ERROR', 'Ocorreu um erro inesperado. Tente novamente.');
  }
}

/**
 * Tratamento centralizado de erros (RNF19): resposta { error: { code, message, details,
 * requestId } } e nenhum stack trace enviado ao cliente.
 */
export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const httpError = normalizeError(error);
  if (httpError.status >= 500) {
    req.log.error({ err: error }, 'Erro não tratado');
  }

  res.status(httpError.status).json({
    error: {
      code: httpError.code,
      message: httpError.message,
      details: httpError.details,
      requestId: typeof req.id === 'string' ? req.id : '',
    },
  });
};
