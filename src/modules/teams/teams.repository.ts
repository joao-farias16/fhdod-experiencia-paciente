/** Acesso a dados das equipes (teams) e das etapas da jornada (journey_stages). */
import type { Queryable } from '../../lib/database.js';
import { sql, type SqlStatement } from '../../lib/sql.js';

export interface TeamRecord {
  id: string;
  sectorId: string;
  code: string;
  name: string;
  isActive: boolean;
  deactivatedAt: Date | null;
  sector: { code: string; name: string; isActive: boolean; hospitalId: string };
}

interface TeamRow {
  id: string;
  sector_id: string;
  code: string;
  name: string;
  is_active: boolean;
  deactivated_at: Date | null;
  sector_code: string;
  sector_name: string;
  sector_is_active: boolean;
  hospital_id: string;
}

const TEAM_SELECT = sql`
  SELECT t.id, t.sector_id, t.code, t.name, t.is_active, t.deactivated_at,
         s.code AS sector_code, s.name AS sector_name, s.is_active AS sector_is_active, s.hospital_id
  FROM teams t JOIN sectors s ON s.id = t.sector_id`;

function toRecord(row: TeamRow): TeamRecord {
  return {
    id: row.id,
    sectorId: row.sector_id,
    code: row.code,
    name: row.name,
    isActive: row.is_active,
    deactivatedAt: row.deactivated_at,
    sector: {
      code: row.sector_code,
      name: row.sector_name,
      isActive: row.sector_is_active,
      hospitalId: row.hospital_id,
    },
  };
}

export async function findTeam(db: Queryable, id: string): Promise<TeamRecord | null> {
  const [row] = await db.query<TeamRow>(sql`${TEAM_SELECT} WHERE t.id = ${id}`);
  return row === undefined ? null : toRecord(row);
}

export async function listTeamRecords(
  db: Queryable,
  hospitalId: string,
  filters: { sectorIds: readonly string[] | undefined; isActive?: boolean | undefined },
): Promise<TeamRecord[]> {
  if (filters.sectorIds?.length === 0) return [];
  const conditions: SqlStatement[] = [sql`s.hospital_id = ${hospitalId}`];
  if (filters.sectorIds !== undefined) {
    conditions.push(sql`t.sector_id IN (${sql.list(filters.sectorIds)})`);
  }
  if (filters.isActive !== undefined) conditions.push(sql`t.is_active = ${filters.isActive}`);
  const rows = await db.query<TeamRow>(sql`
    ${TEAM_SELECT}
    WHERE ${sql.join(conditions, ' AND ')}
    ORDER BY s.name, t.name, t.id`);
  return rows.map(toRecord);
}

export async function findTeamIdByCode(
  db: Queryable,
  sectorId: string,
  code: string,
): Promise<string | null> {
  const [row] = await db.query<{ id: string }>(sql`
    SELECT id FROM teams WHERE sector_id = ${sectorId} AND code = ${code}`);
  return row?.id ?? null;
}

export async function insertTeam(
  db: Queryable,
  data: { id: string; sectorId: string; code: string; name: string },
): Promise<void> {
  await db.execute(sql`
    INSERT INTO teams (id, sector_id, code, name)
    VALUES (${data.id}, ${data.sectorId}, ${data.code}, ${data.name})`);
}

export async function updateTeamRow(
  db: Queryable,
  id: string,
  data: { name: string; isActive: boolean; deactivatedAt: Date | null },
): Promise<void> {
  await db.execute(sql`
    UPDATE teams
    SET name = ${data.name}, is_active = ${data.isActive}, deactivated_at = ${data.deactivatedAt}
    WHERE id = ${id}`);
}

/** Equipes informadas, com o setor e o hospital (validação de escopo do dashboard). */
export async function findTeamsByIds(
  db: Queryable,
  ids: readonly string[],
): Promise<
  { id: string; sectorId: string; name: string; isActive: boolean; hospitalId: string }[]
> {
  if (ids.length === 0) return [];
  const rows = await db.query<{
    id: string;
    sector_id: string;
    name: string;
    is_active: boolean;
    hospital_id: string;
  }>(sql`
    SELECT t.id, t.sector_id, t.name, t.is_active, s.hospital_id
    FROM teams t JOIN sectors s ON s.id = t.sector_id
    WHERE t.id IN (${sql.list(ids)})
    ORDER BY t.name, t.id`);
  return rows.map((row) => ({
    id: row.id,
    sectorId: row.sector_id,
    name: row.name,
    isActive: row.is_active,
    hospitalId: row.hospital_id,
  }));
}

/** Equipes dos setores informados (importação de escala). */
export async function findTeamsOfSectors(
  db: Queryable,
  sectorIds: readonly string[],
): Promise<{ id: string; sectorId: string; code: string; isActive: boolean }[]> {
  if (sectorIds.length === 0) return [];
  const rows = await db.query<{ id: string; sector_id: string; code: string; is_active: boolean }>(
    sql`SELECT id, sector_id, code, is_active FROM teams WHERE sector_id IN (${sql.list(sectorIds)})`,
  );
  return rows.map((row) => ({
    id: row.id,
    sectorId: row.sector_id,
    code: row.code,
    isActive: row.is_active,
  }));
}

/** Bloqueia a linha da equipe (serializa cadastros de turnos da mesma equipe). */
export async function lockTeam(db: Queryable, id: string): Promise<void> {
  await db.query(sql`SELECT id FROM teams WHERE id = ${id} FOR UPDATE`);
}

export interface JourneyStageRecord {
  id: string;
  code: string;
  name: string;
  position: number;
  isActive: boolean;
}

export async function listJourneyStageRecords(
  db: Queryable,
  hospitalId: string,
): Promise<JourneyStageRecord[]> {
  const rows = await db.query<{
    id: string;
    code: string;
    name: string;
    position: number;
    is_active: boolean;
  }>(sql`
    SELECT id, code, name, position, is_active FROM journey_stages
    WHERE hospital_id = ${hospitalId}
    ORDER BY position`);
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    position: row.position,
    isActive: row.is_active,
  }));
}

/** Etapas ativas do hospital entre as informadas. */
export async function findActiveStageIds(
  db: Queryable,
  hospitalId: string,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.query<{ id: string }>(sql`
    SELECT id FROM journey_stages
    WHERE id IN (${sql.list(ids)}) AND hospital_id = ${hospitalId} AND is_active`);
  return new Set(rows.map((row) => row.id));
}
