import { randomUUID } from 'node:crypto';

import type { Database, Queryable } from '../../lib/database.js';
import type {
  ManifestationEventKind,
  ManifestationPriority,
  ManifestationStatus,
  ManifestationType,
} from '../../lib/domain-types.js';
import { addDays, type Clock, startOfLocalDay } from '../../utils/dates.js';
import { HttpError } from '../../utils/errors.js';
import { resolvePeriod } from '../../utils/validation.js';
import { type AuditContext, recordAudit } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { resolveSectorFilter, resourceNotFound } from '../auth/scope.js';
import {
  ACTIONS_MIN,
  canTransition,
  type CONTACT_DELETION_REASONS,
  type ListManifestationsQuery,
  PURPOSE_TEXT,
  STATUS_TRANSITIONS,
  type UpdateManifestationInput,
} from './manifestations.schemas.js';
import {
  countManifestations,
  deleteContactRow,
  findContact,
  findManifestationDetail,
  findManifestationState,
  findNote,
  insertNotes,
  listManifestationRows,
  type ManifestationState,
  type NoteInsert,
  updateManifestationTreatment,
} from './manifestations.repository.js';

/** E35 — trecho da descrição exibido na lista (Seção 8). */
export const EXCERPT_LENGTH = 120;

export interface ManifestationListItemDto {
  id: string;
  protocol: string;
  receivedAt: string;
  updatedAt: string;
  sector: { id: string; name: string };
  type: ManifestationType;
  status: ManifestationStatus;
  priority: ManifestationPriority;
  excerpt: string;
  isAnonymous: boolean;
  hasContact: boolean;
  triggeredByLowScore: boolean;
}

export interface TimelineEventDto {
  id: string;
  kind: ManifestationEventKind;
  content: string | null;
  fromValue: string | null;
  toValue: string | null;
  createdAt: string;
  author: { id: string; fullName: string } | null;
}

export interface ManifestationDetailDto extends Omit<ManifestationListItemDto, 'excerpt'> {
  description: string;
  actionsTaken: string | null;
  resolvedAt: string | null;
  allowedTransitions: readonly ManifestationStatus[];
  response: {
    id: string;
    submittedAt: string;
    origin: 'qr_code' | 'link';
    npsScore: number;
    lowScore: boolean;
    survey: { title: string; versionNumber: number };
    answers: { questionText: string; journeyStageName: string | null; score: number }[];
  };
  timeline: TimelineEventDto[];
}

function excerptOf(description: string): string {
  return description.length <= EXCERPT_LENGTH ? description : description.slice(0, EXCERPT_LENGTH);
}

/**
 * E35 — lista da Ouvidoria (RF44): interseção entre filtros e escopo (RN10), trecho de 120
 * caracteres e somente a existência do contato, nunca seus dados (Seção 8).
 */
export async function listManifestations(
  db: Queryable,
  auth: AuthContext,
  query: ListManifestationsQuery,
  now: Date,
): Promise<{
  items: ManifestationListItemDto[];
  total: number;
  period: { from: string; to: string };
}> {
  const period = resolvePeriod(query, now);
  const filters = {
    hospitalId: auth.hospitalId,
    sectorIds: resolveSectorFilter(auth.scope, query.sectorIds),
    from: startOfLocalDay(period.from),
    toExclusive: startOfLocalDay(addDays(period.to, 1)),
    status: query.status,
    type: query.type,
    priority: query.priority,
    protocol: query.protocol,
    hasContact: query.hasContact,
  };
  const [rows, total] = await Promise.all([
    listManifestationRows(db, filters, {
      sort: query.sort,
      offset: (query.page - 1) * query.pageSize,
      limit: query.pageSize,
    }),
    countManifestations(db, filters),
  ]);
  return {
    items: rows.map((row) => ({
      id: row.id,
      protocol: row.protocol,
      receivedAt: row.receivedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      sector: row.sector,
      type: row.type,
      status: row.status,
      priority: row.priority,
      excerpt: excerptOf(row.description),
      isAnonymous: row.isAnonymous,
      hasContact: row.hasContact,
      triggeredByLowScore: row.triggeredByLowScore,
    })),
    total,
    period,
  };
}

/** Manifestação do escopo e do hospital; fora do escopo ou inexistente → 404 (RN10). */
async function findInScope(
  tx: Queryable,
  auth: AuthContext,
  id: string,
): Promise<ManifestationState> {
  const row = await findManifestationState(
    tx,
    id,
    auth.hospitalId,
    resolveSectorFilter(auth.scope),
  );
  if (row === null) throw resourceNotFound();
  return row;
}

