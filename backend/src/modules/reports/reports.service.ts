import type ExcelJS from 'exceljs';

import { Prisma, type PrismaClient, type UserRole } from '../../lib/prisma.js';
import { type AuditContext, recordAudit } from '../../services/audit.service.js';
import { classifyNps } from '../../services/nps.js';
import { sectorWhere } from '../../services/scope.js';
import { addDays, localDateOf, localTimeOf, startOfLocalDay } from '../../utils/dates.js';
import { HttpError } from '../../utils/http-error.js';
import type { AuthContext } from '../auth/auth.types.js';
import {
  getQuestions,
  getSectors,
  getSummary,
  getTrends,
  type NpsIndicator,
  type ResolvedFilters,
  RESPONSES_FROM,
  responseConditions,
  resolveFilters,
} from '../dashboard/dashboard.service.js';
import { type ExportQuery, MAX_ROWS_PER_SHEET, type ReportType } from './reports.schemas.js';
import {
  addKeyValueSheet,
  addTableSheet,
  type CellValue,
  DATE_TIME_FORMAT,
  excelDateTime,
  newWorkbook,
  toBuffer,
} from './xlsx.js';

/** Rótulos em português usados nas abas (RNF29). */
const ORIGIN_LABELS = { qr_code: 'QR Code', link: 'Link' } as const;
const PERIOD_LABELS = { morning: 'Manhã', afternoon: 'Tarde', night: 'Noite' } as const;
const ATTRIBUTION_LABELS = {
  attributed: 'Atribuída',
  not_qr_origin: 'Não atribuída: origem link',
  no_shift: 'Não atribuída: sem turno',
  ambiguous: 'Não atribuída: turnos simultâneos',
} as const;
const CLASS_LABELS = { promoter: 'Promotor', passive: 'Passivo', detractor: 'Detrator' } as const;
const TYPE_LABELS = {
  compliment: 'Elogio',
  complaint: 'Reclamação',
  suggestion: 'Sugestão',
} as const;
const STATUS_LABELS = {
  received: 'Recebida',
  in_review: 'Em análise',
  forwarded: 'Encaminhada',
  resolved: 'Concluída',
  archived: 'Arquivada',
} as const;
const PRIORITY_LABELS = { low: 'Baixa', medium: 'Média', high: 'Alta' } as const;
const ROLE_LABELS: Record<UserRole, string> = {
  superadmin: 'Superadministrador',
  sector_admin: 'Administrador de setor',
  management: 'Gestão',
  ombudsman: 'Ouvidoria',
  viewer: 'Visualizador',
};
const REPORT_LABELS: Record<ReportType, string> = {
  responses: 'Respostas',
  indicators: 'Indicadores',
  manifestations: 'Manifestações',
};
const FILE_TYPES: Record<ReportType, string> = {
  responses: 'respostas',
  indicators: 'indicadores',
  manifestations: 'manifestacoes',
};

function tooLarge(): HttpError {
  return new HttpError(
    422,
    'EXPORT_TOO_LARGE',
    `O relatório passa de ${MAX_ROWS_PER_SHEET.toLocaleString('pt-BR')} linhas. Reduza o período ou use mais filtros.`,
  );
}

/** RN29: consulta com LIMIT 50.001 detecta o excesso sem ler a tabela inteira. */
function assertWithinLimit(rows: readonly unknown[]): void {
  if (rows.length > MAX_ROWS_PER_SHEET) throw tooLarge();
}

const compact = (date: string) => date.replaceAll('-', '');

/** Seção 4.3: fhdod_<tipo>_<AAAAMMDD>-<AAAAMMDD>_gerado-<AAAAMMDDHHmm>.xlsx (horário local). */
export function reportFileName(type: ReportType, from: string, to: string, now: Date): string {
  const generated = `${compact(localDateOf(now))}${localTimeOf(now).replace(':', '')}`;
  return `fhdod_${FILE_TYPES[type]}_${compact(from)}-${compact(to)}_gerado-${generated}.xlsx`;
}

const brDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

