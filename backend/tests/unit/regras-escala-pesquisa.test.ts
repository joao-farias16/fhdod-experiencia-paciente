/**
 * Regras puras das ET04–ET06: NPS (T05, RN03), nota baixa (RN05), janela do turno (RN20, RN25),
 * hash canônico e Idempotency-Key (RN13). Os fluxos completos estão nos testes de banco.
 */
import { describe, expect, it } from 'vitest';

import { computeShiftWindow } from '../../src/modules/shifts/shift-rules.js';
import { canonicalHash, parseIdempotencyKey } from '../../src/services/idempotency.js';
import { classifyNps, computeNps, isLowScore } from '../../src/services/nps.js';
import { localDateTimeToInstant, parseBrazilianDate } from '../../src/utils/dates.js';

describe('T05 — computeNps (unitário)', () => {
  it.each([
    [4, 3, 3, 10.0],
    [0, 0, 0, null],
    [10, 0, 0, 100.0],
    [0, 0, 10, -100.0],
    [1, 15, 0, 6.3],
    [0, 15, 1, -6.3],
  ])('P=%i, passivos=%i, D=%i → %s', (promoters, passives, detractors, expected) => {
    expect(computeNps({ promoters, passives, detractors })).toBe(expected);
  });

  it('classificação e nota baixa', () => {
    expect([0, 6, 7, 8, 9, 10].map(classifyNps)).toEqual([
      'detractor',
      'detractor',
      'passive',
      'passive',
      'promoter',
      'promoter',
    ]);
    expect(isLowScore(6, [])).toBe(true);
    expect(isLowScore(8, [5, 2])).toBe(true);
    expect(isLowScore(10, [3, 5])).toBe(false);
  });
});

describe('janela do turno (RN20, RN25)', () => {
  it('19:00–07:00 termina no dia seguinte; 07:00–07:00 dura 24 h; menos de 1 h é inválido', () => {
    expect(computeShiftWindow('2026-11-10', '19:00', '07:00')).toEqual({
      ok: true,
      startsAt: new Date('2026-11-10T22:00:00.000Z'),
      endsAt: new Date('2026-11-11T10:00:00.000Z'),
    });
    const full = computeShiftWindow('2026-11-10', '07:00', '07:00');
    expect(full.ok && full.endsAt.getTime() - full.startsAt.getTime()).toBe(24 * 3_600_000);
    expect(computeShiftWindow('2026-11-10', '08:00', '08:59').ok).toBe(false);
    expect(computeShiftWindow('2026-11-10', '08:00', '09:00').ok).toBe(true);
  });

  it('converte hora local em UTC e lê datas DD/MM/AAAA', () => {
    expect(localDateTimeToInstant('2026-01-01', '00:00').toISOString()).toBe(
      '2026-01-01T03:00:00.000Z',
    );
    expect(parseBrazilianDate('29/02/2028')).toBe('2028-02-29');
    expect(parseBrazilianDate('29/02/2027')).toBeUndefined();
    expect(parseBrazilianDate('2027-02-01')).toBeUndefined();
  });
});

describe('idempotência (RN13)', () => {
  it('hash canônico independe da ordem das chaves; chave precisa ser UUID v4', () => {
    expect(canonicalHash({ b: 1, a: [{ y: 2, x: 1 }] })).toBe(
      canonicalHash({ a: [{ x: 1, y: 2 }], b: 1 }),
    );
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 2 }));
    expect(parseIdempotencyKey('0D9C2B7E-3F4A-4C1E-9B8D-6A5F4E3D2C1B')).toBe(
      '0d9c2b7e-3f4a-4c1e-9b8d-6a5f4e3d2c1b',
    );
    for (const invalid of [undefined, '', 'abc', '0d9c2b7e-3f4a-1c1e-9b8d-6a5f4e3d2c1b']) {
      expect(() => parseIdempotencyKey(invalid)).toThrow(/UUID v4/);
    }
  });
});
