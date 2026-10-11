import { describe, expect, it } from 'vitest';

import { formatDateTime } from './format';

describe('formatDateTime (RNF29)', () => {
  it('converte o instante UTC para dd/mm/aaaa hh:mm em America/Sao_Paulo', () => {
    expect(formatDateTime('2026-10-10T17:25:03.120Z')).toBe('10/10/2026 14:25');
  });

  it('muda o dia quando o horário local ainda é o dia anterior', () => {
    expect(formatDateTime('2026-01-01T02:30:00Z')).toBe('31/12/2025 23:30');
  });

  it('usa 00 para a meia-noite', () => {
    expect(formatDateTime('2026-03-15T03:00:00Z')).toBe('15/03/2026 00:00');
  });

  it('rejeita instante inválido', () => {
    expect(() => formatDateTime('não é data')).toThrow(RangeError);
  });
});
