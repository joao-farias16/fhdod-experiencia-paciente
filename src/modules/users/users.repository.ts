/** Acesso a dados dos usuários administrativos (profiles e profile_sectors). */
import { type Queryable, toNumber } from '../../lib/database.js';
import type { UserRole } from '../../lib/domain-types.js';
import { containsPattern, sql, type SqlStatement } from '../../lib/sql.js';

export interface SectorSummary {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

/** Usuário com o escopo de setores, sem a senha (o hash nunca sai do repositório de auth). */
export interface UserRecord {
  id: string;
  hospitalId: string;
  fullName: string;
  email: string;
  role: UserRole;
  allSectors: boolean;
  isActive: boolean;
  mustChangePassword: boolean;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Setores associados, por nome. */
  sectors: SectorSummary[];
}

interface ProfileRow {
  id: string;
  hospital_id: string;
  full_name: string;
  email: string;
  role: UserRole;
  all_sectors: boolean;
  is_active: boolean;
  must_change_password: boolean;
  deactivated_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const PROFILE_COLUMNS = sql`
  p.id, p.hospital_id, p.full_name, p.email, p.role, p.all_sectors, p.is_active,
  p.must_change_password, p.deactivated_at, p.created_at, p.updated_at`;

/** Setores associados a cada perfil informado, ordenados por nome. */
export async function sectorsOfProfiles(
  db: Queryable,
  profileIds: readonly string[],
): Promise<Map<string, SectorSummary[]>> {
  const byProfile = new Map<string, SectorSummary[]>(profileIds.map((id) => [id, []]));
  if (profileIds.length === 0) return byProfile;
  const rows = await db.query<{
    profile_id: string;
    id: string;
    code: string;
    name: string;
    is_active: boolean;
  }>(sql`
    SELECT ps.profile_id, s.id, s.code, s.name, s.is_active
    FROM profile_sectors ps JOIN sectors s ON s.id = ps.sector_id
    WHERE ps.profile_id IN (${sql.list(profileIds)})
    ORDER BY s.name, s.id`);
  for (const row of rows) {
    byProfile
      .get(row.profile_id)
      ?.push({ id: row.id, code: row.code, name: row.name, isActive: row.is_active });
  }
  return byProfile;
}

async function withSectors(db: Queryable, rows: ProfileRow[]): Promise<UserRecord[]> {
  const sectors = await sectorsOfProfiles(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    id: row.id,
    hospitalId: row.hospital_id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    allSectors: row.all_sectors,
    isActive: row.is_active,
    mustChangePassword: row.must_change_password,
    deactivatedAt: row.deactivated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sectors: sectors.get(row.id) ?? [],
  }));
}

export async function findUserById(db: Queryable, id: string): Promise<UserRecord | null> {
  const rows = await db.query<ProfileRow>(sql`
    SELECT ${PROFILE_COLUMNS} FROM profiles p WHERE p.id = ${id}`);
  const [record] = await withSectors(db, rows);
  return record ?? null;
}

export async function findProfileIdByEmail(db: Queryable, email: string): Promise<string | null> {
  const [row] = await db.query<{ id: string }>(sql`SELECT id FROM profiles WHERE email = ${email}`);
  return row?.id ?? null;
}

export interface UserListFilters {
  role?: UserRole | undefined;
  isActive?: boolean | undefined;
  sectorId?: string | undefined;
  search?: string | undefined;
  offset: number;
  limit: number;
}

