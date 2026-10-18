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
