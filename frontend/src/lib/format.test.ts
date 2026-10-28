import { describe, expect, it } from 'vitest';

import {
  addDays,
  daysInclusive,
  formatDateTime,
  formatLocalDate,
  localDateOf,
  toQueryString,
} from './format';

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

describe('datas locais e query string (RN25, RNF29)', () => {
  it('data local no fuso do hospital perto da meia-noite UTC', () => {
    expect(localDateOf(new Date('2026-10-18T02:59:59Z'))).toBe('2026-10-17');
    expect(localDateOf(new Date('2026-10-18T03:00:00Z'))).toBe('2026-10-18');
  });

  it('soma dias, conta intervalos inclusivos e formata dd/mm/aaaa', () => {
    expect(addDays('2026-10-18', -29)).toBe('2026-09-19');
    expect(daysInclusive('2025-01-01', '2026-01-01')).toBe(366);
    expect(formatLocalDate('2026-10-05')).toBe('05/10/2026');
    expect(() => formatLocalDate('05/10/2026')).toThrow(RangeError);
  });

  it('monta a query string sem valores vazios', () => {
    expect(toQueryString({ a: 'x y', b: '', c: undefined, d: 2 })).toBe('?a=x+y&d=2');
    expect(toQueryString({ a: '' })).toBe('');
  });
});
