/**
 * Tokens da autenticação própria (Etapa 3, substitui o Supabase Auth):
 * - token de acesso: JWT compacto HS256 (HMAC-SHA256 com JWT_SECRET), com `sub` (perfil), `sid`
 *   (sessão), `iat`, `exp` e `typ: "access"`; vai no cabeçalho Authorization: Bearer;
 * - token de renovação: 32 bytes aleatórios (CSPRNG) em base64url, de uso único; no banco fica
 *   somente o SHA-256 (auth_sessions.refresh_token_hash).
 * A assinatura é conferida em tempo constante e o algoritmo é fixo (sem "alg: none").
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** JWT compacto: três segmentos base64url (cabeçalho, conteúdo e assinatura). */
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MAX_TOKEN_LENGTH = 4_096;
const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface AccessTokenClaims {
  /** Perfil (profiles.id). */
  sub: string;
  /** Sessão (auth_sessions.id). */
  sid: string;
  /** Emissão e expiração em segundos desde a época. */
  iat: number;
  exp: number;
}

/** Indica se o texto tem o formato de um JWT; tokens malformados nem são verificados. */
export function isWellFormedJwt(token: string): boolean {
  return token.length <= MAX_TOKEN_LENGTH && JWT_PATTERN.test(token);
}

function sign(input: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(input).digest();
}

/** Emite o token de acesso da sessão. */
export function signAccessToken(
  secret: string,
  claims: { profileId: string; sessionId: string },
  issuedAt: Date,
  ttlSeconds: number,
): { token: string; expiresAt: Date } {
  const iat = Math.floor(issuedAt.getTime() / 1000);
  const exp = iat + ttlSeconds;
  const payload = Buffer.from(
    JSON.stringify({ sub: claims.profileId, sid: claims.sessionId, iat, exp, typ: 'access' }),
  ).toString('base64url');
  const signature = sign(`${HEADER}.${payload}`, secret).toString('base64url');
  return { token: `${HEADER}.${payload}.${signature}`, expiresAt: new Date(exp * 1000) };
}

/**
 * Verifica assinatura, algoritmo, tipo e validade do token de acesso. Devolve as declarações ou
 * null (token malformado, adulterado, de outro segredo ou expirado) — sem distinguir o motivo.
 */
export function verifyAccessToken(
  secret: string,
  token: string,
  now: Date,
): AccessTokenClaims | null {
  if (!isWellFormedJwt(token)) return null;
  const [header, payload, signature] = token.split('.') as [string, string, string];
  if (header !== HEADER) return null;
  const expected = sign(`${header}.${payload}`, secret);
  const received = Buffer.from(signature, 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof claims !== 'object' || claims === null) return null;
  const { sub, sid, iat, exp, typ } = claims as Record<string, unknown>;
  if (
    typ !== 'access' ||
    typeof sub !== 'string' ||
    !UUID.test(sub) ||
    typeof sid !== 'string' ||
    !UUID.test(sid) ||
    typeof iat !== 'number' ||
    typeof exp !== 'number' ||
    !Number.isInteger(exp)
  ) {
    return null;
  }
  if (exp * 1000 <= now.getTime()) return null;
  return { sub, sid, iat, exp };
}

/** Novo token de renovação (256 bits aleatórios). */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Formato de um token de renovação emitido por generateRefreshToken. */
export function isWellFormedRefreshToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

/** SHA-256 hexadecimal: o que é gravado no banco no lugar do token de renovação. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
