/**
 * Esquemas de RESPOSTA da documentação OpenAPI (components.schemas), escritos em Zod para gerar o
 * JSON Schema e para que os testes confiram, em tempo de compilação, que cada esquema tem
 * exatamente o formato dos DTOs devolvidos pelos serviços (tests/unit/openapi.test.ts). Os
 * esquemas de ENTRADA não ficam aqui: a documentação usa os próprios esquemas de validação das
 * rotas (`*.schemas.ts`), os mesmos que a API aplica.
 */
import { z } from 'zod';

import { type JsonValue, USER_ROLES } from '../lib/domain-types.js';
import { PERMISSIONS } from '../modules/auth/permissions.js';
import { GRANULARITIES } from '../modules/dashboard/dashboard.schemas.js';
import {
  MANIFESTATION_PRIORITIES,
  MANIFESTATION_STATUSES,
  MANIFESTATION_TYPES,
} from '../modules/manifestations/manifestations.schemas.js';
import { RESPONSE_ORIGINS } from '../modules/public-survey/public-survey.schemas.js';
import { ROSTER_HEADER } from '../modules/shifts/roster-csv.js';
import { SHIFT_PERIODS } from '../modules/shifts/shift-rules.js';
import { tvWallSummarySchema } from '../modules/tv-wall/tv-wall.schemas.js';

/** Registro dos componentes: cada esquema registrado vira `#/components/schemas/<id>`. */
export const openApiRegistry = z.registry<{ id: string }>();

function component<T extends z.ZodType>(id: string, schema: T): T {
  openApiRegistry.add(schema, { id });
  return schema;
}

const uuid = () => z.string().meta({ format: 'uuid' });
const dateTime = () => z.string().meta({ format: 'date-time' });
const localDate = () =>
  z.string().meta({ format: 'date', description: 'Data local (America/Sao_Paulo), AAAA-MM-DD.' });
const localTime = () =>
  z.string().meta({ pattern: '^\\d{2}:\\d{2}$', description: 'Hora local (HH:MM).' });
const count = () => z.number().int().nonnegative();

const userRole = z.enum(USER_ROLES);
const shiftPeriod = z.enum(SHIFT_PERIODS);
const manifestationType = z.enum(MANIFESTATION_TYPES);
const manifestationStatus = z.enum(MANIFESTATION_STATUSES);
const manifestationPriority = z.enum(MANIFESTATION_PRIORITIES);

// ---------------------------------------------------------------------------------------------
// Erros e saúde
// ---------------------------------------------------------------------------------------------

export const ErrorDetail = component(
  'ErrorDetail',
  z.strictObject({ field: z.string(), message: z.string() }).describe('Problema em um campo.'),
);

export const ErrorResponse = component(
  'ErrorResponse',
  z
    .strictObject({
      error: z.strictObject({
        code: z.string().meta({ description: 'Código estável do erro (Tabela 18).' }),
        message: z.string().meta({ description: 'Mensagem em português para o usuário.' }),
        details: z.array(ErrorDetail),
        requestId: z.string().meta({ description: 'Mesmo valor do cabeçalho X-Request-Id.' }),
      }),
    })
    .describe('Envelope de erro de toda a API (RNF19); nunca contém stack trace.'),
);

export const HealthStatus = component(
  'HealthStatus',
  z.strictObject({
    status: z.literal('ok'),
    service: z.literal('fhdod-api'),
    timestamp: dateTime(),
    uptimeSeconds: count(),
  }),
);

// ---------------------------------------------------------------------------------------------
// Autenticação, perfil e usuários
// ---------------------------------------------------------------------------------------------

export const SectorSummary = component(
  'SectorSummary',
  z.strictObject({ id: uuid(), code: z.string(), name: z.string(), isActive: z.boolean() }),
);

export const Me = component(
  'Me',
  z
    .strictObject({
      id: uuid(),
      fullName: z.string(),
      email: z.string().meta({ format: 'email' }),
      role: userRole,
      allSectors: z.boolean(),
      sectors: z.array(SectorSummary),
      mustChangePassword: z.boolean(),
      permissions: z.array(z.enum(PERMISSIONS)),
    })
    .describe('Usuário autenticado, escopo de setores e permissões (E04).'),
);

