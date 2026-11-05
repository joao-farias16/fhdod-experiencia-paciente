/**
 * Serviços da autenticação própria (Etapa 3, substitui o Supabase Auth): login (E44), renovação
 * (E45) e logout (E46) com sessões em auth_sessions; validação do token de acesso a cada
 * requisição; perfil e permissões (E04) e troca da própria senha (E05).
 */
import { randomUUID } from 'node:crypto';

import type { Database, Queryable } from '../../lib/database.js';
import type { Clock } from '../../utils/dates.js';
import { HttpError, unauthenticated } from '../../utils/errors.js';
import { invalidField } from '../../utils/validation.js';
import { type AuditContext, recordAudit } from '../audit/audit.service.js';
import { findUserById, type UserRecord } from '../users/users.repository.js';
import {
  findLoginCandidate,
  findPasswordHash,
  findRequestIdentity,
  findSessionByRefreshHash,
  insertSession,
  recordLogin,
  revokeProfileSessions,
  revokeSession,
  rotateSession,
  updatePasswordHash,
} from './auth.repository.js';
import type { AuthConfig, AuthContext, SessionTokens } from './auth.types.js';
import { dummyPasswordHash, hashPassword, verifyPassword } from './passwords.js';
import { type Permission, permissionsFor } from './permissions.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  isWellFormedRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from './tokens.js';

export interface AuthServiceDeps {
  db: Database;
  config: AuthConfig;
  clock: Clock;
}

/**
 * Renovações simultâneas (duas abas) apresentam o mesmo token dentro desta janela: a segunda é
 * recusada sem revogar a sessão. Depois dela, reapresentar um token já trocado indica vazamento
 * e revoga a sessão inteira.
 */
export const REFRESH_REUSE_GRACE_MS = 10_000;

export function accountDisabled(): HttpError {
  return new HttpError(
    403,
    'ACCOUNT_DISABLED',
    'Sua conta está desativada. Procure o superadministrador.',
  );
}

function invalidCredentials(): HttpError {
  return new HttpError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha incorretos.');
}

function invalidRefreshToken(): HttpError {
  return unauthenticated('Sua sessão terminou. Entre novamente.');
}

function issueTokens(
  config: AuthConfig,
  profileId: string,
  sessionId: string,
  refreshToken: string,
  now: Date,
  sessionExpiresAt: Date,
): SessionTokens {
  const access = signAccessToken(
    config.jwtSecret,
    { profileId, sessionId },
    now,
    config.accessTokenTtlSeconds,
  );
  return {
    accessToken: access.token,
    tokenType: 'Bearer',
    expiresIn: config.accessTokenTtlSeconds,
    expiresAt: access.expiresAt.toISOString(),
    refreshToken,
    refreshTokenExpiresAt: sessionExpiresAt.toISOString(),
  };
}

function sessionExpiration(config: AuthConfig, now: Date): Date {
  return new Date(now.getTime() + config.refreshTokenTtlDays * 86_400_000);
}

/**
 * Cria uma sessão para o perfil e devolve os tokens (usada pelo login e pelos testes). O token de
 * renovação é gravado somente como SHA-256.
 */
export async function createSession(
  db: Queryable,
  config: AuthConfig,
  profileId: string,
  now: Date,
  ipHash?: string,
): Promise<{ sessionId: string; tokens: SessionTokens }> {
  const sessionId = randomUUID();
  const refreshToken = generateRefreshToken();
  const expiresAt = sessionExpiration(config, now);
  await insertSession(db, {
    id: sessionId,
    profileId,
    refreshTokenHash: hashRefreshToken(refreshToken),
    createdAt: now,
    expiresAt,
    ipHash: ipHash ?? null,
  });
  return {
    sessionId,
    tokens: issueTokens(config, profileId, sessionId, refreshToken, now, expiresAt),
  };
}

export type MeDto = Pick<
  UserDtoLike,
  'id' | 'fullName' | 'email' | 'role' | 'allSectors' | 'sectors' | 'mustChangePassword'
> & { permissions: Permission[] };

type UserDtoLike = Omit<UserRecord, 'hospitalId' | 'deactivatedAt' | 'createdAt' | 'updatedAt'>;

function toMe(record: UserRecord): MeDto {
  return {
    id: record.id,
    fullName: record.fullName,
    email: record.email,
    role: record.role,
    allSectors: record.allSectors,
    sectors: record.sectors,
    mustChangePassword: record.mustChangePassword,
    permissions: permissionsFor(record.role),
  };
}

/**
 * E44 — login com e-mail e senha (bcrypt). E-mail inexistente e senha errada têm a mesma resposta
 * (401 INVALID_CREDENTIALS) e o mesmo custo de tempo; conta desativada com senha correta → 403
 * ACCOUNT_DISABLED. Com troca de senha pendente o login é aceito, mas as demais rotas respondem
 * 403 PASSWORD_CHANGE_REQUIRED até o E05 (RF04).
 */
export async function login(
  { db, config, clock }: AuthServiceDeps,
  input: { email: string; password: string },
  ipHash?: string,
): Promise<SessionTokens & { user: MeDto }> {
  const candidate = await findLoginCandidate(db, input.email);
  const hash = candidate?.passwordHash ?? (await dummyPasswordHash(config.bcryptRounds));
  const matches = await verifyPassword(input.password, hash);
  if (candidate === null || !matches) throw invalidCredentials();
  if (!candidate.isActive) throw accountDisabled();

  const now = clock.now();
  return db.transaction(async (tx) => {
    const { tokens } = await createSession(tx, config, candidate.profileId, now, ipHash);
    await recordLogin(tx, candidate.profileId, now);
    const user = await findUserById(tx, candidate.profileId);
    if (user === null) throw invalidCredentials();
    return { ...tokens, user: toMe(user) };
  });
}

