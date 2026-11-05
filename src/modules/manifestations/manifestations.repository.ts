/**
 * Acesso a dados das manifestações (manifestations), do contato segregado (manifestation_contacts)
 * e da linha do tempo (manifestation_notes). O contato só é lido por findContact (E39).
 */
import { type Queryable, toNumber } from '../../lib/database.js';
import type {
  ManifestationEventKind,
  ManifestationPriority,
  ManifestationStatus,
  ManifestationType,
  ResponseOrigin,
} from '../../lib/domain-types.js';
import { sql, type SqlStatement } from '../../lib/sql.js';

// ---------------------------------------------------------------------------------------------
// Registro público (E03)
// ---------------------------------------------------------------------------------------------

export interface StoredManifestation {
  protocol: string;
  receivedAt: Date;
  requestHash: string;
}

export async function findManifestationByIdempotencyKey(
  db: Queryable,
  idempotencyKey: string,
): Promise<StoredManifestation | null> {
  const [row] = await db.query<{ protocol: string; received_at: Date; request_hash: string }>(sql`
    SELECT protocol, received_at, request_hash FROM manifestations
    WHERE idempotency_key = ${idempotencyKey}`);
  return row === undefined
    ? null
    : { protocol: row.protocol, receivedAt: row.received_at, requestHash: row.request_hash };
}

export interface ResponseForManifestation {
  id: string;
  sectorId: string;
  lowScore: boolean;
  manifestationTokenExpiresAt: Date;
  manifestationTokenUsedAt: Date | null;
  hasManifestation: boolean;
}

export async function findResponseForManifestation(
  db: Queryable,
  responseId: string,
): Promise<ResponseForManifestation | null> {
  const [row] = await db.query<{
    id: string;
    sector_id: string;
    low_score: boolean;
    manifestation_token_expires_at: Date;
    manifestation_token_used_at: Date | null;
    has_manifestation: number;
  }>(sql`
    SELECT r.id, r.sector_id, r.low_score, r.manifestation_token_expires_at,
           r.manifestation_token_used_at,
           EXISTS (SELECT 1 FROM manifestations m WHERE m.response_id = r.id) AS has_manifestation
    FROM responses r WHERE r.id = ${responseId}`);
  return row === undefined
    ? null
    : {
        id: row.id,
        sectorId: row.sector_id,
        lowScore: row.low_score,
        manifestationTokenExpiresAt: row.manifestation_token_expires_at,
        manifestationTokenUsedAt: row.manifestation_token_used_at,
        hasManifestation: toNumber(row.has_manifestation) === 1,
      };
}

