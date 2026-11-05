/** Erros da API (Tabela 18) e reconhecimento de violações de restrição do MySQL. */
import { isMysqlError } from '../lib/database.js';

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

/** Banco de dados indisponível (503, Tabela 18). */
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
 * Reconhecimento de violações de restrição do MySQL. As verificações dos serviços acontecem antes
 * da escrita; estas funções cobrem a corrida entre duas requisições, em que só a restrição do
 * banco decide (RNF18). O MySQL informa o nome da regra na mensagem:
 * - 1062 ER_DUP_ENTRY: "Duplicate entry '...' for key 'tabela.nome_da_chave'";
 * - 3819 ER_CHECK_CONSTRAINT_VIOLATED: "Check constraint 'nome' is violated.";
 * - 1451/1452 (chave estrangeira): "... CONSTRAINT `nome` FOREIGN KEY ...";
 * - 1644 (SIGNAL dos gatilhos de database/migrations/005): "[nome] mensagem".
 */

/** Texto do erro do MySQL, onde aparece o nome da restrição ou do gatilho. */
function errorText(error: unknown): string {
  if (!isMysqlError(error)) return '';
  return `${error.sqlMessage ?? ''} ${error.message}`;
}

/** UNIQUE violada (1062); com `constraint`, somente se a chave citada for a informada. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (!isMysqlError(error) || error.errno !== 1062) return false;
  return constraint === undefined || errorText(error).includes(constraint);
}

const CONSTRAINT_ERRNOS = new Set([1062, 1451, 1452, 1644, 3819]);

/** Restrição (CHECK, UNIQUE, chave estrangeira) ou gatilho com o nome informado rejeitou a operação. */
export function isConstraintViolation(error: unknown, constraint: string): boolean {
  return (
    isMysqlError(error) &&
    error.errno !== undefined &&
    CONSTRAINT_ERRNOS.has(error.errno) &&
    errorText(error).includes(constraint)
  );
}
