/**
 * Tokens da autenticação própria (Etapa 3): JWT HS256 de acesso e token de renovação. Substitui
 * os testes do cliente do Supabase Auth: formato, assinatura, adulteração, algoritmo e expiração.
 */
import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { passwordSchema } from '../../src/modules/auth/password-policy.js';
import { hashPassword, verifyPassword } from '../../src/modules/auth/passwords.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  isWellFormedJwt,
  isWellFormedRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from '../../src/modules/auth/tokens.js';

const SECRET = 'segredo-de-teste-unitario-com-mais-de-32-caracteres';
const CLAIMS = {
  profileId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
};
const NOW = new Date('2026-11-05T12:00:00Z');
const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('token de acesso (JWT HS256)', () => {
  it('emite e valida: sub, sid, iat e exp coerentes', () => {
    const { token, expiresAt } = signAccessToken(SECRET, CLAIMS, NOW, 3600);
    expect(isWellFormedJwt(token)).toBe(true);
    expect(expiresAt.toISOString()).toBe('2026-11-05T13:00:00.000Z');
    expect(verifyAccessToken(SECRET, token, NOW)).toEqual({
      sub: CLAIMS.profileId,
      sid: CLAIMS.sessionId,
      iat: NOW.getTime() / 1000,
      exp: NOW.getTime() / 1000 + 3600,
    });
  });

  it('recusa token expirado, de outro segredo, adulterado ou com "alg: none"', () => {
    const { token } = signAccessToken(SECRET, CLAIMS, NOW, 3600);
    const [header, payload, signature] = token.split('.') as [string, string, string];
    expect(verifyAccessToken(SECRET, token, new Date('2026-11-05T13:00:00Z'))).toBeNull();
    expect(verifyAccessToken(`${SECRET}-outro`, token, NOW)).toBeNull();
    const original = JSON.parse(Buffer.from(payload, 'base64url').toString()) as object;
    const forged = encode({ ...original, sub: CLAIMS.sessionId });
    expect(verifyAccessToken(SECRET, `${header}.${forged}.${signature}`, NOW)).toBeNull();
    const none = `${encode({ alg: 'none', typ: 'JWT' })}.${payload}.${signature}`;
    expect(verifyAccessToken(SECRET, none, NOW)).toBeNull();
    expect(verifyAccessToken(SECRET, 'nao-e-jwt', NOW)).toBeNull();
    expect(verifyAccessToken(SECRET, `${header}.${payload}`, NOW)).toBeNull();
  });

  it('recusa conteúdo sem os campos esperados (typ, UUIDs, exp)', () => {
    const header = encode({ alg: 'HS256', typ: 'JWT' });
    const sign = (payload: object) => {
      const body = `${header}.${encode(payload)}`;
      return `${body}.${createHmac('sha256', SECRET).update(body).digest('base64url')}`;
    };
    const exp = NOW.getTime() / 1000 + 60;
    expect(
      verifyAccessToken(
        SECRET,
        sign({ sub: CLAIMS.profileId, sid: CLAIMS.sessionId, iat: 1, exp, typ: 'access' }),
        NOW,
      ),
    ).not.toBeNull();
    expect(
      verifyAccessToken(
        SECRET,
        sign({ sub: CLAIMS.profileId, sid: CLAIMS.sessionId, iat: 1, exp, typ: 'refresh' }),
        NOW,
      ),
    ).toBeNull();
    expect(
      verifyAccessToken(
        SECRET,
        sign({ sub: 'x', sid: CLAIMS.sessionId, iat: 1, exp, typ: 'access' }),
        NOW,
      ),
    ).toBeNull();
    expect(
      verifyAccessToken(
        SECRET,
        sign({ sub: CLAIMS.profileId, sid: CLAIMS.sessionId, iat: 1, typ: 'access' }),
        NOW,
      ),
    ).toBeNull();
  });
});

describe('token de renovação e senhas', () => {
  it('gera 256 bits aleatórios e guarda só o SHA-256', () => {
    const token = generateRefreshToken();
    expect(isWellFormedRefreshToken(token)).toBe(true);
    expect(generateRefreshToken()).not.toBe(token);
    expect(hashRefreshToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken(token)).not.toContain(token);
    expect(isWellFormedRefreshToken('curto')).toBe(false);
  });

  it('bcrypt: hash com sal aleatório, verificação e recusa de senha errada', async () => {
    const hash = await hashPassword('SenhaDeTeste123', 4);
    expect(hash).toMatch(/^\$2[aby]\$04\$[./A-Za-z0-9]{53}$/);
    expect(await hashPassword('SenhaDeTeste123', 4)).not.toBe(hash);
    expect(await verifyPassword('SenhaDeTeste123', hash)).toBe(true);
    expect(await verifyPassword('SenhaDeTeste124', hash)).toBe(false);
  });

  it('a política recusa senhas acima de 72 bytes (limite do bcrypt)', () => {
    expect(passwordSchema.safeParse(`A1${'b'.repeat(70)}`).success).toBe(true);
    expect(passwordSchema.safeParse(`A1${'ç'.repeat(40)}`).success).toBe(false);
  });
});
