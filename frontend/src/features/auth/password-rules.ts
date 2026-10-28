/** Regras da RN28 exibidas na TL02 (as mesmas aplicadas pelo backend no E05). */
export const PASSWORD_RULES = [
  {
    id: 'length',
    label: 'Ter de 10 a 72 caracteres',
    test: (value: string) => value.length >= 10 && value.length <= 72,
  },
  {
    id: 'letter',
    label: 'Conter ao menos uma letra (A a Z)',
    test: (value: string) => /[A-Za-z]/.test(value),
  },
  { id: 'digit', label: 'Conter ao menos um número', test: (value: string) => /[0-9]/.test(value) },
] as const;

export function isPasswordValid(value: string): boolean {
  return PASSWORD_RULES.every((rule) => rule.test(value));
}