/**
 * E45 — renovação: troca o token de renovação (uso único) por um novo par de tokens. Token
 * desconhecido, expirado ou de sessão revogada → 401; reapresentar um token já trocado (fora da
 * janela de renovações simultâneas) revoga a sessão; conta desativada → 403 ACCOUNT_DISABLED.
 */
export async function refreshSession(
  { db, config, clock }: AuthServiceDeps,
  refreshToken: string,
): Promise<SessionTokens> {
  if (!isWellFormedRefreshToken(refreshToken)) throw invalidRefreshToken();
  const presentedHash = hashRefreshToken(refreshToken);
  const now = clock.now();
  const outcome = await db.transaction(async (tx) => {
    const session = await findSessionByRefreshHash(tx, presentedHash);
    if (session === null || session.revokedAt !== null || session.expiresAt <= now) {
      return { status: 'invalid' as const };
    }
    if (session.matchedPrevious) {
      const recent =
        session.lastRefreshedAt !== null &&
        now.getTime() - session.lastRefreshedAt.getTime() <= REFRESH_REUSE_GRACE_MS;
      if (!recent) await revokeSession(tx, session.id, 'refresh_reuse', now);
      return { status: 'invalid' as const };
    }
    const user = await findUserById(tx, session.profileId);
    if (user === null) return { status: 'invalid' as const };
    if (!user.isActive) return { status: 'disabled' as const };

    const nextToken = generateRefreshToken();
    const expiresAt = sessionExpiration(config, now);
    await rotateSession(tx, session.id, {
      previousHash: presentedHash,
      newHash: hashRefreshToken(nextToken),
      at: now,
      expiresAt,
    });
    return {
      status: 'ok' as const,
      tokens: issueTokens(config, session.profileId, session.id, nextToken, now, expiresAt),
    };
  });
  // A revogação por reutilização precisa ser confirmada (COMMIT) antes da resposta de erro.
  if (outcome.status === 'disabled') throw accountDisabled();
  if (outcome.status === 'invalid') throw invalidRefreshToken();
  return outcome.tokens;
}

/** E46 — logout: revoga a sessão do token apresentado (os tokens dela deixam de valer). */
export async function logout({ db, clock }: AuthServiceDeps, auth: AuthContext): Promise<void> {
  await revokeSession(db, auth.sessionId, 'logout', clock.now());
}

/** Resultado da validação do token de acesso de uma requisição. */
export type TokenAuthentication =
  { status: 'valid'; auth: AuthContext } | { status: 'disabled' } | { status: 'invalid' };

/**
 * Valida o token de acesso (assinatura, expiração e sessão ativa) e carrega o perfil e o escopo
 * a cada requisição (RF09, RN18). Sessão encerrada por logout, troca ou redefinição de senha →
 * inválido; conta desativada → `disabled` (403 ACCOUNT_DISABLED), mesmo com o token válido.
 */
export async function authenticateAccessToken(
  { db, config, clock }: Pick<AuthServiceDeps, 'db' | 'config' | 'clock'>,
  token: string,
): Promise<TokenAuthentication> {
  const now = clock.now();
  const claims = verifyAccessToken(config.jwtSecret, token, now);
  if (claims === null) return { status: 'invalid' };
  const identity = await findRequestIdentity(db, claims.sid, claims.sub, now);
  if (identity === null) return { status: 'invalid' };
  if (!identity.isActive) return { status: 'disabled' };
  return {
    status: 'valid',
    auth: {
      profileId: identity.profileId,
      sessionId: claims.sid,
      hospitalId: identity.hospitalId,
      role: identity.role,
      // SA é sempre global (CHECK profiles_scope_by_role); AS nunca.
      scope: identity.allSectors ? { all: true } : { all: false, sectorIds: identity.sectorIds },
      mustChangePassword: identity.mustChangePassword,
    },
  };
}

/** E04 — perfil, escopo e permissões do usuário autenticado (RF05). */
export async function getMe(db: Queryable, auth: AuthContext): Promise<MeDto> {
  const record = await findUserById(db, auth.profileId);
  if (record === null) throw unauthenticated();
  return toMe(record);
}

/**
 * E05 — troca da própria senha (RF04): obrigatória no primeiro acesso e após redefinição, ou
 * voluntária. Grava o novo hash, desmarca must_change_password e encerra as OUTRAS sessões do
 * usuário (a atual continua válida), com auditoria sem a senha. A nova senha deve ser diferente
 * da atual.
 */
export async function changeOwnPassword(
  { db, config, clock }: AuthServiceDeps,
  auth: AuthContext,
  audit: AuditContext,
  newPassword: string,
): Promise<void> {
  const currentHash = await findPasswordHash(db, auth.profileId);
  if (currentHash === null) throw unauthenticated();
  if (await verifyPassword(newPassword, currentHash)) {
    throw invalidField('newPassword', 'A nova senha deve ser diferente da senha atual.');
  }
  const passwordHash = await hashPassword(newPassword, config.bcryptRounds);
  const now = clock.now();
  await db.transaction(async (tx) => {
    await updatePasswordHash(tx, auth.profileId, {
      passwordHash,
      mustChangePassword: false,
      at: now,
    });
    await revokeProfileSessions(tx, auth.profileId, 'password_changed', now, auth.sessionId);
    await recordAudit(tx, audit, {
      action: 'PASSWORD_CHANGED',
      entityType: 'profile',
      entityId: auth.profileId,
      details: { mandatory: auth.mustChangePassword },
    });
  });
}
