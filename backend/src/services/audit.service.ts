import { createHmac } from 'node:crypto';

import type { TransactionClient, UserRole } from '../lib/prisma.js';

/**
 * Catálogo de ações auditadas (RF10, RN16, Seção 10), agrupado pela etapa que o introduziu.
 * ET03: usuários, senha e negativas de autorização.
 */
export const ACCESS_AUDIT_ACTIONS = [
  'USER_CREATED',
  'USER_UPDATED',
  'USER_DEACTIVATED',
  'USER_REACTIVATED',
  'USER_PASSWORD_RESET',
  'PASSWORD_CHANGED',
  'AUTHORIZATION_DENIED',
] as const;

/** ET04: setores, equipes, turnos e importações de escala. */
export const STRUCTURE_AUDIT_ACTIONS = [
  'SECTOR_CREATED',
  'SECTOR_UPDATED',
  'SECTOR_DEACTIVATED',
  'SECTOR_REACTIVATED',
  'TEAM_CREATED',
  'TEAM_UPDATED',
  'TEAM_DEACTIVATED',
  'TEAM_REACTIVATED',
  'SHIFT_CREATED',
  'SHIFT_CANCELLED',
  'ROSTER_IMPORT_VALIDATED',
  'ROSTER_IMPORT_REJECTED',
  'ROSTER_IMPORT_COMMITTED',
] as const;

/** ET05: pesquisas, perguntas e publicação. */
export const SURVEY_AUDIT_ACTIONS = [
  'SURVEY_CREATED',
  'SURVEY_UPDATED',
  'SURVEY_DEACTIVATED',
  'SURVEY_REACTIVATED',
  'SURVEY_PUBLISHED',
] as const;

export const AUDIT_ACTIONS = [
  ...ACCESS_AUDIT_ACTIONS,
  ...STRUCTURE_AUDIT_ACTIONS,
  ...SURVEY_AUDIT_ACTIONS,
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Tipos de entidade registrados em audit_logs.entity_type. */
export const AUDIT_ENTITY_TYPES = [
  'profile',
  'endpoint',
  'sector',
  'team',
  'shift',
  'shift_import',
  'survey_config',
] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

type DetailValue = string | number | boolean | null | readonly string[];
export type AuditDetails = Readonly<Record<string, DetailValue>>;

/** Quem executou a ação e de qual requisição ela partiu. */
export interface AuditContext {
  actor: { profileId: string; role: UserRole } | null;
  requestId?: string | undefined;
  ipHash?: string | undefined;
}

export interface AuditEntry {
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | undefined;
  sectorId?: string | undefined;
  details?: AuditDetails;
}

/**
 * Chaves que nunca podem aparecer nos detalhes (Seção 10: sem senhas, tokens, segredos ou dados
 * pessoais). A verificação lança erro e, como a auditoria roda na transação da operação, a
 * operação inteira é desfeita (RN16).
 */
const FORBIDDEN_DETAIL_KEY =
  /pass|senha|token|secret|segredo|key|email|e-mail|phone|telefone|name|nome|cpf|ip$|contact|contato|description|descri/i;

export class UnsafeAuditDetailsError extends Error {
  constructor(key: string) {
    super(`Campo não permitido nos detalhes da auditoria: ${key}`);
    this.name = 'UnsafeAuditDetailsError';
  }
}

export function assertSafeDetails(details: AuditDetails): void {
  for (const key of Object.keys(details)) {
    if (FORBIDDEN_DETAIL_KEY.test(key)) throw new UnsafeAuditDetailsError(key);
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Grava um registro em audit_logs com o cliente da transação da operação de negócio: se a
 * auditoria falhar, a operação é desfeita; audit_logs aceita somente inserção (RN16).
 */
export async function recordAudit(
  tx: Pick<TransactionClient, 'auditLog'>,
  context: AuditContext,
  entry: AuditEntry,
): Promise<void> {
  const details = entry.details ?? {};
  assertSafeDetails(details);
  await tx.auditLog.create({
    data: {
      actorProfileId: context.actor?.profileId ?? null,
      actorRole: context.actor?.role ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      sectorId: entry.sectorId ?? null,
      details,
      requestId:
        context.requestId !== undefined && UUID_PATTERN.test(context.requestId)
          ? context.requestId
          : null,
      ipHash: context.ipHash ?? null,
    },
  });
}

/** HMAC-SHA256 do IP com AUDIT_IP_SECRET (Seção 10); sem segredo configurado, nada é gravado. */
export function hashIp(ip: string | undefined, secret: string | undefined): string | undefined {
  if (ip === undefined || ip === '' || secret === undefined) return undefined;
  return createHmac('sha256', secret).update(ip).digest('hex');
}
