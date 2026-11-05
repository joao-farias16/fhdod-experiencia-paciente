/**
 * Acesso a dados da autenticação própria: credenciais (profiles.password_hash) e sessões
 * (auth_sessions). O hash da senha só é lido aqui e nunca sai do módulo de autenticação.
 */
import { type Queryable, toNumber } from '../../lib/database.js';
import type { UserRole } from '../../lib/domain-types.js';
import { sql } from '../../lib/sql.js';

export type SessionRevocationReason =
  'logout' | 'password_changed' | 'password_reset' | 'refresh_reuse';

export interface LoginCandidate {
  profileId: string;
  passwordHash: string;
  isActive: boolean;
}

export async function findLoginCandidate(
  db: Queryable,
  email: string,
): Promise<LoginCandidate | null> {
  const [row] = await db.query<{ id: string; password_hash: string; is_active: boolean }>(sql`
    SELECT id, password_hash, is_active FROM profiles WHERE email = ${email}`);
  return row === undefined
    ? null
    : { profileId: row.id, passwordHash: row.password_hash, isActive: row.is_active };
}

export async function findPasswordHash(db: Queryable, profileId: string): Promise<string | null> {
  const [row] = await db.query<{ password_hash: string }>(sql`
    SELECT password_hash FROM profiles WHERE id = ${profileId}`);
  return row?.password_hash ?? null;
}

export async function insertSession(
  db: Queryable,
  data: {
    id: string;
    profileId: string;
    refreshTokenHash: string;
    createdAt: Date;
    expiresAt: Date;
    ipHash: string | null;
  },
): Promise<void> {
  await db.execute(sql`
    INSERT INTO auth_sessions (id, profile_id, refresh_token_hash, created_at, expires_at, ip_hash)
    VALUES (${data.id}, ${data.profileId}, ${data.refreshTokenHash}, ${data.createdAt},
            ${data.expiresAt}, ${data.ipHash})`);
}

export async function recordLogin(db: Queryable, profileId: string, at: Date): Promise<void> {
  await db.execute(sql`UPDATE profiles SET last_login_at = ${at} WHERE id = ${profileId}`);
}

export interface SessionRow {
  id: string;
  profileId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  lastRefreshedAt: Date | null;
  /** O token apresentado é o anterior à última renovação (reutilização). */
  matchedPrevious: boolean;
}

/** Sessão pelo hash do token de renovação atual ou anterior, bloqueada para atualização. */
export async function findSessionByRefreshHash(
  db: Queryable,
  refreshTokenHash: string,
): Promise<SessionRow | null> {
  const [row] = await db.query<{
    id: string;
    profile_id: string;
    expires_at: Date;
    revoked_at: Date | null;
    last_refreshed_at: Date | null;
    matched_previous: number;
  }>(sql`
    SELECT id, profile_id, expires_at, revoked_at, last_refreshed_at,
           (refresh_token_hash <> ${refreshTokenHash}) AS matched_previous
    FROM auth_sessions
    WHERE refresh_token_hash = ${refreshTokenHash}
       OR previous_refresh_token_hash = ${refreshTokenHash}
    LIMIT 1
    FOR UPDATE`);
  if (row === undefined) return null;
  return {
    id: row.id,
    profileId: row.profile_id,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastRefreshedAt: row.last_refreshed_at,
    matchedPrevious: toNumber(row.matched_previous) === 1,
  };
}

/** Rotação do token de renovação (uso único) com expiração deslizante. */
export async function rotateSession(
  db: Queryable,
  id: string,
  data: { previousHash: string; newHash: string; at: Date; expiresAt: Date },
): Promise<void> {
  await db.execute(sql`
    UPDATE auth_sessions
    SET previous_refresh_token_hash = ${data.previousHash}, refresh_token_hash = ${data.newHash},
        last_refreshed_at = ${data.at}, expires_at = ${data.expiresAt}
    WHERE id = ${id}`);
}

export async function revokeSession(
  db: Queryable,
  id: string,
  reason: SessionRevocationReason,
  at: Date,
): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE auth_sessions SET revoked_at = ${at}, revoked_reason = ${reason}
    WHERE id = ${id} AND revoked_at IS NULL`);
  return result.affectedRows === 1;
}

/** Revoga todas as sessões ativas do perfil (exceto, opcionalmente, a sessão atual). */
export async function revokeProfileSessions(
  db: Queryable,
  profileId: string,
  reason: SessionRevocationReason,
  at: Date,
  exceptSessionId?: string,
): Promise<number> {
  const result = await db.execute(sql`
    UPDATE auth_sessions SET revoked_at = ${at}, revoked_reason = ${reason}
    WHERE profile_id = ${profileId} AND revoked_at IS NULL
      ${exceptSessionId === undefined ? sql.empty : sql`AND id <> ${exceptSessionId}`}`);
  return result.affectedRows;
}

export interface RequestIdentity {
  profileId: string;
  hospitalId: string;
  role: UserRole;
  allSectors: boolean;
  isActive: boolean;
  mustChangePassword: boolean;
  sectorIds: string[];
}

/**
 * Perfil da sessão válida (não revogada e não expirada) a que o token de acesso pertence, com o
 * escopo de setores. Carregado a cada requisição autenticada (RF09, RN18).
 */
export async function findRequestIdentity(
  db: Queryable,
  sessionId: string,
  profileId: string,
  now: Date,
): Promise<RequestIdentity | null> {
  const [row] = await db.query<{
    id: string;
    hospital_id: string;
    role: UserRole;
    all_sectors: boolean;
    is_active: boolean;
    must_change_password: boolean;
  }>(sql`
    SELECT p.id, p.hospital_id, p.role, p.all_sectors, p.is_active, p.must_change_password
    FROM auth_sessions s JOIN profiles p ON p.id = s.profile_id
    WHERE s.id = ${sessionId} AND s.profile_id = ${profileId}
      AND s.revoked_at IS NULL AND s.expires_at > ${now}`);
  if (row === undefined) return null;
  const sectors = await db.query<{ sector_id: string }>(sql`
    SELECT sector_id FROM profile_sectors WHERE profile_id = ${profileId} ORDER BY sector_id`);
  return {
    profileId: row.id,
    hospitalId: row.hospital_id,
    role: row.role,
    allSectors: row.all_sectors,
    isActive: row.is_active,
    mustChangePassword: row.must_change_password,
    sectorIds: sectors.map((sector) => sector.sector_id),
  };
}

export async function updatePasswordHash(
  db: Queryable,
  profileId: string,
  data: { passwordHash: string; mustChangePassword: boolean; at: Date },
): Promise<void> {
  await db.execute(sql`
    UPDATE profiles
    SET password_hash = ${data.passwordHash}, must_change_password = ${data.mustChangePassword},
        password_changed_at = ${data.at}
    WHERE id = ${profileId}`);
}
