/** Acesso a dados da trilha de auditoria (audit_logs: somente inserção e consulta). */
import { type Queryable, toNumber } from '../../lib/database.js';
import type { JsonValue, UserRole } from '../../lib/domain-types.js';
import { sql } from '../../lib/sql.js';

export interface AuditInsert {
  actorProfileId: string | null;
  actorRole: UserRole | null;
  action: string;
  entityType: string;
  entityId: string | null;
  sectorId: string | null;
  details: Readonly<Record<string, unknown>>;
  requestId: string | null;
  ipHash: string | null;
}

export async function insertAuditLog(db: Queryable, entry: AuditInsert): Promise<void> {
  await db.execute(sql`
    INSERT INTO audit_logs
      (actor_profile_id, actor_role, action, entity_type, entity_id, sector_id, details, request_id, ip_hash)
    VALUES (${entry.actorProfileId}, ${entry.actorRole}, ${entry.action}, ${entry.entityType},
            ${entry.entityId}, ${entry.sectorId}, ${sql.json(entry.details)}, ${entry.requestId},
            ${entry.ipHash})`);
}

export interface AuditLogRecord {
  id: string;
  occurredAt: Date;
  actorProfileId: string | null;
  actorFullName: string | null;
  actorRole: UserRole | null;
  action: string;
  entityType: string;
  entityId: string | null;
  sectorId: string | null;
  details: JsonValue;
  requestId: string | null;
}

export interface AuditLogFilters {
  hospitalId: string;
  from: Date;
  toExclusive: Date;
  actorProfileId?: string | undefined;
  action?: string | undefined;
  entityType?: string | undefined;
  entityId?: string | undefined;
  offset: number;
  limit: number;
}

/** Eventos sem autor ou de autores do hospital, no período, em ordem decrescente (E41). */
export async function listAuditLogRecords(
  db: Queryable,
  filters: AuditLogFilters,
): Promise<{ items: AuditLogRecord[]; total: number }> {
  const conditions = [
    sql`(a.actor_profile_id IS NULL OR p.hospital_id = ${filters.hospitalId})`,
    sql`a.occurred_at >= ${filters.from}`,
    sql`a.occurred_at < ${filters.toExclusive}`,
  ];
  if (filters.actorProfileId !== undefined) {
    conditions.push(sql`a.actor_profile_id = ${filters.actorProfileId}`);
  }
  if (filters.action !== undefined) conditions.push(sql`a.action = ${filters.action}`);
  if (filters.entityType !== undefined) conditions.push(sql`a.entity_type = ${filters.entityType}`);
  if (filters.entityId !== undefined) conditions.push(sql`a.entity_id = ${filters.entityId}`);
  const where = sql.join(conditions, ' AND ');
  const from = sql`audit_logs a LEFT JOIN profiles p ON p.id = a.actor_profile_id`;

  const [rows, totals] = await Promise.all([
    db.query<{
      id: number | string;
      occurred_at: Date;
      actor_profile_id: string | null;
      actor_full_name: string | null;
      actor_role: UserRole | null;
      action: string;
      entity_type: string;
      entity_id: string | null;
      sector_id: string | null;
      details: JsonValue;
      request_id: string | null;
    }>(sql`
      SELECT a.id, a.occurred_at, a.actor_profile_id, p.full_name AS actor_full_name, a.actor_role,
             a.action, a.entity_type, a.entity_id, a.sector_id, a.details, a.request_id
      FROM ${from}
      WHERE ${where}
      ORDER BY a.occurred_at DESC, a.id DESC
      LIMIT ${filters.limit} OFFSET ${filters.offset}`),
    db.query<{ total: number }>(sql`SELECT COUNT(*) AS total FROM ${from} WHERE ${where}`),
  ]);
  return {
    items: rows.map((row) => ({
      id: String(row.id),
      occurredAt: row.occurred_at,
      actorProfileId: row.actor_profile_id,
      actorFullName: row.actor_full_name,
      actorRole: row.actor_role,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      sectorId: row.sector_id,
      details: row.details,
      requestId: row.request_id,
    })),
    total: toNumber(totals[0]?.total ?? 0),
  };
}

/** Instante da última redefinição assistida de senha do perfil (E09), se houver. */
export async function findLastPasswordReset(
  db: Queryable,
  profileId: string,
): Promise<Date | null> {
  const [row] = await db.query<{ occurred_at: Date }>(sql`
    SELECT occurred_at FROM audit_logs
    WHERE action = 'USER_PASSWORD_RESET' AND entity_type = 'profile' AND entity_id = ${profileId}
    ORDER BY occurred_at DESC, id DESC
    LIMIT 1`);
  return row?.occurred_at ?? null;
}
