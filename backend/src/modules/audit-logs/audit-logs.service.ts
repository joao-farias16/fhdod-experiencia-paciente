import type { Prisma, PrismaClient, UserRole } from '../../lib/prisma.js';
import { addDays, localDateOf, startOfLocalDay } from '../../utils/dates.js';
import { AUDIT_DEFAULT_RANGE_DAYS, type ListAuditLogsQuery } from './audit-logs.schemas.js';

export interface AuditLogDto {
  id: string;
  occurredAt: string;
  actor: { id: string; fullName: string; role: UserRole | null } | null;
  action: string;
  entityType: string;
  entityId: string | null;
  sectorId: string | null;
  details: Prisma.JsonValue;
  requestId: string | null;
}

/** Período efetivo (datas locais inclusivas), completando o que não foi informado. */
export function resolvePeriod(query: ListAuditLogsQuery, now: Date): { from: string; to: string } {
  const span = AUDIT_DEFAULT_RANGE_DAYS - 1;
  if (query.from !== undefined && query.to !== undefined) return { from: query.from, to: query.to };
  if (query.from !== undefined) {
    const to = addDays(query.from, span);
    const today = localDateOf(now);
    return { from: query.from, to: to > today ? today : to };
  }
  const to = query.to ?? localDateOf(now);
  return { from: addDays(to, -span), to };
}

/**
 * E41 — trilha de auditoria (RF11): eventos em ordem decrescente, filtrados por período (fuso do
 * hospital, limites inclusivos), autor, ação e entidade. Somente eventos de autores do hospital
 * do SA (ou sem autor). O IP (HMAC) não é devolvido.
 */
export async function listAuditLogs(
  prisma: Pick<PrismaClient, 'auditLog'>,
  hospitalId: string,
  query: ListAuditLogsQuery,
  now: Date,
): Promise<{ items: AuditLogDto[]; total: number; period: { from: string; to: string } }> {
  const period = resolvePeriod(query, now);
  const where: Prisma.AuditLogWhereInput = {
    OR: [{ actorProfileId: null }, { actorProfile: { hospitalId } }],
    occurredAt: { gte: startOfLocalDay(period.from), lt: startOfLocalDay(addDays(period.to, 1)) },
    ...(query.actorProfileId === undefined ? {} : { actorProfileId: query.actorProfileId }),
    ...(query.action === undefined ? {} : { action: query.action }),
    ...(query.entityType === undefined ? {} : { entityType: query.entityType }),
    ...(query.entityId === undefined ? {} : { entityId: query.entityId }),
  };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        occurredAt: true,
        actorProfileId: true,
        actorRole: true,
        action: true,
        entityType: true,
        entityId: true,
        sectorId: true,
        details: true,
        requestId: true,
        actorProfile: { select: { fullName: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);
  const items = rows.map((row): AuditLogDto => ({
    id: row.id.toString(),
    occurredAt: row.occurredAt.toISOString(),
    actor:
      row.actorProfileId === null
        ? null
        : {
            id: row.actorProfileId,
            fullName: row.actorProfile?.fullName ?? '',
            role: row.actorRole,
          },
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    sectorId: row.sectorId,
    details: row.details,
    requestId: row.requestId,
  }));
  return { items, total, period };
}