/** E06 — lista paginada por nome, com filtros de perfil, situação, setor e busca. */
export async function listUserRecords(
  db: Queryable,
  hospitalId: string,
  filters: UserListFilters,
): Promise<{ items: UserRecord[]; total: number }> {
  const conditions: SqlStatement[] = [sql`p.hospital_id = ${hospitalId}`];
  if (filters.role !== undefined) conditions.push(sql`p.role = ${filters.role}`);
  if (filters.isActive !== undefined) conditions.push(sql`p.is_active = ${filters.isActive}`);
  if (filters.sectorId !== undefined) {
    conditions.push(sql`EXISTS (
      SELECT 1 FROM profile_sectors ps WHERE ps.profile_id = p.id AND ps.sector_id = ${filters.sectorId})`);
  }
  if (filters.search !== undefined) {
    // Nome sem distinguir maiúsculas; e-mail (sempre minúsculo) com o termo em minúsculas.
    const pattern = containsPattern(filters.search.toLowerCase());
    conditions.push(sql`(LOWER(p.full_name) LIKE ${pattern} OR p.email LIKE ${pattern})`);
  }
  const where = sql.join(conditions, ' AND ');
  const [rows, totals] = await Promise.all([
    db.query<ProfileRow>(sql`
      SELECT ${PROFILE_COLUMNS} FROM profiles p
      WHERE ${where}
      ORDER BY p.full_name, p.id
      LIMIT ${filters.limit} OFFSET ${filters.offset}`),
    db.query<{ total: number }>(sql`SELECT COUNT(*) AS total FROM profiles p WHERE ${where}`),
  ]);
  return { items: await withSectors(db, rows), total: toNumber(totals[0]?.total ?? 0) };
}

export interface ProfileInsert {
  id: string;
  hospitalId: string;
  fullName: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  allSectors: boolean;
  mustChangePassword: boolean;
  createdById: string | null;
}

export async function insertProfile(db: Queryable, data: ProfileInsert): Promise<void> {
  await db.execute(sql`
    INSERT INTO profiles
      (id, hospital_id, full_name, email, password_hash, role, all_sectors, must_change_password, created_by)
    VALUES (${data.id}, ${data.hospitalId}, ${data.fullName}, ${data.email}, ${data.passwordHash},
            ${data.role}, ${data.allSectors}, ${data.mustChangePassword}, ${data.createdById})`);
}

export async function insertProfileSectors(
  db: Queryable,
  profileId: string,
  sectorIds: readonly string[],
  createdById: string | null,
): Promise<void> {
  if (sectorIds.length === 0) return;
  const rows = sectorIds.map((sectorId) => sql`(${profileId}, ${sectorId}, ${createdById})`);
  await db.execute(sql`
    INSERT INTO profile_sectors (profile_id, sector_id, created_by)
    VALUES ${sql.join(rows, ', ')}`);
}

export async function deleteProfileSectors(
  db: Queryable,
  profileId: string,
  sectorIds: readonly string[],
): Promise<void> {
  if (sectorIds.length === 0) return;
  await db.execute(sql`
    DELETE FROM profile_sectors
    WHERE profile_id = ${profileId} AND sector_id IN (${sql.list(sectorIds)})`);
}

export interface ProfileUpdate {
  fullName: string;
  role: UserRole;
  allSectors: boolean;
  isActive: boolean;
  /** undefined = mantém deactivated_at/deactivated_by. */
  deactivation?: { at: Date; by: string } | null;
}

export async function updateProfileRow(
  db: Queryable,
  id: string,
  data: ProfileUpdate,
): Promise<void> {
  const deactivation =
    data.deactivation === undefined
      ? sql.empty
      : data.deactivation === null
        ? sql`, deactivated_at = NULL, deactivated_by = NULL`
        : sql`, deactivated_at = ${data.deactivation.at}, deactivated_by = ${data.deactivation.by}`;
  await db.execute(sql`
    UPDATE profiles
    SET full_name = ${data.fullName}, role = ${data.role}, all_sectors = ${data.allSectors},
        is_active = ${data.isActive} ${deactivation}
    WHERE id = ${id}`);
}

/**
 * Bloqueia (FOR UPDATE) o usuário-alvo e os SA ativos do hospital numa única instrução, em ordem
 * de id, evitando deadlocks e garantindo a contagem de SA ativos sob concorrência (RN24).
 */
export async function lockTargetAndSuperadmins(
  db: Queryable,
  targetId: string,
  hospitalId: string,
): Promise<{ id: string; role: UserRole; isActive: boolean }[]> {
  const rows = await db.query<{ id: string; role: UserRole; is_active: boolean }>(sql`
    SELECT id, role, is_active FROM profiles
    WHERE id = ${targetId}
       OR (role = 'superadmin' AND is_active AND hospital_id = ${hospitalId})
    ORDER BY id
    FOR UPDATE`);
  return rows.map((row) => ({ id: row.id, role: row.role, isActive: row.is_active }));
}
