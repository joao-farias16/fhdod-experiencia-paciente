import { randomInt } from 'node:crypto';

import { z } from 'zod';

/** RN28: mínimo de 10 caracteres; E05: máximo de 72 (limite do bcrypt no Supabase Auth). */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 72;
export const TEMPORARY_PASSWORD_LENGTH = 16;

// Letras ASCII, como o requisito `letters_digits` do Supabase Auth (supabase/config.toml).
const HAS_LETTER = /[A-Za-z]/;
const HAS_DIGIT = /[0-9]/;

/**
 * Senha da RN28: 10 a 72 caracteres, com letras e números. As mensagens nunca repetem o valor
 * recebido (a senha não aparece em respostas, logs nem auditoria).
 */
export const passwordSchema = z
  .string({ error: 'Informe a nova senha.' })
  .min(PASSWORD_MIN_LENGTH, `A senha deve ter ao menos ${PASSWORD_MIN_LENGTH} caracteres.`)
  .max(PASSWORD_MAX_LENGTH, `A senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`)
  .refine((value) => HAS_LETTER.test(value), 'A senha deve conter ao menos uma letra.')
  .refine((value) => HAS_DIGIT.test(value), 'A senha deve conter ao menos um número.');

export function isPasswordCompliant(value: string): boolean {
  return passwordSchema.safeParse(value).success;
}

// Sem caracteres ambíguos (0/O, 1/l/I) para facilitar a digitação da senha exibida uma vez.
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const ALPHABET = `${LETTERS}${DIGITS}`;

/**
 * Senha temporária de 16 caracteres gerada por CSPRNG (crypto.randomInt, sem viés de módulo)
 * e sempre aderente à RN28 (contém letras e números). RF03/RF06.
 */
export function generateTemporaryPassword(): string {
  for (;;) {
    let password = '';
    for (let index = 0; index < TEMPORARY_PASSWORD_LENGTH; index += 1) {
      password += ALPHABET.charAt(randomInt(ALPHABET.length));
    }
    if (isPasswordCompliant(password)) return password;
  }
}
