/** Acesso a dados dos turnos (shifts) e das importações de escala (shift_imports). */
import type { Queryable } from '../../lib/database.js';
import type { ImportStatus, JsonValue, ShiftPeriod, ShiftSource } from '../../lib/domain-types.js';
import { sql, type SqlStatement } from '../../lib/sql.js';

export interface ShiftRecord {
  id: string;
  sectorId: string;
  period: ShiftPeriod;
  source: ShiftSource;
  importId: string | null;
  startsAt: Date;
  endsAt: Date;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  team: { id: string; code: string; name: string; isActive: boolean };
}

interface ShiftRow {
  id: string;
  sector_id: string;
  period: ShiftPeriod;
  source: ShiftSource;
  import_id: string | null;
  starts_at: Date;
  ends_at: Date;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  created_at: Date;
  team_id: string;
  team_code: string;
  team_name: string;
  team_is_active: boolean;
}

const SHIFT_SELECT = sql`
  SELECT sh.id, sh.sector_id, sh.period, sh.source, sh.import_id, sh.starts_at, sh.ends_at,
         sh.cancelled_at, sh.cancel_reason, sh.created_at,
         t.id AS team_id, t.code AS team_code, t.name AS team_name, t.is_active AS team_is_active
  FROM shifts sh JOIN teams t ON t.id = sh.team_id`;

function toRecord(row: ShiftRow): ShiftRecord {
  return {
    id: row.id,
    sectorId: row.sector_id,
    period: row.period,
    source: row.source,
    importId: row.import_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    createdAt: row.created_at,
    team: {
      id: row.team_id,
      code: row.team_code,
      name: row.team_name,
      isActive: row.team_is_active,
    },
  };
}

export async function findShift(db: Queryable, id: string): Promise<ShiftRecord | null> {
  const [row] = await db.query<ShiftRow>(sql`${SHIFT_SELECT} WHERE sh.id = ${id}`);
  return row === undefined ? null : toRecord(row);
}

/** Turnos do setor que começam antes de `toExclusive` e terminam depois de `from` (RF20). */
export async function listShiftRecords(
  db: Queryable,
  filters: {
    sectorId: string;
    from: Date;
    toExclusive: Date;
    teamId?: string | undefined;
    includeCancelled: boolean;
  },
): Promise<ShiftRecord[]> {
  const conditions: SqlStatement[] = [
    sql`sh.sector_id = ${filters.sectorId}`,
    sql`sh.starts_at < ${filters.toExclusive}`,
    sql`sh.ends_at > ${filters.from}`,
  ];
  if (filters.teamId !== undefined) conditions.push(sql`sh.team_id = ${filters.teamId}`);
  if (!filters.includeCancelled) conditions.push(sql`sh.cancelled_at IS NULL`);
  const rows = await db.query<ShiftRow>(sql`
    ${SHIFT_SELECT}
    WHERE ${sql.join(conditions, ' AND ')}
    ORDER BY sh.starts_at, t.name, sh.id`);
  return rows.map(toRecord);
}

/**
 * Turno não cancelado da equipe que se sobrepõe ao intervalo (mesma regra do gatilho
 * shifts_no_overlap_per_team), para responder 409 antes de chegar ao banco.
 */
export async function findOverlappingShiftId(
  db: Queryable,
  teamId: string,
  startsAt: Date,
  endsAt: Date,
): Promise<string | null> {
  const [row] = await db.query<{ id: string }>(sql`
    SELECT id FROM shifts
    WHERE team_id = ${teamId} AND cancelled_at IS NULL
      AND starts_at < ${endsAt} AND ends_at > ${startsAt}
    LIMIT 1`);
  return row?.id ?? null;
}

/** Turnos não cancelados das equipes que tocam o intervalo (sobreposição na importação). */
export async function findActiveShiftsOfTeams(
  db: Queryable,
  teamIds: readonly string[],
  startsBefore: Date,
  endsAfter: Date,
): Promise<{ teamId: string; startsAt: Date; endsAt: Date }[]> {
  if (teamIds.length === 0) return [];
  const rows = await db.query<{ team_id: string; starts_at: Date; ends_at: Date }>(sql`
    SELECT team_id, starts_at, ends_at FROM shifts
    WHERE team_id IN (${sql.list(teamIds)}) AND cancelled_at IS NULL
      AND starts_at < ${startsBefore} AND ends_at > ${endsAfter}`);
  return rows.map((row) => ({ teamId: row.team_id, startsAt: row.starts_at, endsAt: row.ends_at }));
}

export interface ShiftInsert {
  id: string;
  sectorId: string;
  teamId: string;
  period: ShiftPeriod;
  startsAt: Date;
  endsAt: Date;
  source: ShiftSource;
  importId: string | null;
  createdById: string;
}

/** Insere os turnos em lotes (a importação grava até 2.000 linhas). */
export async function insertShifts(db: Queryable, shifts: readonly ShiftInsert[]): Promise<number> {
  let inserted = 0;
  for (let start = 0; start < shifts.length; start += 500) {
    const rows = shifts.slice(start, start + 500).map(
      (shift) =>
        sql`(${shift.id}, ${shift.sectorId}, ${shift.teamId}, ${shift.period}, ${shift.startsAt},
               ${shift.endsAt}, ${shift.source}, ${shift.importId}, ${shift.createdById})`,
    );
    const result = await db.execute(sql`
      INSERT INTO shifts
        (id, sector_id, team_id, period, starts_at, ends_at, source, import_id, created_by)
      VALUES ${sql.join(rows, ', ')}`);
    inserted += result.affectedRows;
  }
  return inserted;
}

