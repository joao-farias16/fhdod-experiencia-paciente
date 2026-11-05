/** Erros da API (Tabela 18) e reconhecimento de violações de restrição do PostgreSQL. */
import { Prisma } from '../lib/prisma.js';

/** Detalhe de validação por campo, conforme o padrão de erros da Seção 9. */
export interface ErrorDetail {
  field: string;
  message: string;
}

/** Erro de aplicação com código estável e status HTTP (Tabela 18). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Token ausente, inválido ou expirado, ou perfil inexistente (401). */
export function unauthenticated(
  message = 'Sua sessão é inválida ou expirou. Entre novamente.',
): HttpError {
  return new HttpError(401, 'UNAUTHENTICATED', message);
}

/** Banco ou Supabase Auth indisponível (503, Tabela 18). */
export function serviceUnavailable(): HttpError {
  return new HttpError(503, 'SERVICE_UNAVAILABLE', 'O serviço está temporariamente indisponível.');
}

/**
 * Negativa de autorização (403 FORBIDDEN ou SECTOR_OUT_OF_SCOPE). É auditada como
 * AUTHORIZATION_DENIED uma única vez pelo middleware auditAuthorizationDenials (Seção 6).
 */
export class AuthorizationDeniedError extends HttpError {
  audited = false;

  constructor(
    code: 'FORBIDDEN' | 'SECTOR_OUT_OF_SCOPE',
    message: string,
    readonly permission?: string,
  ) {
    super(403, code, message);
    this.name = 'AuthorizationDeniedError';
  }
}

/**
 * Reconhecimento de violações de restrição do PostgreSQL vindas do Prisma. As verificações dos
 * serviços acontecem antes da escrita; estas funções cobrem a corrida entre duas requisições, em
 * que só a restrição do banco decide (RNF18).
 */

/** Texto do erro e da causa do adaptador, onde o PostgreSQL informa o nome da restrição. */
function errorText(error: unknown): string {
  if (!(error instanceof Error)) return '';
  const meta =
    error instanceof Prisma.PrismaClientKnownRequestError ? JSON.stringify(error.meta ?? {}) : '';
  return `${error.message} ${meta}`;
}

/** UNIQUE violada (P2002); com `constraint`, somente se a restrição citada for a informada. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  return constraint === undefined || errorText(error).includes(constraint);
}

/** Restrição, gatilho ou EXCLUDE com o nome informado rejeitou a operação. */
export function isConstraintViolation(error: unknown, constraint: string): boolean {
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientUnknownRequestError) &&
    errorText(error).includes(constraint)
  );
}
