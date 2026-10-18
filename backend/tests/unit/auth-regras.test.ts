/**
 * Regras puras da ET03: política de senhas (RN28), senha temporária (RF03), escopo de setores
 * (RN10, RN18), datas do filtro da auditoria (RN25) e proteção dos detalhes de auditoria (Seção 10).
 */
import { describe, expect, it } from 'vitest';

import {
  generateTemporaryPassword,
  isPasswordCompliant,
  passwordSchema,
  TEMPORARY_PASSWORD_LENGTH,
} from '../../src/modules/auth/password-policy.js';
import { scopeViolations } from '../../src/modules/users/users.schemas.js';
import {
  assertSafeDetails,
  hashIp,
  recordAudit,
  UnsafeAuditDetailsError,
} from '../../src/services/audit.service.js';
import {
  assertResourceInScope,
  isSectorInScope,
  resolveSectorFilter,
  sectorWhere,
} from '../../src/services/scope.js';
import {
  addDays,
  daysInclusive,
  isValidLocalDate,
  localDateOf,
  startOfLocalDay,
} from '../../src/utils/dates.js';
import { AuthorizationDeniedError, HttpError } from '../../src/utils/http-error.js';
import { parseInput } from '../../src/utils/validation.js';

describe('RN28 — política de senhas', () => {
  it.each([
    ['Abcdefgh12', true],
    ['abcdefghij1', true],
    [`A1${'x'.repeat(70)}`, true],
    ['Abcdefg12', false], // 9 caracteres
    ['abcdefghijk', false], // sem número
    ['12345678901', false], // sem letra
    ['çãõéíóúâêô1', false], // letras fora de A–Z, como no requisito letters_digits do Supabase
    [`A1${'x'.repeat(71)}`, false], // 73 caracteres
  ])('%s → %s', (password, expected) => {
    expect(isPasswordCompliant(password)).toBe(expected);
  });

  it('as mensagens de erro nunca repetem a senha recebida', () => {
    const result = passwordSchema.safeParse('senhafraca');
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain('senhafraca');
    try {
      parseInput(passwordSchema, 'outrafraca');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect(JSON.stringify(error)).not.toContain('outrafraca');
    }
  });
});

describe('RF03 — senha temporária (CSPRNG)', () => {
  it('tem 16 caracteres, cumpre a RN28 e não repete em 2.000 gerações', () => {
    const generated = new Set<string>();
    for (let index = 0; index < 2_000; index += 1) {
      const password = generateTemporaryPassword();
      expect(password).toHaveLength(TEMPORARY_PASSWORD_LENGTH);
      expect(isPasswordCompliant(password)).toBe(true);
      expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9]+$/); // sem 0, O, 1, l e I
      generated.add(password);
    }
    expect(generated.size).toBe(2_000);
  });

  it('usa todos os símbolos do alfabeto (distribuição sem lacunas)', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 500; index += 1) {
      for (const char of generateTemporaryPassword()) seen.add(char);
    }
    expect(seen.size).toBe(57);
  });
});

describe('RN18 — coerência entre perfil e escopo', () => {
  const A = '00000000-0000-4000-8000-00000000000a';
  it.each([
    ['superadmin', true, [], 0],
    ['superadmin', false, [], 1],
    ['superadmin', true, [A], 1],
    ['sector_admin', false, [A], 0],
    ['sector_admin', false, [], 1],
    ['sector_admin', true, [], 1],
    ['management', true, [], 0],
    ['ombudsman', false, [A], 0],
    ['viewer', false, [], 1],
    ['viewer', true, [A], 1],
  ] as const)('%s, global=%s, setores=%j → %i violação(ões)', (role, all, sectors, count) => {
    expect(scopeViolations(role, all, sectors)).toHaveLength(count);
  });
});

