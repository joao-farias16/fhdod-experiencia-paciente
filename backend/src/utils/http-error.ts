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