async function loadDetail(tx: Queryable, id: string): Promise<ManifestationDetailDto> {
  const detail = await findManifestationDetail(tx, id);
  if (detail === null) throw resourceNotFound();
  const row = detail.manifestation;
  return {
    id: row.id,
    protocol: row.protocol,
    receivedAt: row.receivedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    sector: row.sector,
    type: row.type,
    status: row.status,
    priority: row.priority,
    description: row.description,
    actionsTaken: row.actionsTaken,
    isAnonymous: row.isAnonymous,
    hasContact: row.hasContact,
    triggeredByLowScore: row.triggeredByLowScore,
    allowedTransitions: STATUS_TRANSITIONS[row.status],
    response: {
      ...detail.response,
      submittedAt: detail.response.submittedAt.toISOString(),
    },
    timeline: detail.timeline.map((note) => ({
      ...note,
      createdAt: note.createdAt.toISOString(),
    })),
  };
}

/**
 * E36 — detalhe com texto, resposta vinculada e linha do tempo completa e ordenada, sem o contato
 * (RF45). Cada consulta é auditada na mesma transação (MANIFESTATION_VIEWED).
 */
export async function getManifestation(
  db: Database,
  auth: AuthContext,
  audit: AuditContext,
  id: string,
): Promise<ManifestationDetailDto> {
  return db.transaction(async (tx) => {
    const found = await findInScope(tx, auth, id);
    await recordAudit(tx, audit, {
      action: 'MANIFESTATION_VIEWED',
      entityType: 'manifestation',
      entityId: id,
      sectorId: found.sectorId,
    });
    return loadDetail(tx, id);
  });
}

function stale(): HttpError {
  return new HttpError(
    409,
    'STALE_RESOURCE',
    'A manifestação foi alterada por outra pessoa. Recarregue para ver a versão atual.',
  );
}

/**
 * E37 — status (RN23), prioridade e providências (RF46), com concorrência otimista por updatedAt:
 * versão divergente → 409 STALE_RESOURCE. Transição inválida → 422 INVALID_STATUS_TRANSITION;
 * concluir sem providências de 10+ caracteres → 422 ACTIONS_REQUIRED; arquivar sem nota → 422
 * NOTE_REQUIRED. Cada mudança vira um evento na linha do tempo, na mesma transação da auditoria.
 */
export async function updateManifestation(
  db: Database,
  clock: Clock,
  auth: AuthContext,
  audit: AuditContext,
  id: string,
  patch: UpdateManifestationInput,
): Promise<ManifestationDetailDto> {
  return db.transaction(async (tx) => {
    const current = await findInScope(tx, auth, id);
    if (current.updatedAt.getTime() !== new Date(patch.updatedAt).getTime()) throw stale();

    const status =
      patch.status !== undefined && patch.status !== current.status ? patch.status : undefined;
    if (patch.status !== undefined && status === undefined) {
      throw new HttpError(422, 'INVALID_STATUS_TRANSITION', 'A manifestação já está neste status.');
    }
    if (status !== undefined && !canTransition(current.status, status)) {
      throw new HttpError(
        422,
        'INVALID_STATUS_TRANSITION',
        'Esta mudança de status não é permitida.',
      );
    }
    const actionsTaken =
      patch.actionsTaken !== undefined && patch.actionsTaken !== current.actionsTaken
        ? patch.actionsTaken
        : undefined;
    const priority =
      patch.priority !== undefined && patch.priority !== current.priority
        ? patch.priority
        : undefined;
    const finalActions = actionsTaken ?? current.actionsTaken;
    if (
      status === 'resolved' &&
      (finalActions === null || finalActions.trim().length < ACTIONS_MIN)
    ) {
      throw new HttpError(
        422,
        'ACTIONS_REQUIRED',
        `Para concluir, descreva as providências com pelo menos ${ACTIONS_MIN} caracteres.`,
      );
    }
    if (status === 'archived' && patch.note === undefined) {
      throw new HttpError(422, 'NOTE_REQUIRED', 'Para arquivar, registre uma nota com o motivo.');
    }

    const now = clock.now();
    const updated = await updateManifestationTreatment(tx, id, current.updatedAt, {
      ...(status === undefined ? {} : { status, resolvedAt: status === 'resolved' ? now : null }),
      ...(priority === undefined ? {} : { priority }),
      ...(actionsTaken === undefined ? {} : { actionsTaken }),
      updatedById: auth.profileId,
      updatedAt: now,
    });
    if (!updated) throw stale();

    const events: Omit<NoteInsert, 'id' | 'createdAt'>[] = [];
    const base = {
      manifestationId: id,
      authorId: auth.profileId,
      content: null,
      fromValue: null,
      toValue: null,
    };
    if (actionsTaken !== undefined) {
      events.push({ ...base, kind: 'actions_updated', content: actionsTaken });
    }
    if (priority !== undefined) {
      events.push({
        ...base,
        kind: 'priority_changed',
        fromValue: current.priority,
        toValue: priority,
      });
    }
    if (patch.note !== undefined) events.push({ ...base, kind: 'note', content: patch.note });
    if (status !== undefined) {
      events.push({ ...base, kind: 'status_changed', fromValue: current.status, toValue: status });
    }
    // Mesmo instante para todos: a ordem por id não é cronológica, então os eventos de uma
    // alteração recebem milissegundos consecutivos na ordem acima.
    await insertNotes(
      tx,
      events.map((event, index) => ({
        ...event,
        id: randomUUID(),
        createdAt: new Date(now.getTime() + index),
      })),
    );
    await recordAudit(tx, audit, {
      action: 'MANIFESTATION_UPDATED',
      entityType: 'manifestation',
      entityId: id,
      sectorId: current.sectorId,
      details: {
        fromStatus: current.status,
        toStatus: status ?? current.status,
        fromPriority: current.priority,
        toPriority: priority ?? current.priority,
        actionsUpdated: actionsTaken !== undefined,
        noteAdded: patch.note !== undefined,
      },
    });
    return loadDetail(tx, id);
  });
}