/** Uso único do token (RN22): só um envio muda manifestation_token_used_at de nulo para preenchido. */
export async function consumeManifestationToken(
  db: Queryable,
  responseId: string,
  at: Date,
): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE responses SET manifestation_token_used_at = ${at}
    WHERE id = ${responseId} AND manifestation_token_used_at IS NULL`);
  return result.affectedRows === 1;
}

export async function insertManifestation(
  db: Queryable,
  data: {
    id: string;
    responseId: string;
    sectorId: string;
    type: ManifestationType;
    description: string;
    isAnonymous: boolean;
    triggeredByLowScore: boolean;
    receivedAt: Date;
    idempotencyKey: string;
    requestHash: string;
  },
): Promise<void> {
  // protocol omitido: gerado pelo gatilho manifestations_before_insert (FHD-AAAA-NNNNNN).
  await db.execute(sql`
    INSERT INTO manifestations
      (id, response_id, sector_id, type, description, is_anonymous, triggered_by_low_score,
       received_at, idempotency_key, request_hash, created_at, updated_at)
    VALUES (${data.id}, ${data.responseId}, ${data.sectorId}, ${data.type}, ${data.description},
            ${data.isAnonymous}, ${data.triggeredByLowScore}, ${data.receivedAt},
            ${data.idempotencyKey}, ${data.requestHash}, ${data.receivedAt}, ${data.receivedAt})`);
}

export async function findProtocol(db: Queryable, id: string): Promise<string> {
  const [row] = await db.query<{ protocol: string }>(sql`
    SELECT protocol FROM manifestations WHERE id = ${id}`);
  if (row === undefined) throw new Error('Manifestação recém-criada não encontrada.');
  return row.protocol;
}

export async function insertContact(
  db: Queryable,
  data: {
    manifestationId: string;
    fullName: string;
    phone: string | null;
    email: string | null;
    consentGivenAt: Date;
    purposeTextVersion: string;
  },
): Promise<void> {
  await db.execute(sql`
    INSERT INTO manifestation_contacts
      (manifestation_id, full_name, phone, email, consent_given_at, purpose_text_version, created_at)
    VALUES (${data.manifestationId}, ${data.fullName}, ${data.phone}, ${data.email},
            ${data.consentGivenAt}, ${data.purposeTextVersion}, ${data.consentGivenAt})`);
}

export interface NoteInsert {
  id: string;
  manifestationId: string;
  authorId: string | null;
  kind: ManifestationEventKind;
  content: string | null;
  fromValue: string | null;
  toValue: string | null;
  createdAt: Date;
}

export async function insertNotes(db: Queryable, notes: readonly NoteInsert[]): Promise<void> {
  if (notes.length === 0) return;
  const rows = notes.map(
    (note) =>
      sql`(${note.id}, ${note.manifestationId}, ${note.authorId}, ${note.kind}, ${note.content},
           ${note.fromValue}, ${note.toValue}, ${note.createdAt})`,
  );
  await db.execute(sql`
    INSERT INTO manifestation_notes
      (id, manifestation_id, author_id, kind, content, from_value, to_value, created_at)
    VALUES ${sql.join(rows, ', ')}`);
}

// ---------------------------------------------------------------------------------------------
// Ouvidoria (E35–E40)
// ---------------------------------------------------------------------------------------------

export type ManifestationSort = 'received_desc' | 'received_asc' | 'priority_desc' | 'status_asc';

/** ENUM ordena pela posição na definição: priority low < medium < high (como no PostgreSQL). */
const SORTS: Record<ManifestationSort, SqlStatement> = {
  received_desc: sql`m.received_at DESC, m.id DESC`,
  received_asc: sql`m.received_at ASC, m.id ASC`,
  priority_desc: sql`m.priority DESC, m.received_at DESC, m.id DESC`,
  status_asc: sql`m.status ASC, m.received_at DESC, m.id DESC`,
};

export interface ManifestationListFilters {
  hospitalId: string;
  sectorIds: readonly string[] | undefined;
  from: Date;
  toExclusive: Date;
  status?: readonly ManifestationStatus[] | undefined;
  type?: readonly ManifestationType[] | undefined;
  priority?: readonly ManifestationPriority[] | undefined;
  protocol?: string | undefined;
  hasContact?: boolean | undefined;
  /** Filtros da resposta vinculada (relatório E34). */
  origin?: ResponseOrigin | undefined;
  shiftPeriod?: string | undefined;
  teamIds?: readonly string[] | undefined;
  surveyId?: string | undefined;
}

export interface ManifestationListRow {
  id: string;
  protocol: string;
  receivedAt: Date;
  resolvedAt: Date | null;
  updatedAt: Date;
  type: ManifestationType;
  status: ManifestationStatus;
  priority: ManifestationPriority;
  description: string;
  actionsTaken: string | null;
  isAnonymous: boolean;
  triggeredByLowScore: boolean;
  sector: { id: string; name: string };
  hasContact: boolean;
}

function listWhere(filters: ManifestationListFilters): SqlStatement | null {
  if (filters.sectorIds?.length === 0) return null;
  const conditions: SqlStatement[] = [
    sql`s.hospital_id = ${filters.hospitalId}`,
    sql`m.received_at >= ${filters.from}`,
    sql`m.received_at < ${filters.toExclusive}`,
  ];
  if (filters.sectorIds !== undefined) {
    conditions.push(sql`m.sector_id IN (${sql.list(filters.sectorIds)})`);
  }
  if (filters.status !== undefined) conditions.push(sql`m.status IN (${sql.list(filters.status)})`);
  if (filters.type !== undefined) conditions.push(sql`m.type IN (${sql.list(filters.type)})`);
  if (filters.priority !== undefined) {
    conditions.push(sql`m.priority IN (${sql.list(filters.priority)})`);
  }
  if (filters.protocol !== undefined) conditions.push(sql`m.protocol = ${filters.protocol}`);
  if (filters.hasContact !== undefined) {
    conditions.push(
      filters.hasContact ? sql`mc.manifestation_id IS NOT NULL` : sql`mc.manifestation_id IS NULL`,
    );
  }
  if (filters.origin !== undefined) conditions.push(sql`r.origin = ${filters.origin}`);
  if (filters.shiftPeriod !== undefined)
    conditions.push(sql`r.shift_period = ${filters.shiftPeriod}`);
  if (filters.teamIds !== undefined) {
    if (filters.teamIds.length === 0) return null;
    conditions.push(sql`r.team_id IN (${sql.list(filters.teamIds)})`);
  }
  if (filters.surveyId !== undefined)
    conditions.push(sql`sv.survey_config_id = ${filters.surveyId}`);
  return sql.join(conditions, ' AND ');
}

const LIST_FROM = sql`
  manifestations m
  JOIN sectors s ON s.id = m.sector_id
  JOIN responses r ON r.id = m.response_id
  JOIN survey_versions sv ON sv.id = r.survey_version_id
  LEFT JOIN manifestation_contacts mc ON mc.manifestation_id = m.id`;

/** Lista paginada (E35) ou limitada (E34); o contato aparece só como existência (Seção 8). */
export async function listManifestationRows(
  db: Queryable,
  filters: ManifestationListFilters,
  page: { sort: ManifestationSort; offset: number; limit: number },
): Promise<ManifestationListRow[]> {
  const where = listWhere(filters);
  if (where === null) return [];
  const rows = await db.query<{
    id: string;
    protocol: string;
    received_at: Date;
    resolved_at: Date | null;
    updated_at: Date;
    type: ManifestationType;
    status: ManifestationStatus;
    priority: ManifestationPriority;
    description: string;
    actions_taken: string | null;
    is_anonymous: boolean;
    triggered_by_low_score: boolean;
    sector_id: string;
    sector_name: string;
    has_contact: number;
  }>(sql`
    SELECT m.id, m.protocol, m.received_at, m.resolved_at, m.updated_at, m.type, m.status,
           m.priority, m.description, m.actions_taken, m.is_anonymous, m.triggered_by_low_score,
           s.id AS sector_id, s.name AS sector_name,
           (mc.manifestation_id IS NOT NULL) AS has_contact
    FROM ${LIST_FROM}
    WHERE ${where}
    ORDER BY ${SORTS[page.sort]}
    LIMIT ${page.limit} OFFSET ${page.offset}`);
  return rows.map((row) => ({
    id: row.id,
    protocol: row.protocol,
    receivedAt: row.received_at,
    resolvedAt: row.resolved_at,
    updatedAt: row.updated_at,
    type: row.type,
    status: row.status,
    priority: row.priority,
    description: row.description,
    actionsTaken: row.actions_taken,
    isAnonymous: row.is_anonymous,
    triggeredByLowScore: row.triggered_by_low_score,
    sector: { id: row.sector_id, name: row.sector_name },
    hasContact: toNumber(row.has_contact) === 1,
  }));
}

export async function countManifestations(
  db: Queryable,
  filters: ManifestationListFilters,
): Promise<number> {
  const where = listWhere(filters);
  if (where === null) return 0;
  const [row] = await db.query<{ total: number }>(sql`
    SELECT COUNT(*) AS total FROM ${LIST_FROM} WHERE ${where}`);
  return toNumber(row?.total ?? 0);
}

export interface ManifestationState {
  id: string;
  sectorId: string;
  status: ManifestationStatus;
  priority: ManifestationPriority;
  actionsTaken: string | null;
  updatedAt: Date;
  hasContact: boolean;
}

/** Manifestação do hospital e dos setores informados (undefined = todos). */
export async function findManifestationState(
  db: Queryable,
  id: string,
  hospitalId: string,
  sectorIds: readonly string[] | undefined,
): Promise<ManifestationState | null> {
  if (sectorIds?.length === 0) return null;
  const [row] = await db.query<{
    id: string;
    sector_id: string;
    status: ManifestationStatus;
    priority: ManifestationPriority;
    actions_taken: string | null;
    updated_at: Date;
    has_contact: number;
  }>(sql`
    SELECT m.id, m.sector_id, m.status, m.priority, m.actions_taken, m.updated_at,
           EXISTS (SELECT 1 FROM manifestation_contacts mc WHERE mc.manifestation_id = m.id) AS has_contact
    FROM manifestations m JOIN sectors s ON s.id = m.sector_id
    WHERE m.id = ${id} AND s.hospital_id = ${hospitalId}
      ${sectorIds === undefined ? sql.empty : sql`AND m.sector_id IN (${sql.list(sectorIds)})`}`);
  return row === undefined
    ? null
    : {
        id: row.id,
        sectorId: row.sector_id,
        status: row.status,
        priority: row.priority,
        actionsTaken: row.actions_taken,
        updatedAt: row.updated_at,
        hasContact: toNumber(row.has_contact) === 1,
      };
}

export interface ManifestationDetailRecord {
  manifestation: ManifestationListRow;
  response: {
    id: string;
    submittedAt: Date;
    origin: ResponseOrigin;
    npsScore: number;
    lowScore: boolean;
    survey: { title: string; versionNumber: number };
    answers: { questionText: string; journeyStageName: string | null; score: number }[];
  };
  timeline: {
    id: string;
    kind: ManifestationEventKind;
    content: string | null;
    fromValue: string | null;
    toValue: string | null;
    createdAt: Date;
    author: { id: string; fullName: string } | null;
  }[];
}

/** Detalhe (E36): manifestação, resposta vinculada com as notas e linha do tempo ordenada. */
export async function findManifestationDetail(
  db: Queryable,
  id: string,
): Promise<ManifestationDetailRecord | null> {
  const [row] = await db.query<{
    id: string;
    protocol: string;
    received_at: Date;
    resolved_at: Date | null;
    updated_at: Date;
    type: ManifestationType;
    status: ManifestationStatus;
    priority: ManifestationPriority;
    description: string;
    actions_taken: string | null;
    is_anonymous: boolean;
    triggered_by_low_score: boolean;
    sector_id: string;
    sector_name: string;
    has_contact: number;
    response_id: string;
    submitted_at: Date;
    origin: ResponseOrigin;
    nps_score: number;
    low_score: boolean;
    survey_title: string;
    version_number: number;
  }>(sql`
    SELECT m.id, m.protocol, m.received_at, m.resolved_at, m.updated_at, m.type, m.status,
           m.priority, m.description, m.actions_taken, m.is_anonymous, m.triggered_by_low_score,
           s.id AS sector_id, s.name AS sector_name,
           EXISTS (SELECT 1 FROM manifestation_contacts mc WHERE mc.manifestation_id = m.id) AS has_contact,
           r.id AS response_id, r.submitted_at, r.origin, r.nps_score, r.low_score,
           sv.title AS survey_title, sv.version_number
    FROM manifestations m
    JOIN sectors s ON s.id = m.sector_id
    JOIN responses r ON r.id = m.response_id
    JOIN survey_versions sv ON sv.id = r.survey_version_id
    WHERE m.id = ${id}`);
  if (row === undefined) return null;
  const [answers, notes] = await Promise.all([
    db.query<{ score: number; text: string; journey_stage_name: string | null }>(sql`
      SELECT a.score, svq.text, svq.journey_stage_name
      FROM response_answers a
      JOIN survey_version_questions svq ON svq.id = a.survey_version_question_id
      WHERE a.response_id = ${row.response_id}
      ORDER BY svq.position`),
    db.query<{
      id: string;
      kind: ManifestationEventKind;
      content: string | null;
      from_value: string | null;
      to_value: string | null;
      created_at: Date;
      author_id: string | null;
      author_name: string | null;
    }>(sql`
      SELECT n.id, n.kind, n.content, n.from_value, n.to_value, n.created_at,
             p.id AS author_id, p.full_name AS author_name
      FROM manifestation_notes n LEFT JOIN profiles p ON p.id = n.author_id
      WHERE n.manifestation_id = ${id}
      ORDER BY n.created_at, n.id`),
  ]);
  return {
    manifestation: {
      id: row.id,
      protocol: row.protocol,
      receivedAt: row.received_at,
      resolvedAt: row.resolved_at,
      updatedAt: row.updated_at,
      type: row.type,
      status: row.status,
      priority: row.priority,
      description: row.description,
      actionsTaken: row.actions_taken,
      isAnonymous: row.is_anonymous,
      triggeredByLowScore: row.triggered_by_low_score,
      sector: { id: row.sector_id, name: row.sector_name },
      hasContact: toNumber(row.has_contact) === 1,
    },
    response: {
      id: row.response_id,
      submittedAt: row.submitted_at,
      origin: row.origin,
      npsScore: row.nps_score,
      lowScore: row.low_score,
      survey: { title: row.survey_title, versionNumber: row.version_number },
      answers: answers.map((answer) => ({
        questionText: answer.text,
        journeyStageName: answer.journey_stage_name,
        score: answer.score,
      })),
    },
    timeline: notes.map((note) => ({
      id: note.id,
      kind: note.kind,
      content: note.content,
      fromValue: note.from_value,
      toValue: note.to_value,
      createdAt: note.created_at,
      author:
        note.author_id === null ? null : { id: note.author_id, fullName: note.author_name ?? '' },
    })),
  };
}

/**
 * Atualização com concorrência otimista (RF46): só altera se updated_at ainda for o lido.
 * Devolve false quando outra pessoa alterou antes.
 */
export async function updateManifestationTreatment(
  db: Queryable,
  id: string,
  expectedUpdatedAt: Date,
  changes: {
    status?: ManifestationStatus;
    resolvedAt?: Date | null;
    priority?: ManifestationPriority;
    actionsTaken?: string;
    updatedById: string;
    updatedAt: Date;
  },
): Promise<boolean> {
  const sets: SqlStatement[] = [
    sql`updated_by = ${changes.updatedById}`,
    sql`updated_at = ${changes.updatedAt}`,
  ];
  if (changes.status !== undefined) sets.push(sql`status = ${changes.status}`);
  if (changes.resolvedAt !== undefined) sets.push(sql`resolved_at = ${changes.resolvedAt}`);
  if (changes.priority !== undefined) sets.push(sql`priority = ${changes.priority}`);
  if (changes.actionsTaken !== undefined) sets.push(sql`actions_taken = ${changes.actionsTaken}`);
  const result = await db.execute(sql`
    UPDATE manifestations SET ${sql.join(sets, ', ')}
    WHERE id = ${id} AND updated_at = ${expectedUpdatedAt}`);
  return result.affectedRows === 1;
}

export async function findNote(
  db: Queryable,
  id: string,
): Promise<ManifestationDetailRecord['timeline'][number] | null> {
  const [row] = await db.query<{
    id: string;
    kind: ManifestationEventKind;
    content: string | null;
    from_value: string | null;
    to_value: string | null;
    created_at: Date;
    author_id: string | null;
    author_name: string | null;
  }>(sql`
    SELECT n.id, n.kind, n.content, n.from_value, n.to_value, n.created_at,
           p.id AS author_id, p.full_name AS author_name
    FROM manifestation_notes n LEFT JOIN profiles p ON p.id = n.author_id
    WHERE n.id = ${id}`);
  return row === undefined
    ? null
    : {
        id: row.id,
        kind: row.kind,
        content: row.content,
        fromValue: row.from_value,
        toValue: row.to_value,
        createdAt: row.created_at,
        author:
          row.author_id === null ? null : { id: row.author_id, fullName: row.author_name ?? '' },
      };
}

export interface ContactRecord {
  fullName: string;
  phone: string | null;
  email: string | null;
  consentGivenAt: Date;
  purposeTextVersion: string;
}

/** Único ponto que lê os dados pessoais do contato (E39, sempre auditado antes). */
export async function findContact(
  db: Queryable,
  manifestationId: string,
): Promise<ContactRecord | null> {
  const [row] = await db.query<{
    full_name: string;
    phone: string | null;
    email: string | null;
    consent_given_at: Date;
    purpose_text_version: string;
  }>(sql`
    SELECT full_name, phone, email, consent_given_at, purpose_text_version
    FROM manifestation_contacts WHERE manifestation_id = ${manifestationId}`);
  return row === undefined
    ? null
    : {
        fullName: row.full_name,
        phone: row.phone,
        email: row.email,
        consentGivenAt: row.consent_given_at,
        purposeTextVersion: row.purpose_text_version,
      };
}

export async function deleteContactRow(db: Queryable, manifestationId: string): Promise<boolean> {
  const result = await db.execute(sql`
    DELETE FROM manifestation_contacts WHERE manifestation_id = ${manifestationId}`);
  return result.affectedRows === 1;
}