const sessionTokensShape = {
  accessToken: z.string().meta({ description: 'JWT HS256 para o cabeçalho Authorization.' }),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().meta({ description: 'Validade do token de acesso, em segundos.' }),
  expiresAt: dateTime(),
  refreshToken: z.string().meta({ description: 'Token de renovação de uso único (rotativo).' }),
  refreshTokenExpiresAt: dateTime(),
};

export const SessionTokens = component('SessionTokens', z.strictObject(sessionTokensShape));

export const LoginResult = component(
  'LoginResult',
  z.strictObject({ ...sessionTokensShape, user: Me }),
);

export const User = component(
  'User',
  z.strictObject({
    id: uuid(),
    fullName: z.string(),
    email: z.string().meta({ format: 'email' }),
    role: userRole,
    allSectors: z.boolean(),
    sectors: z.array(SectorSummary),
    isActive: z.boolean(),
    mustChangePassword: z.boolean(),
    deactivatedAt: dateTime().nullable(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
);

const temporaryPassword = z
  .string()
  .meta({ description: 'Senha temporária de 16 caracteres, exibida uma única vez.' });

export const CreatedUser = component(
  'CreatedUser',
  z.strictObject({ user: User, temporaryPassword }),
);

export const TemporaryPassword = component(
  'TemporaryPassword',
  z.strictObject({ temporaryPassword }),
);

// ---------------------------------------------------------------------------------------------
// Setores, equipes, etapas, turnos e escalas
// ---------------------------------------------------------------------------------------------

export const Sector = component(
  'Sector',
  z.strictObject({
    id: uuid(),
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    isActive: z.boolean(),
    deactivatedAt: dateTime().nullable(),
    activeTeams: count(),
    activeSurveys: count(),
  }),
);

export const Team = component(
  'Team',
  z.strictObject({
    id: uuid(),
    sectorId: uuid(),
    sectorCode: z.string(),
    sectorName: z.string(),
    code: z.string(),
    name: z.string(),
    isActive: z.boolean(),
    deactivatedAt: dateTime().nullable(),
  }),
);

export const JourneyStage = component(
  'JourneyStage',
  z.strictObject({
    id: uuid(),
    code: z.string(),
    name: z.string(),
    position: z.number().int(),
    isActive: z.boolean(),
  }),
);

export const Shift = component(
  'Shift',
  z.strictObject({
    id: uuid(),
    sectorId: uuid(),
    team: z.strictObject({ id: uuid(), code: z.string(), name: z.string(), isActive: z.boolean() }),
    period: shiftPeriod,
    source: z.enum(['manual', 'import']),
    importId: uuid().nullable(),
    date: localDate(),
    startTime: localTime(),
    endTime: localTime(),
    endsNextDay: z.boolean(),
    startsAt: dateTime(),
    endsAt: dateTime(),
    cancelledAt: dateTime().nullable(),
    cancelReason: z.string().nullable(),
    createdAt: dateTime(),
  }),
);

export const RosterError = component(
  'RosterError',
  z.strictObject({
    line: z.number().int().meta({ description: 'Linha do arquivo (o cabeçalho é a linha 1).' }),
    column: z.enum([...ROSTER_HEADER, 'cabecalho']),
    code: z.enum([
      'CSV_HEADER_INVALID',
      'FIELD_REQUIRED',
      'DATE_INVALID',
      'DATE_OUT_OF_RANGE',
      'TIME_INVALID',
      'DURATION_INVALID',
      'PERIOD_INVALID',
      'SECTOR_NOT_FOUND',
      'SECTOR_INACTIVE',
      'SECTOR_OUT_OF_SCOPE',
      'TEAM_NOT_FOUND',
      'TEAM_INACTIVE',
      'OVERLAP_IN_FILE',
      'OVERLAP_EXISTING',
    ]),
    message: z.string(),
  }),
);

export const RosterSummaryItem = component(
  'RosterSummaryItem',
  z.strictObject({
    sectorCode: z.string(),
    sectorName: z.string(),
    teamCode: z.string(),
    teamName: z.string(),
    shifts: count(),
  }),
);

export const RosterImport = component(
  'RosterImport',
  z.strictObject({
    id: uuid(),
    status: z.enum(['validated', 'rejected', 'committed']),
    fileName: z.string(),
    totalRows: count(),
    acceptedRows: count(),
    rejectedRows: count(),
    errors: z.array(RosterError),
    summary: z.array(RosterSummaryItem),
    expiresAt: dateTime(),
    createdAt: dateTime(),
    committedAt: dateTime().nullable(),
  }),
);

// ---------------------------------------------------------------------------------------------
// Pesquisas (administração) e pesquisa pública
// ---------------------------------------------------------------------------------------------

const questionType = z.enum(['nps', 'scale_1_5']);

export const SurveyLinks = component(
  'SurveyLinks',
  z.strictObject({
    qrUrl: z.string().meta({ format: 'uri' }),
    linkUrl: z.string().meta({ format: 'uri' }),
  }),
);

const surveySummaryShape = {
  id: uuid(),
  sectorId: uuid(),
  sectorCode: z.string(),
  sectorName: z.string(),
  sectorIsActive: z.boolean(),
  title: z.string(),
  slug: z.string(),
  status: z.enum(['draft', 'active', 'inactive']),
  isActive: z.boolean(),
  hasUnpublishedChanges: z.boolean(),
  activeSpecificQuestions: count(),
  currentVersion: z
    .strictObject({ id: uuid(), versionNumber: z.number().int(), publishedAt: dateTime() })
    .nullable(),
  updatedAt: dateTime(),
};

export const SurveySummary = component('SurveySummary', z.strictObject(surveySummaryShape));

export const SurveyQuestion = component(
  'SurveyQuestion',
  z.strictObject({
    id: uuid(),
    type: questionType,
    text: z.string(),
    journeyStage: z
      .strictObject({ id: uuid(), code: z.string(), name: z.string(), position: z.number().int() })
      .nullable(),
    position: z.number().int(),
    isRequired: z.boolean(),
    isActive: z.boolean(),
    locked: z
      .boolean()
      .meta({ description: 'Já publicada: texto, tipo e etapa imutáveis (RN17).' }),
  }),
);

export const SurveyVersion = component(
  'SurveyVersion',
  z.strictObject({
    id: uuid(),
    versionNumber: z.number().int(),
    title: z.string(),
    introText: z.string().nullable(),
    thankYouMessage: z.string(),
    publishedAt: dateTime(),
    publishedBy: z.strictObject({ id: uuid(), fullName: z.string() }),
    supersededAt: dateTime().nullable(),
    isCurrent: z.boolean(),
    questions: z.array(
      z.strictObject({
        id: uuid(),
        questionId: uuid(),
        type: questionType,
        text: z.string(),
        journeyStageName: z.string().nullable(),
        position: z.number().int(),
      }),
    ),
  }),
);

export const SurveyDetail = component(
  'SurveyDetail',
  z.strictObject({
    ...surveySummaryShape,
    introText: z.string().nullable(),
    thankYouMessage: z.string(),
    deactivatedAt: dateTime().nullable(),
    createdAt: dateTime(),
    questions: z.array(SurveyQuestion),
    versions: z.array(SurveyVersion),
    links: SurveyLinks.nullable(),
  }),
);

export const SurveyQr = component(
  'SurveyQr',
  z.strictObject({
    qrUrl: z.string().meta({ format: 'uri' }),
    linkUrl: z.string().meta({ format: 'uri' }),
    slug: z.string(),
    title: z.string(),
    sectorName: z.string(),
  }),
);

export const PublicSurvey = component(
  'PublicSurvey',
  z
    .strictObject({
      surveyVersionId: uuid(),
      versionNumber: z.number().int(),
      slug: z.string(),
      title: z.string(),
      introText: z.string().nullable(),
      thankYouMessage: z.string(),
      sectorName: z.string(),
      npsQuestion: z.strictObject({
        id: uuid(),
        text: z.string(),
        anchors: z.strictObject({ min: z.string(), max: z.string() }),
      }),
      stages: z.array(
        z.strictObject({
          name: z.string(),
          position: z.number().int(),
          questions: z.array(z.strictObject({ id: uuid(), text: z.string() })),
        }),
      ),
      scaleLabels: z.array(z.string()).readonly(),
    })
    .describe('Versão vigente da pesquisa, somente com os textos públicos (E01).'),
);

export const SubmittedResponse = component(
  'SubmittedResponse',
  z.strictObject({
    responseId: uuid(),
    submittedAt: dateTime(),
    lowScore: z.boolean(),
    manifestation: z
      .strictObject({ token: z.string(), expiresAt: dateTime() })
      .describe('Token para registrar a manifestação (E03), válido por 60 minutos.'),
  }),
);

// ---------------------------------------------------------------------------------------------
// Manifestações e Ouvidoria
// ---------------------------------------------------------------------------------------------

export const CreatedManifestation = component(
  'CreatedManifestation',
  z.strictObject({
    protocol: z.string().meta({ pattern: '^FHD-\\d{4}-\\d{6}$' }),
    receivedAt: dateTime(),
  }),
);

const manifestationBaseShape = {
  id: uuid(),
  protocol: z.string().meta({ pattern: '^FHD-\\d{4}-\\d{6}$' }),
  receivedAt: dateTime(),
  updatedAt: dateTime(),
  sector: z.strictObject({ id: uuid(), name: z.string() }),
  type: manifestationType,
  status: manifestationStatus,
  priority: manifestationPriority,
  isAnonymous: z.boolean(),
  hasContact: z.boolean(),
  triggeredByLowScore: z.boolean(),
};

export const ManifestationListItem = component(
  'ManifestationListItem',
  z.strictObject({
    ...manifestationBaseShape,
    excerpt: z.string().meta({ description: 'Até 120 caracteres da descrição.' }),
  }),
);

export const TimelineEvent = component(
  'TimelineEvent',
  z.strictObject({
    id: uuid(),
    kind: z.enum([
      'created',
      'status_changed',
      'priority_changed',
      'actions_updated',
      'note',
      'contact_deleted',
    ]),
    content: z.string().nullable(),
    fromValue: z.string().nullable(),
    toValue: z.string().nullable(),
    createdAt: dateTime(),
    author: z.strictObject({ id: uuid(), fullName: z.string() }).nullable(),
  }),
);

export const ManifestationDetail = component(
  'ManifestationDetail',
  z.strictObject({
    ...manifestationBaseShape,
    description: z.string(),
    actionsTaken: z.string().nullable(),
    resolvedAt: dateTime().nullable(),
    allowedTransitions: z.array(manifestationStatus).readonly(),
    response: z.strictObject({
      id: uuid(),
      submittedAt: dateTime(),
      origin: z.enum(RESPONSE_ORIGINS),
      npsScore: z.number().int(),
      lowScore: z.boolean(),
      survey: z.strictObject({ title: z.string(), versionNumber: z.number().int() }),
      answers: z.array(
        z.strictObject({
          questionText: z.string(),
          journeyStageName: z.string().nullable(),
          score: z.number().int(),
        }),
      ),
    }),
    timeline: z.array(TimelineEvent),
  }),
);

export const ManifestationContact = component(
  'ManifestationContact',
  z.strictObject({
    fullName: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    consentGivenAt: dateTime(),
    purposeTextVersion: z.string(),
    purposeText: z.string(),
  }),
);

// ---------------------------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------------------------

export const LocalPeriod = component(
  'LocalPeriod',
  z.strictObject({ from: localDate(), to: localDate() }),
);

const nullableCount = () => count().nullable();

export const NpsIndicator = component(
  'NpsIndicator',
  z
    .strictObject({
      n: nullableCount(),
      nps: z.number().nullable(),
      promoters: nullableCount(),
      passives: nullableCount(),
      detractors: nullableCount(),
      promotersPercent: z.number().nullable(),
      passivesPercent: z.number().nullable(),
      detractorsPercent: z.number().nullable(),
      suppressed: z.boolean(),
    })
    .describe('NPS com o n considerado; valores nulos quando suprimidos para o VI (RN21).'),
);

export const Coverage = component(
  'Coverage',
  z.strictObject({
    total: nullableCount(),
    attributed: nullableCount(),
    percent: z.number().nullable(),
    suppressed: z.boolean(),
  }),
);

export const DistributionItem = component(
  'DistributionItem',
  z.strictObject({ score: z.number().int(), count: count(), percent: z.number().nullable() }),
);

export const DashboardSummary = component(
  'DashboardSummary',
  z.strictObject({
    period: LocalPeriod,
    indicators: NpsIndicator,
    distribution: z.array(DistributionItem).nullable(),
    manifestations: z.strictObject({
      total: nullableCount(),
      compliment: nullableCount(),
      complaint: nullableCount(),
      suggestion: nullableCount(),
      suppressed: z.boolean(),
    }),
    coverage: Coverage,
    comparison: z
      .strictObject({
        period: LocalPeriod,
        indicators: NpsIndicator,
        delta: z.number().nullable(),
        noPreviousData: z.boolean(),
      })
      .nullable()
      .meta({ description: 'Presente somente com compare=previous_period.' }),
  }),
);

export const SectorResult = component(
  'SectorResult',
  z.strictObject({
    id: uuid(),
    code: z.string(),
    name: z.string(),
    isActive: z.boolean(),
    indicators: NpsIndicator,
  }),
);

export const ShiftResult = component(
  'ShiftResult',
  z.strictObject({ period: shiftPeriod, indicators: NpsIndicator }),
);

export const TeamResult = component(
  'TeamResult',
  z.strictObject({
    id: uuid(),
    code: z.string(),
    name: z.string(),
    sector: z.strictObject({ id: uuid(), name: z.string() }),
    indicators: NpsIndicator,
  }),
);

export const TrendPoint = component(
  'TrendPoint',
  z.strictObject({
    start: localDate(),
    end: localDate(),
    n: nullableCount(),
    nps: z.number().nullable(),
    suppressed: z.boolean(),
  }),
);

export const QuestionResult = component(
  'QuestionResult',
  z.strictObject({
    questionId: uuid(),
    text: z.string(),
    journeyStage: z.strictObject({
      id: uuid().nullable(),
      name: z.string().nullable(),
      position: z.number().int().nullable(),
    }),
    survey: z.strictObject({ id: uuid(), title: z.string() }),
    n: nullableCount(),
    average: z.number().nullable(),
    distribution: z.array(z.strictObject({ score: z.number().int(), count: count() })).nullable(),
    topTwoPercent: z.number().nullable(),
    suppressed: z.boolean(),
  }),
);

// ---------------------------------------------------------------------------------------------
// Auditoria e TV Wall
// ---------------------------------------------------------------------------------------------

export const AuditLog = component(
  'AuditLog',
  z.strictObject({
    id: uuid(),
    occurredAt: dateTime(),
    actor: z
      .strictObject({ id: uuid(), fullName: z.string(), role: userRole.nullable() })
      .nullable(),
    action: z.string(),
    entityType: z.string(),
    entityId: z.string().nullable(),
    sectorId: uuid().nullable(),
    details: z
      .custom<JsonValue>()
      .meta({ description: 'Detalhes da operação (JSON), sem dados pessoais nem senhas.' }),
    requestId: z.string().nullable(),
  }),
);

export const TvWallSummary = component('TvWallSummary', tvWallSummarySchema);

// ---------------------------------------------------------------------------------------------
// Metadados das listas (`meta`)
// ---------------------------------------------------------------------------------------------

const pageShape = {
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: count(),
};

export const PageMeta = component('PageMeta', z.strictObject(pageShape));

export const PagePeriodMeta = component(
  'PagePeriodMeta',
  z.strictObject({ ...pageShape, from: localDate(), to: localDate() }),
);

export const CoverageMeta = component(
  'CoverageMeta',
  z.strictObject({ from: localDate(), to: localDate(), coverage: Coverage }),
);

export const TrendsMeta = component(
  'TrendsMeta',
  z.strictObject({ from: localDate(), to: localDate(), granularity: z.enum(GRANULARITIES) }),
);

export const QuestionsMeta = component(
  'QuestionsMeta',
  z.strictObject({ from: localDate(), to: localDate(), total: nullableCount() }),
);