/** E38 — nota interna não editável, exibida com autor e data (RF47). */
export async function addNote(
  db: Database,
  clock: Clock,
  auth: AuthContext,
  audit: AuditContext,
  id: string,
  content: string,
): Promise<TimelineEventDto> {
  return db.transaction(async (tx) => {
    const found = await findInScope(tx, auth, id);
    const noteId = randomUUID();
    await insertNotes(tx, [
      {
        id: noteId,
        manifestationId: id,
        authorId: auth.profileId,
        kind: 'note',
        content,
        fromValue: null,
        toValue: null,
        createdAt: clock.now(),
      },
    ]);
    const note = await findNote(tx, noteId);
    if (note === null) throw resourceNotFound();
    await recordAudit(tx, audit, {
      action: 'MANIFESTATION_NOTE_ADDED',
      entityType: 'manifestation',
      entityId: id,
      sectorId: found.sectorId,
      details: { eventId: note.id },
    });
    return { ...note, createdAt: note.createdAt.toISOString() };
  });
}

export interface ContactDto {
  fullName: string;
  phone: string | null;
  email: string | null;
  consentGivenAt: string;
  purposeTextVersion: string;
  purposeText: string;
}

function contactNotFound(): HttpError {
  return new HttpError(404, 'NOT_FOUND', 'Esta manifestação não tem dados de contato.');
}

/**
 * E39 — contato por ação explícita (RF48): 404 sem contato; cada consulta gera um registro de
 * auditoria gravado ANTES da leitura, na mesma transação (sem auditoria, nada é exibido).
 */
export async function getContact(
  db: Database,
  auth: AuthContext,
  audit: AuditContext,
  id: string,
): Promise<ContactDto> {
  return db.transaction(async (tx) => {
    const found = await findInScope(tx, auth, id);
    if (!found.hasContact) throw contactNotFound();
    await recordAudit(tx, audit, {
      action: 'MANIFESTATION_CONTACT_VIEWED',
      entityType: 'manifestation',
      entityId: id,
      sectorId: found.sectorId,
    });
    const contact = await findContact(tx, id);
    if (contact === null) throw contactNotFound();
    return {
      ...contact,
      consentGivenAt: contact.consentGivenAt.toISOString(),
      purposeText: PURPOSE_TEXT,
    };
  });
}

/**
 * E40 — eliminação do contato mantendo manifestação e histórico (RF49): exclui a linha de
 * manifestation_contacts, registra o evento contact_deleted com o motivo e audita. Sem contato → 404.
 */
export async function deleteContact(
  db: Database,
  clock: Clock,
  auth: AuthContext,
  audit: AuditContext,
  id: string,
  reason: (typeof CONTACT_DELETION_REASONS)[number],
): Promise<void> {
  await db.transaction(async (tx) => {
    const found = await findInScope(tx, auth, id);
    const removed = await deleteContactRow(tx, id);
    if (!found.hasContact || !removed) throw contactNotFound();
    await insertNotes(tx, [
      {
        id: randomUUID(),
        manifestationId: id,
        authorId: auth.profileId,
        kind: 'contact_deleted',
        content: null,
        fromValue: null,
        toValue: reason,
        createdAt: clock.now(),
      },
    ]);
    await recordAudit(tx, audit, {
      action: 'MANIFESTATION_CONTACT_DELETED',
      entityType: 'manifestation',
      entityId: id,
      sectorId: found.sectorId,
      details: { reason },
    });
  });
}
