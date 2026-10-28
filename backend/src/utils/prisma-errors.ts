import { Prisma } from '../lib/prisma.js';

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