/** Turno com o hospital do setor, bloqueado para atualização (cancelamento). */
export async function lockShiftForCancellation(
  db: Queryable,
  id: string,
): Promise<{ sectorId: string; hospitalId: string; cancelledAt: Date | null } | null> {
  const [row] = await db.query<{
    sector_id: string;
    hospital_id: string;
    cancelled_at: Date | null;
  }>(
    sql`
      SELECT sh.sector_id, s.hospital_id, sh.cancelled_at
      FROM shifts sh JOIN sectors s ON s.id = sh.sector_id
      WHERE sh.id = ${id}
      FOR UPDATE`,
  );
  return row === undefined
    ? null
    : { sectorId: row.sector_id, hospitalId: row.hospital_id, cancelledAt: row.cancelled_at };
}

export async function cancelShiftRow(
  db: Queryable,
  id: string,
  data: { at: Date; by: string; reason: string },
): Promise<void> {
  await db.execute(sql`
    UPDATE shifts
    SET cancelled_at = ${data.at}, cancelled_by = ${data.by}, cancel_reason = ${data.reason}
    WHERE id = ${id}`);
}

// ---------------------------------------------------------------------------------------------
// Importações de escala
// ---------------------------------------------------------------------------------------------

export interface ShiftImportRecord {
  id: string;
  uploadedById: string;
  fileName: string;
  status: ImportStatus;
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  errors: JsonValue;
  stagedRows: JsonValue;
  expiresAt: Date;
  committedAt: Date | null;
  createdAt: Date;
}

export async function insertShiftImport(
  db: Queryable,
  data: {
    id: string;
    uploadedById: string;
    fileName: string;
    fileSha256: string;
    status: ImportStatus;
    totalRows: number;
    acceptedRows: number;
    rejectedRows: number;
    errors: unknown;
    stagedRows: unknown;
    createdAt: Date;
    expiresAt: Date;
  },
): Promise<void> {
  await db.execute(sql`
    INSERT INTO shift_imports
      (id, uploaded_by, file_name, file_sha256, status, total_rows, accepted_rows, rejected_rows,
       errors, staged_rows, created_at, expires_at)
    VALUES (${data.id}, ${data.uploadedById}, ${data.fileName}, ${data.fileSha256}, ${data.status},
            ${data.totalRows}, ${data.acceptedRows}, ${data.rejectedRows}, ${sql.json(data.errors)},
            ${sql.json(data.stagedRows)}, ${data.createdAt}, ${data.expiresAt})`);
}

/** Importação bloqueada para atualização (confirmação concorrente). */
export async function lockShiftImport(
  db: Queryable,
  id: string,
): Promise<ShiftImportRecord | null> {
  const [row] = await db.query<{
    id: string;
    uploaded_by: string;
    file_name: string;
    status: ImportStatus;
    total_rows: number;
    accepted_rows: number;
    rejected_rows: number;
    errors: JsonValue;
    staged_rows: JsonValue;
    expires_at: Date;
    committed_at: Date | null;
    created_at: Date;
  }>(sql`
    SELECT id, uploaded_by, file_name, status, total_rows, accepted_rows, rejected_rows, errors,
           staged_rows, expires_at, committed_at, created_at
    FROM shift_imports WHERE id = ${id}
    FOR UPDATE`);
  if (row === undefined) return null;
  return {
    id: row.id,
    uploadedById: row.uploaded_by,
    fileName: row.file_name,
    status: row.status,
    totalRows: row.total_rows,
    acceptedRows: row.accepted_rows,
    rejectedRows: row.rejected_rows,
    errors: row.errors,
    stagedRows: row.staged_rows,
    expiresAt: row.expires_at,
    committedAt: row.committed_at,
    createdAt: row.created_at,
  };
}

export async function markShiftImportCommitted(
  db: Queryable,
  id: string,
  data: { at: Date; by: string },
): Promise<void> {
  await db.execute(sql`
    UPDATE shift_imports
    SET status = 'committed', committed_at = ${data.at}, committed_by = ${data.by}
    WHERE id = ${id}`);
}

/** Equipes com o setor (resumo da importação). */
export async function findTeamSummaries(
  db: Queryable,
  teamIds: readonly string[],
): Promise<{ id: string; code: string; name: string; sectorCode: string; sectorName: string }[]> {
  if (teamIds.length === 0) return [];
  const rows = await db.query<{
    id: string;
    code: string;
    name: string;
    sector_code: string;
    sector_name: string;
  }>(sql`
    SELECT t.id, t.code, t.name, s.code AS sector_code, s.name AS sector_name
    FROM teams t JOIN sectors s ON s.id = t.sector_id
    WHERE t.id IN (${sql.list(teamIds)})`);
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    sectorCode: row.sector_code,
    sectorName: row.sector_name,
  }));
}
