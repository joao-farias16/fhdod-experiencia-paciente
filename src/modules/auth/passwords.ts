/**
 * Hash de senhas com bcrypt (bcryptjs, implementação em JavaScript, sem compilação nativa).
 * A senha nunca é gravada nem registrada: somente o hash fica em profiles.password_hash.
 * O bcrypt considera no máximo 72 bytes; a política de senha (RN28) já limita a 72 caracteres.
 */
import bcrypt from 'bcryptjs';

/** Gera o hash bcrypt da senha com o custo configurado (BCRYPT_ROUNDS). */
export function hashPassword(password: string, rounds: number): Promise<string> {
  return bcrypt.hash(password, rounds);
}

/** Compara a senha com o hash em tempo constante (bcrypt.compare). */
export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Hash fictício usado quando o e-mail não existe: o login gasta o mesmo tempo de um e-mail
 * existente, sem revelar quais contas existem (enumeração por tempo de resposta).
 */
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(rounds: number): Promise<string> {
  dummyHash ??= bcrypt.hash('senha-ficticia-para-equalizar-o-tempo', rounds);
  return dummyHash;
}
