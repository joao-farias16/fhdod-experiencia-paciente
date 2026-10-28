import type { ManifestationType } from './public-survey-api';

/** RF41: descrição de 10 a 2.000 caracteres. */
export const DESCRIPTION_MIN = 10;
export const DESCRIPTION_MAX = 2000;

export const TYPES: { value: ManifestationType; label: string }[] = [
  { value: 'complaint', label: 'Reclamação' },
  { value: 'suggestion', label: 'Sugestão' },
  { value: 'compliment', label: 'Elogio' },
];

export interface ManifestationValues {
  type: ManifestationType | null;
  description: string;
  identify: boolean;
  fullName: string;
  phone: string;
  email: string;
  consent: boolean;
}

export type ManifestationErrors = Partial<Record<keyof ManifestationValues, string>>;

export const digits = (value: string) => value.replace(/\D/g, '');

/** Validação igual à do backend (E03), com mensagens que dizem o que fazer (RNF02). */
export function validateManifestation(values: ManifestationValues): ManifestationErrors {
  const errors: ManifestationErrors = {};
  if (values.type === null) errors.type = 'Escolha o tipo da manifestação.';
  const description = values.description.trim();
  if (description.length < DESCRIPTION_MIN) {
    errors.description = `Escreva pelo menos ${DESCRIPTION_MIN} caracteres.`;
  } else if (description.length > DESCRIPTION_MAX) {
    errors.description = 'Use no máximo 2.000 caracteres.';
  }
  if (values.identify) {
    if (values.fullName.trim() === '') errors.fullName = 'Informe seu nome.';
    const phone = digits(values.phone);
    const email = values.email.trim();
    if (phone === '' && email === '') errors.email = 'Informe um telefone ou um e-mail.';
    if (phone !== '' && !/^\d{10,11}$/.test(phone)) {
      errors.phone = 'Informe o telefone com DDD (10 ou 11 dígitos).';
    }
    if (email !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      errors.email = 'Informe um e-mail válido.';
    }
    if (!values.consent) errors.consent = 'Marque o aceite para informar seu contato.';
  }
  return errors;
}