/** Aba Filtros (RF62: filtros e totais iguais aos da tela). */
async function filterRows(
  prisma: Pick<PrismaClient, 'sector' | 'surveyConfig' | 'team'>,
  filters: ResolvedFilters,
  query: ExportQuery,
  role: UserRole,
  now: Date,
  total: number,
): Promise<[string, CellValue | boolean][]> {
  const [sectors, survey, teams] = await Promise.all([
    filters.sectorIds === undefined
      ? Promise.resolve(null)
      : prisma.sector.findMany({
          where: { id: { in: [...filters.sectorIds] } },
          select: { name: true },
          orderBy: { name: 'asc' },
        }),
    filters.surveyId === undefined
      ? Promise.resolve(null)
      : prisma.surveyConfig.findUnique({
          where: { id: filters.surveyId },
          select: { title: true },
        }),
    filters.teamIds === undefined
      ? Promise.resolve(null)
      : prisma.team.findMany({
          where: { id: { in: [...filters.teamIds] } },
          select: { name: true },
          orderBy: { name: 'asc' },
        }),
  ]);
  const rows: [string, CellValue | boolean][] = [
    ['Relatório', REPORT_LABELS[query.type]],
    ['Período', `${brDate(filters.from)} a ${brDate(filters.to)}`],
    [
      'Setores',
      sectors === null
        ? 'Todos os setores do escopo'
        : sectors.length === 0
          ? 'Nenhum setor no escopo'
          : sectors.map((sector) => sector.name).join(', '),
    ],
    ['Pesquisa', survey === null ? 'Todas' : survey.title],
    ['Turno', filters.period === undefined ? 'Todos' : PERIOD_LABELS[filters.period]],
    ['Equipes', teams === null ? 'Todas' : teams.map((team) => team.name).join(', ')],
    ['Origem', filters.origin === undefined ? 'Todas' : ORIGIN_LABELS[filters.origin]],
  ];
  if (query.type === 'manifestations') {
    rows.push(
      ['Status', query.status?.map((status) => STATUS_LABELS[status]).join(', ') ?? 'Todos'],
      [
        'Tipo de manifestação',
        query.manifestationType?.map((type) => TYPE_LABELS[type]).join(', ') ?? 'Todos',
      ],
      ['Incluir textos', query.includeText === true],
    );
  }
  rows.push(
    ['Total de registros', total],
    ['Gerado em', excelDateTime(now)],
    ['Perfil', ROLE_LABELS[role]],
  );
  return rows;
}

function styleDateCells(sheet: ExcelJS.Worksheet, label: string): void {
  sheet.eachRow((row) => {
    if (row.getCell(1).value === label) row.getCell(2).numFmt = DATE_TIME_FORMAT;
  });
}

function indicatorRows(prefix: string, indicators: NpsIndicator): [string, CellValue][] {
  return [
    [`${prefix}Respostas consideradas (n)`, indicators.n],
    [`${prefix}NPS`, indicators.nps],
    [`${prefix}Promotores`, indicators.promoters],
    [`${prefix}Promotores (%)`, indicators.promotersPercent],
    [`${prefix}Passivos`, indicators.passives],
    [`${prefix}Passivos (%)`, indicators.passivesPercent],
    [`${prefix}Detratores`, indicators.detractors],
    [`${prefix}Detratores (%)`, indicators.detractorsPercent],
  ];
}

async function summaryRows(
  prisma: PrismaClient,
  filters: ResolvedFilters,
): Promise<[string, CellValue][]> {
  const summary = await getSummary(prisma, filters, false);
  return [
    ...indicatorRows('', summary.indicators),
    ['Respostas atribuídas a turno e equipe', summary.coverage.attributed],
    ['Cobertura de atribuição (%)', summary.coverage.percent],
    ['Manifestações', summary.manifestations.total],
    ['Elogios', summary.manifestations.compliment],
    ['Reclamações', summary.manifestations.complaint],
    ['Sugestões', summary.manifestations.suggestion],
  ];
}