describe('RN10 — aplicação do escopo', () => {
  const A = 'setor-a';
  const B = 'setor-b';
  const restricted = { all: false, sectorIds: [A] } as const;
  const global = { all: true } as const;

  it('sem filtro: global não restringe; restrito usa os próprios setores', () => {
    expect(resolveSectorFilter(global)).toBeUndefined();
    expect(resolveSectorFilter(restricted)).toEqual([A]);
    expect(sectorWhere(global)).toEqual({});
    expect(sectorWhere(restricted)).toEqual({ sectorId: { in: [A] } });
    expect(sectorWhere({ all: false, sectorIds: [] })).toEqual({ sectorId: { in: [] } });
  });

  it('filtro dentro do escopo é aceito (sem duplicatas); fora → 403 SECTOR_OUT_OF_SCOPE', () => {
    expect(resolveSectorFilter(restricted, [A, A])).toEqual([A]);
    expect(resolveSectorFilter(global, [B])).toEqual([B]);
    expect(() => resolveSectorFilter(restricted, [B])).toThrow(AuthorizationDeniedError);
    try {
      resolveSectorFilter(restricted, [A, B]);
    } catch (error) {
      expect(error).toMatchObject({ status: 403, code: 'SECTOR_OUT_OF_SCOPE' });
    }
  });

  it('recurso individual fora do escopo ou inexistente → 404', () => {
    expect(isSectorInScope(restricted, A)).toBe(true);
    expect(() => {
      assertResourceInScope(restricted, A);
    }).not.toThrow();
    expect(() => {
      assertResourceInScope(global, B);
    }).not.toThrow();
    for (const sectorId of [B, undefined]) {
      try {
        assertResourceInScope(restricted, sectorId);
        expect.unreachable();
      } catch (error) {
        expect(error).toMatchObject({ status: 404, code: 'NOT_FOUND' });
      }
    }
  });
});

describe('RN25 — datas locais do filtro (America/Sao_Paulo)', () => {
  it('converte o início do dia local para UTC (UTC−3)', () => {
    expect(startOfLocalDay('2026-10-18').toISOString()).toBe('2026-10-18T03:00:00.000Z');
    expect(startOfLocalDay('2026-01-01').toISOString()).toBe('2026-01-01T03:00:00.000Z');
    // Horário de verão histórico (2018): início do dia em UTC−2.
    expect(startOfLocalDay('2018-12-01').toISOString()).toBe('2018-12-01T02:00:00.000Z');
  });

  it('identifica a data local de um instante UTC perto da meia-noite', () => {
    expect(localDateOf(new Date('2026-10-18T02:59:59Z'))).toBe('2026-10-17');
    expect(localDateOf(new Date('2026-10-18T03:00:00Z'))).toBe('2026-10-18');
  });

  it('valida datas, soma dias e conta o intervalo inclusivo', () => {
    expect(isValidLocalDate('2026-02-28')).toBe(true);
    expect(isValidLocalDate('2026-02-30')).toBe(false);
    expect(isValidLocalDate('18/10/2026')).toBe(false);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysInclusive('2026-10-18', '2026-10-18')).toBe(1);
    expect(daysInclusive('2025-01-01', '2026-01-01')).toBe(366);
  });
});

describe('Seção 10 — auditoria sem dados pessoais nem segredos', () => {
  it.each([
    'password',
    'newPassword',
    'temporaryPassword',
    'token',
    'secretKey',
    'email',
    'fullName',
    'phone',
    'ip',
    'contact',
  ])('recusa a chave %s nos detalhes', (key) => {
    expect(() => {
      assertSafeDetails({ [key]: 'x' });
    }).toThrow(UnsafeAuditDetailsError);
  });

  it('aceita os detalhes usados pelo catálogo', () => {
    expect(() => {
      assertSafeDetails({
        role: 'viewer',
        allSectors: true,
        sectorIds: [],
        changedFields: ['fullName'],
        roleFrom: 'viewer',
        roleTo: 'management',
        sectorIdsAdded: [],
        sectorIdsRemoved: [],
        mandatory: true,
        changeRequired: true,
        code: 'FORBIDDEN',
        method: 'GET',
        permission: 'users:read',
      });
    }).not.toThrow();
  });

  it('não grava nada quando os detalhes são proibidos e ignora requestId inválido', async () => {
    const created: unknown[] = [];
    const tx = {
      auditLog: {
        create: (args: unknown) => {
          created.push(args);
          return Promise.resolve();
        },
      },
    };
    await expect(
      recordAudit(
        tx as never,
        { actor: null },
        { action: 'USER_UPDATED', entityType: 'profile', details: { email: 'a@b.c' } },
      ),
    ).rejects.toThrow(UnsafeAuditDetailsError);
    expect(created).toHaveLength(0);

    await recordAudit(
      tx as never,
      { actor: null, requestId: 'nao-e-uuid' },
      { action: 'USER_UPDATED', entityType: 'profile' },
    );
    expect(created[0]).toMatchObject({
      data: { requestId: null, actorProfileId: null, details: {} },
    });
  });

  it('o IP vira HMAC-SHA256 determinístico e só com segredo configurado', () => {
    const secret = 's'.repeat(32);
    const hash = hashIp('203.0.113.7', secret);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIp('203.0.113.7', secret)).toBe(hash);
    expect(hashIp('203.0.113.8', secret)).not.toBe(hash);
    expect(hashIp('203.0.113.7', undefined)).toBeUndefined();
    expect(hashIp(undefined, secret)).toBeUndefined();
  });
});
