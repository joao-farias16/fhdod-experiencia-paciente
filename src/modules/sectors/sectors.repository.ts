/** Acesso a dados dos setores (tabela sectors), com SQL parametrizado. */
import { type Queryable, toNumber } from '../../lib/database.js';
import { containsPattern, sql } from '../../lib/sql.js';

export interface SectorRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  deactivatedAt: Date | null;
  activeTeams: number;
  activeSurveys: number;
}

interface SectorRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
  deactivated_at: Date | null;
  active_teams: number;
  active_surveys: number;
}

/** Setor com as contagens de equipes e pesquisas ativas (RF13). */
const SECTOR_COLUMNS = sql`
  s.id, s.code, s.name, s.description, s.is_active, s.deactivated_at,
  (SELECT COUNT(*) FROM teams t WHERE t.sector_id = s.id AND t.is_active) AS active_teams,
  (SELECT COUNT(*) FROM survey_configs c WHERE c.sector_id = s.id AND c.is_active) AS active_surveys`;

function toRecord(row: SectorRow): SectorRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    isActive: row.is_active,
    deactivatedAt: row.deactivated_at,
    activeTeams: toNumber(row.active_teams),
    activeSurveys: toNumber(row.active_surveys),
  };
}

export async function findSector(
  db: Queryable,
  hospitalId: string,
  id: string,
): Promise<SectorRecord | null> {
  const [row] = await db.query<SectorRow>(sql`
    SELECT ${SECTOR_COLUMNS} FROM sectors s WHERE s.id = ${id} AND s.hospital_id = ${hospitalId}`);
  return row === undefined ? null : toRecord(row);
}

export interface SectorListFilters {
  /** undefined = todos os setores do hospital. */
  sectorIds: readonly string[] | undefined;
  isActive?: boolean | undefined;
  search?: string | undefined;
}

export async function listSectorRecords(
  db: Queryable,
  hospitalId: string,
  filters: SectorListFilters,
): Promise<SectorRecord[]> {
  if (filters.sectorIds?.length === 0) return [];
  const conditions = [sql`s.hospital_id = ${hospitalId}`];
  if (filters.sectorIds !== undefined)
    conditions.push(sql`s.id IN (${sql.list(filters.sectorIds)})`);
  if (filters.isActive !== undefined) conditions.push(sql`s.is_active = ${filters.isActive}`);
  if (filters.search !== undefined) {
    const pattern = containsPattern(filters.search.toLowerCase());
    conditions.push(sql`(LOWER(s.name) LIKE ${pattern} OR LOWER(s.code) LIKE ${pattern})`);
  }
  const rows = await db.query<SectorRow>(sql`
    SELECT ${SECTOR_COLUMNS} FROM sectors s
    WHERE ${sql.join(conditions, ' AND ')}
    ORDER BY s.name, s.id`);
  return rows.map(toRecord);
}

export async function findSectorIdByCode(
  db: Queryable,
  hospitalId: string,
  code: string,
): Promise<string | null> {
  const [row] = await db.query<{ id: string }>(sql`
    SELECT id FROM sectors WHERE hospital_id = ${hospitalId} AND code = ${code}`);
  return row?.id ?? null;
}

/** Nome já usado no hospital, sem distinguir maiúsculas (sectors_hospital_id_lower_name_key). */
export async function findSectorIdByName(
  db: Queryable,
  hospitalId: string,
  name: string,
  exceptId?: string,
): Promise<string | null> {
  const [row] = await db.query<{ id: string }>(sql`
    SELECT id FROM sectors
    WHERE hospital_id = ${hospitalId} AND LOWER(name) = LOWER(${name})
      ${exceptId === undefined ? sql.empty : sql`AND id <> ${exceptId}`}
    LIMIT 1`);
  return row?.id ?? null;
}

export async function insertSector(
  db: Queryable,
  data: { id: string; hospitalId: string; code: string; name: string; description: string | null },
): Promise<void> {
  await db.execute(sql`
    INSERT INTO sectors (id, hospital_id, code, name, description)
    VALUES (${data.id}, ${data.hospitalId}, ${data.code}, ${data.name}, ${data.description})`);
}

export async function updateSectorRow(
  db: Queryable,
  id: string,
  data: { name: string; description: string | null; isActive: boolean; deactivatedAt: Date | null },
): Promise<void> {
  await db.execute(sql`
    UPDATE sectors
    SET name = ${data.name}, description = ${data.description}, is_active = ${data.isActive},
        deactivated_at = ${data.deactivatedAt}
    WHERE id = ${id}`);
}

/** Situação do setor do hospital (null: inexistente ou de outro hospital). */
export async function findSectorState(
  db: Queryable,
  hospitalId: string,
  id: string,
): Promise<{ isActive: boolean } | null> {
  const [row] = await db.query<{ is_active: boolean }>(sql`
    SELECT is_active FROM sectors WHERE id = ${id} AND hospital_id = ${hospitalId}`);
  return row === undefined ? null : { isActive: row.is_active };
}

/** Setores do hospital entre os informados, com a situação (vínculos de usuário, RF08). */
export async function findSectorsByIds(
  db: Queryable,
  ids: readonly string[],
  hospitalId?: string,
): Promise<{ id: string; name: string; isActive: boolean }[]> {
  if (ids.length === 0) return [];
  const rows = await db.query<{ id: string; name: string; is_active: boolean }>(sql`
    SELECT id, name, is_active FROM sectors
    WHERE id IN (${sql.list(ids)})
      ${hospitalId === undefined ? sql.empty : sql`AND hospital_id = ${hospitalId}`}
    ORDER BY name, id`);
  return rows.map((row) => ({ id: row.id, name: row.name, isActive: row.is_active }));
}

/** Setores do hospital pelos códigos (importação de escala). */
export async function findSectorsByCodes(
  db: Queryable,
  hospitalId: string,
  codes: readonly string[],
): Promise<{ id: string; code: string; isActive: boolean }[]> {
  if (codes.length === 0) return [];
  const rows = await db.query<{ id: string; code: string; is_active: boolean }>(sql`
    SELECT id, code, is_active FROM sectors
    WHERE hospital_id = ${hospitalId} AND code IN (${sql.list(codes)})`);
  return rows.map((row) => ({ id: row.id, code: row.code, isActive: row.is_active }));
}