interface ResponseRow {
  id: string;
  submitted_at: Date;
  sector: string;
  survey: string;
  version: number;
  origin: keyof typeof ORIGIN_LABELS;
  shift_period: keyof typeof PERIOD_LABELS | null;
  team: string | null;
  attribution: keyof typeof ATTRIBUTION_LABELS;
  nps_score: number;
  low_score: boolean;
}

interface AnswerRow {
  id: string;
  submitted_at: Date;
  sector: string;
  survey: string;
  version: number;
  stage: string | null;
  question: string;
  score: number;
}

/** RF63 — abas Filtros, Indicadores, Respostas e Respostas por pergunta, sem dados pessoais. */
async function responsesWorkbook(
  prisma: PrismaClient,
  workbook: ExcelJS.Workbook,
  filters: ResolvedFilters,
  addFilters: (total: number) => Promise<void>,
): Promise<number> {
  const where = Prisma.sql`s.hospital_id = ${filters.hospitalId}::uuid AND ${responseConditions(filters)}`;
  const [responses, answers, indicators] = await Promise.all([
    prisma.$queryRaw<ResponseRow[]>`
      SELECT r.id::text AS id, r.submitted_at, s.name AS sector, sv.title AS survey,
             sv.version_number::int AS version, r.origin::text AS origin,
             r.shift_period::text AS shift_period, t.name AS team,
             r.attribution_status::text AS attribution, r.nps_score::int AS nps_score, r.low_score
      FROM ${RESPONSES_FROM} LEFT JOIN teams t ON t.id = r.team_id
      WHERE ${where}
      ORDER BY r.submitted_at, r.id
      LIMIT ${MAX_ROWS_PER_SHEET + 1}`,
    prisma.$queryRaw<AnswerRow[]>`
      SELECT r.id::text AS id, r.submitted_at, s.name AS sector, sv.title AS survey,
             sv.version_number::int AS version, svq.journey_stage_name AS stage,
             svq.text AS question, a.score::int AS score
      FROM response_answers a
      JOIN ${RESPONSES_FROM} ON r.id = a.response_id
      JOIN survey_version_questions svq ON svq.id = a.survey_version_question_id
      WHERE ${where}
      ORDER BY r.submitted_at, r.id, svq.position
      LIMIT ${MAX_ROWS_PER_SHEET + 1}`,
    summaryRows(prisma, filters),
  ]);
  assertWithinLimit(responses);
  assertWithinLimit(answers);

  await addFilters(responses.length);
  addKeyValueSheet(workbook, 'Indicadores', indicators, ['Indicador', 'Valor']);
  addTableSheet(
    workbook,
    'Respostas',
    [
      { header: 'ID', width: 38 },
      { header: 'Data e hora', width: 18, numFmt: DATE_TIME_FORMAT },
      { header: 'Setor', width: 28 },
      { header: 'Pesquisa', width: 32 },
      { header: 'Versão', width: 8 },
      { header: 'Origem', width: 10 },
      { header: 'Turno', width: 10 },
      { header: 'Equipe', width: 24 },
      { header: 'Atribuição', width: 32 },
      { header: 'Nota', width: 8 },
      { header: 'Classificação', width: 14 },
      { header: 'Nota baixa', width: 11 },
    ],
    responses.map((row) => [
      row.id,
      excelDateTime(row.submitted_at),
      row.sector,
      row.survey,
      row.version,
      ORIGIN_LABELS[row.origin],
      row.shift_period === null ? null : PERIOD_LABELS[row.shift_period],
      row.team,
      ATTRIBUTION_LABELS[row.attribution],
      row.nps_score,
      CLASS_LABELS[classifyNps(row.nps_score)],
      row.low_score,
    ]),
  );
  addTableSheet(
    workbook,
    'Respostas por pergunta',
    [
      { header: 'ID da resposta', width: 38 },
      { header: 'Data e hora', width: 18, numFmt: DATE_TIME_FORMAT },
      { header: 'Setor', width: 28 },
      { header: 'Pesquisa', width: 32 },
      { header: 'Versão', width: 8 },
      { header: 'Etapa', width: 16 },
      { header: 'Pergunta', width: 60 },
      { header: 'Nota (1 a 5)', width: 12 },
    ],
    answers.map((row) => [
      row.id,
      excelDateTime(row.submitted_at),
      row.sector,
      row.survey,
      row.version,
      row.stage,
      row.question,
      row.score,
    ]),
  );
  return responses.length;
}

