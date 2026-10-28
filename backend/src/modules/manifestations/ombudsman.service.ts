import type {
  ManifestationEventKind,
  ManifestationPriority,
  ManifestationStatus,
  ManifestationType,
  Prisma,
  PrismaClient,
  TransactionClient,
} from '../../lib/prisma.js';
import { type AuditContext, recordAudit } from '../../services/audit.service.js';
import { resourceNotFound, sectorWhere } from '../../services/scope.js';
import type { Clock } from '../../utils/clock.js';
import { addDays, startOfLocalDay } from '../../utils/dates.js';
import { HttpError } from '../../utils/http-error.js';
import { resolvePeriod } from '../../utils/period.js';
import type { AuthContext } from '../auth/auth.types.js';
import {
  ACTIONS_MIN,
  canTransition,
  type CONTACT_DELETION_REASONS,
  type ListManifestationsQuery,
  PURPOSE_TEXT,
  STATUS_TRANSITIONS,
  type UpdateManifestationInput,
} from './manifestations.schemas.js';

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

const SORTS: Record<
  ListManifestationsQuery['sort'],
  Prisma.ManifestationOrderByWithRelationInput[]
> = {
  received_desc: [{ receivedAt: 'desc' }, { id: 'desc' }],
  received_asc: [{ receivedAt: 'asc' }, { id: 'asc' }],
  // Enum manifestation_priority na ordem low, medium, high.
  priority_desc: [{ priority: 'desc' }, { receivedAt: 'desc' }, { id: 'desc' }],
  status_asc: [{ status: 'asc' }, { receivedAt: 'desc' }, { id: 'desc' }],
};

function excerptOf(description: string): string {
  return description.length <= EXCERPT_LENGTH ? description : description.slice(0, EXCERPT_LENGTH);
}

/**
 * E35 — lista da Ouvidoria (RF44): interseção entre filtros e escopo (RN10), trecho de 120
 * caracteres e somente a existência do contato, nunca seus dados (Seção 8).
 */
export async function listManifestations(
  prisma: Pick<PrismaClient, 'manifestation'>,
  auth: AuthContext,
  query: ListManifestationsQuery,
  now: Date,
): Promise<{
  items: ManifestationListItemDto[];
  total: number;
  period: { from: string; to: string };
}> {
  const period = resolvePeriod(query, now);
  const where: Prisma.ManifestationWhereInput = {
    ...sectorWhere(auth.scope, query.sectorIds),
    sector: { hospitalId: auth.hospitalId },
    receivedAt: { gte: startOfLocalDay(period.from), lt: startOfLocalDay(addDays(period.to, 1)) },
    ...(query.status === undefined ? {} : { status: { in: query.status } }),
    ...(query.type === undefined ? {} : { type: { in: query.type } }),
    ...(query.priority === undefined ? {} : { priority: { in: query.priority } }),
    ...(query.protocol === undefined ? {} : { protocol: query.protocol }),
    ...(query.hasContact === undefined
      ? {}
      : query.hasContact
        ? { contact: { isNot: null } }
        : { contact: { is: null } }),
  };
  const [rows, total] = await Promise.all([
    prisma.manifestation.findMany({
      where,
      orderBy: SORTS[query.sort],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        protocol: true,
        receivedAt: true,
        updatedAt: true,
        type: true,
        status: true,
        priority: true,
        description: true,
        isAnonymous: true,
        triggeredByLowScore: true,
        sector: { select: { id: true, name: true } },
        // Somente a chave do contato: nome, telefone e e-mail não são lidos (Seção 8).
        contact: { select: { manifestationId: true } },
      },
    }),
    prisma.manifestation.count({ where }),
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
      hasContact: row.contact !== null,
      triggeredByLowScore: row.triggeredByLowScore,
    })),
    total,
    period,
  };
}

/** Manifestação do escopo e do hospital; fora do escopo ou inexistente → 404 (RN10). */
async function findInScope(
  tx: Pick<PrismaClient, 'manifestation'> | TransactionClient,
  auth: AuthContext,
  id: string,
) {
  const row = await tx.manifestation.findFirst({
    where: { id, ...sectorWhere(auth.scope), sector: { hospitalId: auth.hospitalId } },
    select: {
      id: true,
      sectorId: true,
      status: true,
      priority: true,
      actionsTaken: true,
      updatedAt: true,
      contact: { select: { manifestationId: true } },
    },
  });
  if (row === null) throw resourceNotFound();
  return row;
}