/** RF64 — abas Filtros, Resumo, Por setor, Por pergunta e Tendência, iguais a E28, E29, E33 e E32. */
async function indicatorsWorkbook(
  prisma: PrismaClient,
  workbook: ExcelJS.Workbook,
  filters: ResolvedFilters,
  addFilters: (total: number) => Promise<void>,
): Promise<number> {
  const [summary, sectors, questions, trends] = await Promise.all([
    summaryRows(prisma, filters),
    getSectors(prisma, filters),
    getQuestions(prisma, filters),
    getTrends(prisma, filters),
  ]);
  const total = Number(summary[0]?.[1] ?? 0);
  await addFilters(total);
  addKeyValueSheet(workbook, 'Resumo', summary, ['Indicador', 'Valor']);
  addTableSheet(
    workbook,
    'Por setor',
    [
      { header: 'Setor', width: 30 },
      { header: 'Código', width: 12 },
      { header: 'Situação', width: 12 },
      { header: 'Respostas (n)', width: 14 },
      { header: 'NPS', width: 10 },
      { header: 'Promotores', width: 12 },
      { header: 'Passivos', width: 12 },
      { header: 'Detratores', width: 12 },
    ],
    sectors.map((sector) => [
      sector.name,
      sector.code,
      sector.isActive ? 'Ativo' : 'Inativo',
      sector.indicators.n,
      sector.indicators.nps,
      sector.indicators.promoters,
      sector.indicators.passives,
      sector.indicators.detractors,
    ]),
  );
  addTableSheet(
    workbook,
    'Por pergunta',
    [
      { header: 'Etapa', width: 16 },
      { header: 'Pesquisa', width: 32 },
      { header: 'Pergunta', width: 60 },
      { header: 'Respostas (n)', width: 14 },
      { header: 'Média', width: 10, numFmt: '0.00' },
      { header: 'Nota 1', width: 9 },
      { header: 'Nota 2', width: 9 },
      { header: 'Nota 3', width: 9 },
      { header: 'Nota 4', width: 9 },
      { header: 'Nota 5', width: 9 },
      { header: 'Notas 4 e 5 (%)', width: 16 },
    ],
    questions.items.map((item) => [
      item.journeyStage.name,
      item.survey.title,
      item.text,
      item.n,
      item.average,
      ...(item.distribution ?? []).map((entry) => entry.count),
      item.topTwoPercent,
    ]),
  );
  addTableSheet(
    workbook,
    'Tendência',
    [
      { header: 'Início', width: 12 },
      { header: 'Fim', width: 12 },
      { header: 'Respostas (n)', width: 14 },
      { header: 'NPS', width: 10 },
    ],
    trends.points.map((point) => [brDate(point.start), brDate(point.end), point.n, point.nps]),
  );
  return total;
}

/** RF65 — relatório da Ouvidoria: descrição e providências só com includeText; nunca contato. */
async function manifestationsWorkbook(
  prisma: PrismaClient,
  workbook: ExcelJS.Workbook,
  auth: AuthContext,
  filters: ResolvedFilters,
  query: ExportQuery,
  addFilters: (total: number) => Promise<void>,
): Promise<number> {
  const includeText = query.includeText === true;
  const where: Prisma.ManifestationWhereInput = {
    ...sectorWhere(auth.scope, filters.sectorIds),
    sector: { hospitalId: auth.hospitalId },
    receivedAt: { gte: startOfLocalDay(filters.from), lt: startOfLocalDay(addDays(filters.to, 1)) },
    ...(query.status === undefined ? {} : { status: { in: query.status } }),
    ...(query.manifestationType === undefined ? {} : { type: { in: query.manifestationType } }),
    response: {
      ...(filters.origin === undefined ? {} : { origin: filters.origin }),
      ...(filters.period === undefined ? {} : { shiftPeriod: filters.period }),
      ...(filters.teamIds === undefined ? {} : { teamId: { in: [...filters.teamIds] } }),
      ...(filters.surveyId === undefined
        ? {}
        : { surveyVersion: { surveyConfigId: filters.surveyId } }),
    },
  };
  const rows = await prisma.manifestation.findMany({
    where,
    orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
    take: MAX_ROWS_PER_SHEET + 1,
    select: {
      protocol: true,
      receivedAt: true,
      resolvedAt: true,
      type: true,
      status: true,
      priority: true,
      isAnonymous: true,
      description: includeText,
      actionsTaken: includeText,
      sector: { select: { name: true } },
      // Somente a existência do contato; nome, telefone e e-mail nunca são lidos (RN29).
      contact: { select: { manifestationId: true } },
    },
  });
  assertWithinLimit(rows);
  await addFilters(rows.length);
  addTableSheet(
    workbook,
    'Manifestações',
    [
      { header: 'Protocolo', width: 18 },
      { header: 'Recebida em', width: 18, numFmt: DATE_TIME_FORMAT },
      { header: 'Concluída em', width: 18, numFmt: DATE_TIME_FORMAT },
      { header: 'Setor', width: 28 },
      { header: 'Tipo', width: 13 },
      { header: 'Status', width: 13 },
      { header: 'Prioridade', width: 11 },
      { header: 'Anônima', width: 10 },
      { header: 'Possui contato', width: 15 },
      ...(includeText
        ? [
            { header: 'Descrição', width: 80 },
            { header: 'Providências', width: 80 },
          ]
        : []),
    ],
    rows.map((row) => [
      row.protocol,
      excelDateTime(row.receivedAt),
      excelDateTime(row.resolvedAt),
      row.sector.name,
      TYPE_LABELS[row.type],
      STATUS_LABELS[row.status],
      PRIORITY_LABELS[row.priority],
      row.isAnonymous,
      row.contact !== null,
      ...(includeText ? [row.description, row.actionsTaken] : []),
    ]),
  );
  return rows.length;
}

export interface ExportResult {
  fileName: string;
  buffer: Buffer;
  rows: number;
}

/**
 * E34 — gera o .xlsx do tipo pedido com os filtros do dashboard e o escopo do perfil (RF62–RF67).
 * Mais de 50.000 linhas em uma aba → 422 EXPORT_TOO_LARGE. A exportação é auditada
 * (REPORT_EXPORTED) antes de o arquivo ser entregue: sem auditoria, sem arquivo.
 */
export async function exportReport(
  prisma: PrismaClient,
  auth: AuthContext,
  audit: AuditContext,
  query: ExportQuery,
  now: Date,
): Promise<ExportResult> {
  const filters = await resolveFilters(prisma, auth, query, now);
  const workbook = newWorkbook(now);
  const addFilters = async (total: number) => {
    const rows = await filterRows(prisma, filters, query, auth.role, now, total);
    styleDateCells(addKeyValueSheet(workbook, 'Filtros', rows, ['Filtro', 'Valor']), 'Gerado em');
  };
  let rows: number;
  if (query.type === 'responses') {
    rows = await responsesWorkbook(prisma, workbook, filters, addFilters);
  } else if (query.type === 'indicators') {
    rows = await indicatorsWorkbook(prisma, workbook, filters, addFilters);
  } else {
    rows = await manifestationsWorkbook(prisma, workbook, auth, filters, query, addFilters);
  }
  const buffer = await toBuffer(workbook);
  await recordAudit(prisma, audit, {
    action: 'REPORT_EXPORTED',
    entityType: 'report',
    entityId: query.type,
    details: {
      type: query.type,
      from: filters.from,
      to: filters.to,
      rows,
      includeText: query.includeText === true,
      sectorIds: filters.sectorIds ?? 'all',
    },
  });
  return { fileName: reportFileName(query.type, filters.from, filters.to, now), buffer, rows };
}