async function loadDetail(
  tx: Pick<PrismaClient, 'manifestation'> | TransactionClient,
  id: string,
): Promise<ManifestationDetailDto> {
  const row = await tx.manifestation.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      protocol: true,
      receivedAt: true,
      resolvedAt: true,
      updatedAt: true,
      type: true,
      status: true,
      priority: true,
      description: true,
      actionsTaken: true,
      isAnonymous: true,
      triggeredByLowScore: true,
      sector: { select: { id: true, name: true } },
      contact: { select: { manifestationId: true } },
      response: {
        select: {
          id: true,
          submittedAt: true,
          origin: true,
          npsScore: true,
          lowScore: true,
          surveyVersion: { select: { title: true, versionNumber: true } },
          answers: {
            select: {
              score: true,
              surveyVersionQuestion: {
                select: { text: true, journeyStageName: true, position: true },
              },
            },
          },
        },
      },
      notes: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          kind: true,
          content: true,
          fromValue: true,
          toValue: true,
          createdAt: true,
          author: { select: { id: true, fullName: true } },
        },
      },
    },
  });
  const answers = [...row.response.answers]
    .sort((a, b) => a.surveyVersionQuestion.position - b.surveyVersionQuestion.position)
    .map((answer) => ({
      questionText: answer.surveyVersionQuestion.text,
      journeyStageName: answer.surveyVersionQuestion.journeyStageName,
      score: answer.score,
    }));
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
    hasContact: row.contact !== null,
    triggeredByLowScore: row.triggeredByLowScore,
    allowedTransitions: STATUS_TRANSITIONS[row.status],
    response: {
      id: row.response.id,
      submittedAt: row.response.submittedAt.toISOString(),
      origin: row.response.origin,
      npsScore: row.response.npsScore,
      lowScore: row.response.lowScore,
      survey: row.response.surveyVersion,
      answers,
    },
    timeline: row.notes.map((note) => ({
      id: note.id,
      kind: note.kind,
      content: note.content,
      fromValue: note.fromValue,
      toValue: note.toValue,
      createdAt: note.createdAt.toISOString(),
      author: note.author,
    })),
  };
}

/**
 * E36 — detalhe com texto, resposta vinculada e linha do tempo completa e ordenada, sem o contato
 * (RF45). Cada consulta é auditada na mesma transação (MANIFESTATION_VIEWED).
 */
export async function getManifestation(
  prisma: PrismaClient,
  auth: AuthContext,
  audit: AuditContext,
  id: string,
): Promise<ManifestationDetailDto> {
  return prisma.$transaction(async (tx) => {
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
  prisma: PrismaClient,
  clock: Clock,
  auth: AuthContext,
  audit: AuditContext,
  id: string,
  patch: UpdateManifestationInput,
): Promise<ManifestationDetailDto> {
  return prisma.$transaction(async (tx) => {
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
    const updated = await tx.manifestation.updateMany({
      where: { id, updatedAt: current.updatedAt },
      data: {
        ...(status === undefined ? {} : { status, resolvedAt: status === 'resolved' ? now : null }),
        ...(priority === undefined ? {} : { priority }),
        ...(actionsTaken === undefined ? {} : { actionsTaken }),
        updatedById: auth.profileId,
        updatedAt: now,
      },
    });
    if (updated.count !== 1) throw stale();

    const events: Prisma.ManifestationNoteCreateManyInput[] = [];
    const base = { manifestationId: id, authorId: auth.profileId, createdAt: now };
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
    await tx.manifestationNote.createMany({
      data: events.map((event, index) => ({
        ...event,
        createdAt: new Date(now.getTime() + index),
      })),
    });
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
  prisma: PrismaClient,
  clock: Clock,
  auth: AuthContext,
  audit: AuditContext,
  id: string,
  content: string,
): Promise<TimelineEventDto> {
  return prisma.$transaction(async (tx) => {
    const found = await findInScope(tx, auth, id);
    const note = await tx.manifestationNote.create({
      data: {
        manifestationId: id,
        authorId: auth.profileId,
        kind: 'note',
        content,
        createdAt: clock.now(),
      },
      select: {
        id: true,
        kind: true,
        content: true,
        fromValue: true,
        toValue: true,
        createdAt: true,
        author: { select: { id: true, fullName: true } },
      },
    });
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
  prisma: PrismaClient,
  auth: AuthContext,
  audit: AuditContext,
  id: string,
): Promise<ContactDto> {
  return prisma.$transaction(async (tx) => {
    const found = await findInScope(tx, auth, id);
    if (found.contact === null) throw contactNotFound();
    await recordAudit(tx, audit, {
      action: 'MANIFESTATION_CONTACT_VIEWED',
      entityType: 'manifestation',
      entityId: id,
      sectorId: found.sectorId,
    });
    const contact = await tx.manifestationContact.findUniqueOrThrow({
      where: { manifestationId: id },
      select: {
        fullName: true,
        phone: true,
        email: true,
        consentGivenAt: true,
        purposeTextVersion: true,
      },
    });
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
  prisma: PrismaClient,
  clock: Clock,
  auth: AuthContext,
  audit: AuditContext,
  id: string,
  reason: (typeof CONTACT_DELETION_REASONS)[number],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const found = await findInScope(tx, auth, id);
    const removed = await tx.manifestationContact.deleteMany({ where: { manifestationId: id } });
    if (found.contact === null || removed.count !== 1) throw contactNotFound();
    await tx.manifestationNote.create({
      data: {
        manifestationId: id,
        authorId: auth.profileId,
        kind: 'contact_deleted',
        toValue: reason,
        createdAt: clock.now(),
      },
    });
    await recordAudit(tx, audit, {
      action: 'MANIFESTATION_CONTACT_DELETED',
      entityType: 'manifestation',
      entityId: id,
      sectorId: found.sectorId,
      details: { reason },
    });
  });
}
