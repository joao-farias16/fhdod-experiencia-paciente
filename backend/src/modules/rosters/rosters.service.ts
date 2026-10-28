import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { PrismaClient, TransactionClient } from '../../lib/prisma.js';
import { type AuditContext, recordAudit } from '../../services/audit.service.js';
import { isSectorInScope, resourceNotFound, sectorOutOfScope } from '../../services/scope.js';
import type { Clock } from '../../utils/clock.js';
import { HttpError } from '../../utils/http-error.js';
import { isConstraintViolation } from '../../utils/prisma-errors.js';
import type { AuthContext } from '../auth/auth.types.js';
import { overlaps, SHIFT_PERIODS } from '../shifts/shift-rules.js';
import { shiftOverlap, teamInactive } from '../shifts/shifts.service.js';
import { sectorInactive } from '../teams/teams.service.js';
import {
  assertCsvFile,
  findOverlapsInFile,
  parseRosterCsv,
  ROSTER_HEADER,
  type RosterError,
  type RosterReference,
  rosterError,
  type StagedShift,
  validateRosterRows,
} from './roster-csv.js';

/** RN19: a importação validada pode ser confirmada em até 30 minutos. */
export const ROSTER_CONFIRMATION_MINUTES = 30;

/** Transação da confirmação: até 2.000 inserções e revalidação completa. */
const TRANSACTION_OPTIONS = { timeout: 30_000, maxWait: 5_000 } as const;

export interface RosterSummaryItem {
  sectorCode: string;
  sectorName: string;
  teamCode: string;
  teamName: string;
  shifts: number;
}

export interface RosterImportDto {
  id: string;
  status: 'validated' | 'rejected' | 'committed';
  fileName: string;
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  errors: RosterError[];
  summary: RosterSummaryItem[];
  expiresAt: string;
  createdAt: string;
  committedAt: string | null;
}

export interface UploadedFile {
  originalName: string;
  buffer: Buffer;
}

/** Nome exibido do arquivo: sem caminho nem caracteres de controle, até 255 caracteres. */
function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex -- remove caracteres de controle do nome recebido
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (clean === '' ? 'escala.csv' : clean).slice(0, 255);
}

/** Setores do hospital e equipes citados no arquivo, com a situação e o escopo do usuário. */
async function loadReference(
  tx: Pick<TransactionClient, 'sector' | 'team'>,
  auth: AuthContext,
  sectorCodes: readonly string[],
): Promise<RosterReference> {
  const sectors = await tx.sector.findMany({
    where: { hospitalId: auth.hospitalId, code: { in: [...new Set(sectorCodes)] } },
    select: { id: true, code: true, isActive: true },
  });
  const teams = await tx.team.findMany({
    where: { sectorId: { in: sectors.map((sector) => sector.id) } },
    select: { id: true, sectorId: true, code: true, isActive: true },
  });
  return {
    sectors: new Map(
      sectors.map((sector) => [
        sector.code,
        {
          id: sector.id,
          isActive: sector.isActive,
          inScope: isSectorInScope(auth.scope, sector.id),
        },
      ]),
    ),
    teams: new Map(
      teams.map((team) => [
        `${team.sectorId}:${team.code}`,
        { id: team.id, isActive: team.isActive },
      ]),
    ),
  };
}

/** Turnos não cancelados já cadastrados que se sobrepõem às linhas (OVERLAP_EXISTING). */
async function findExistingOverlaps(
  tx: Pick<TransactionClient, 'shift'>,
  staged: readonly StagedShift[],
): Promise<StagedShift[]> {
  if (staged.length === 0) return [];
  const starts = staged.map((row) => row.startsAt).sort();
  const ends = staged.map((row) => row.endsAt).sort();
  const existing = await tx.shift.findMany({
    where: {
      teamId: { in: [...new Set(staged.map((row) => row.teamId))] },
      cancelledAt: null,
      startsAt: { lt: new Date(ends.at(-1) ?? '') },
      endsAt: { gt: new Date(starts[0] ?? '') },
    },
    select: { teamId: true, startsAt: true, endsAt: true },
  });
  return staged.filter((row) =>
    existing.some(
      (shift) =>
        shift.teamId === row.teamId &&
        overlaps(shift, { startsAt: new Date(row.startsAt), endsAt: new Date(row.endsAt) }),
    ),
  );
}

const COLUMN_ORDER: readonly string[] = ['cabecalho', ...ROSTER_HEADER];

/** Erros únicos, em ordem de linha e de coluna do arquivo. */
function dedupe(errors: readonly RosterError[]): RosterError[] {
  const seen = new Set<string>();
  return errors
    .filter((error) => {
      const key = `${error.line}|${error.column}|${error.code}|${error.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (a, b) => a.line - b.line || COLUMN_ORDER.indexOf(a.column) - COLUMN_ORDER.indexOf(b.column),
    );
}

async function summarize(
  client: Pick<TransactionClient, 'team'>,
  staged: readonly StagedShift[],
): Promise<RosterSummaryItem[]> {
  const counts = new Map<string, number>();
  for (const row of staged) counts.set(row.teamId, (counts.get(row.teamId) ?? 0) + 1);
  if (counts.size === 0) return [];
  const teams = await client.team.findMany({
    where: { id: { in: [...counts.keys()] } },
    select: { id: true, code: true, name: true, sector: { select: { code: true, name: true } } },
  });
  return teams
    .map((team) => ({
      sectorCode: team.sector.code,
      sectorName: team.sector.name,
      teamCode: team.code,
      teamName: team.name,
      shifts: counts.get(team.id) ?? 0,
    }))
    .sort(
      (a, b) => a.sectorName.localeCompare(b.sectorName) || a.teamName.localeCompare(b.teamName),
    );
}

const stagedRowsSchema = z.array(
  z.object({
    line: z.number().int(),
    sectorId: z.uuid(),
    teamId: z.uuid(),
    period: z.enum(SHIFT_PERIODS),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
  }),
);

const errorsSchema = z.array(
  z.object({ line: z.number(), column: z.string(), code: z.string(), message: z.string() }),
);

/**
 * E20 — pré-validação do CSV (RF22): valida o arquivo e todas as linhas SEM gravar turnos e
 * registra a importação como `validated` (linhas guardadas em staged_rows por até 30 minutos) ou
 * `rejected` (erros por linha e coluna). Erros de arquivo → 400/413/415 sem registro.
 */
export async function validateRosterImport(
  prisma: PrismaClient,
  clock: Clock,
  auth: AuthContext,
  audit: AuditContext,
  file: UploadedFile,
): Promise<RosterImportDto> {
  const fileName = safeFileName(file.originalName);
  assertCsvFile(fileName, file.buffer);
  const parsed = parseRosterCsv(file.buffer);
  const now = clock.now();
  const totalRows = parsed.rows.length;

  return prisma.$transaction(async (tx) => {
    let errors: RosterError[];
    let staged: StagedShift[] = [];
    let rejectedLines: Set<number>;

    if (!parsed.headerValid) {
      // Cabeçalho inválido: nenhuma linha pode ser interpretada com segurança.
      errors = [rosterError(parsed.headerLine, 'cabecalho', 'CSV_HEADER_INVALID')];
      rejectedLines = new Set(parsed.rows.map((row) => row.line));
    } else {
      const reference = await loadReference(
        tx,
        auth,
        parsed.rows.map((row) => row.values.setor_codigo),
      );
      const validated = validateRosterRows(parsed.rows, reference, now);
      const inFile = findOverlapsInFile(validated.staged);
      const inFileLines = new Set(inFile.map((error) => error.line));
      const candidates = validated.staged.filter((row) => !inFileLines.has(row.line));
      const existing = await findExistingOverlaps(tx, candidates);
      errors = dedupe([
        ...validated.errors,
        ...inFile,
        ...existing.map((row) => rosterError(row.line, 'hora_inicio', 'OVERLAP_EXISTING')),
      ]);
      rejectedLines = new Set(errors.map((error) => error.line));
      staged = validated.staged.filter((row) => !rejectedLines.has(row.line));
    }

    const rejectedRows = rejectedLines.size;
    const status = rejectedRows === 0 ? 'validated' : 'rejected';
    const sectorIds = [...new Set(staged.map((row) => row.sectorId))];
    const created = await tx.shiftImport.create({
      data: {
        uploadedById: auth.profileId,
        fileName,
        fileSha256: createHash('sha256').update(file.buffer).digest('hex'),
        status,
        totalRows,
        acceptedRows: totalRows - rejectedRows,
        rejectedRows,
        errors: errors.map((error) => ({ ...error })),
        stagedRows: status === 'validated' ? staged.map((row) => ({ ...row })) : [],
        createdAt: now,
        expiresAt: new Date(now.getTime() + ROSTER_CONFIRMATION_MINUTES * 60_000),
      },
      select: { id: true, createdAt: true, expiresAt: true },
    });
    await recordAudit(tx, audit, {
      action: status === 'validated' ? 'ROSTER_IMPORT_VALIDATED' : 'ROSTER_IMPORT_REJECTED',
      entityType: 'shift_import',
      entityId: created.id,
      sectorId: sectorIds.length === 1 ? sectorIds[0] : undefined,
      details: { totalRows, acceptedRows: totalRows - rejectedRows, rejectedRows },
    });
    return {
      id: created.id,
      status,
      fileName,
      totalRows,
      acceptedRows: totalRows - rejectedRows,
      rejectedRows,
      errors,
      summary: status === 'validated' ? await summarize(tx, staged) : [],
      expiresAt: created.expiresAt.toISOString(),
      createdAt: created.createdAt.toISOString(),
      committedAt: null,
    };
  });
}

/**
 * E21 — confirmação (RF23): somente a própria importação `validated` e dentro de 30 minutos;
 * revalida escopo, setores, equipes e sobreposições e grava todos os turnos numa única transação
 * (RN19, tudo ou nada). Confirmada, expirada, rejeitada ou sobreposta → 409; inativos → 422.
 */
export async function confirmRosterImport(
  prisma: PrismaClient,
  clock: Clock,
  auth: AuthContext,
  audit: AuditContext,
  id: string,
): Promise<RosterImportDto> {
  try {
    return await prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM shift_imports WHERE id = ${id}::uuid FOR UPDATE`;
      const current =
        locked === undefined ? null : await tx.shiftImport.findUnique({ where: { id } });
      if (current?.uploadedById !== auth.profileId) throw resourceNotFound();

      if (current.status === 'committed') {
        throw new HttpError(409, 'IMPORT_ALREADY_COMMITTED', 'Esta importação já foi confirmada.');
      }
      if (current.status === 'rejected') {
        throw new HttpError(
          409,
          'IMPORT_REJECTED',
          'Esta importação tem erros. Corrija o arquivo e envie de novo.',
        );
      }
      const now = clock.now();
      if (now > current.expiresAt) {
        throw new HttpError(
          409,
          'IMPORT_EXPIRED',
          'O prazo de 30 minutos para confirmar terminou. Envie o arquivo de novo.',
        );
      }

      const staged = stagedRowsSchema.parse(current.stagedRows);
      const sectorIds = [...new Set(staged.map((row) => row.sectorId))];
      if (sectorIds.some((sectorId) => !isSectorInScope(auth.scope, sectorId))) {
        throw sectorOutOfScope();
      }
      const sectors = await tx.sector.findMany({
        where: { id: { in: sectorIds } },
        select: { isActive: true },
      });
      if (sectors.length !== sectorIds.length || sectors.some((sector) => !sector.isActive)) {
        throw sectorInactive();
      }
      const teamIds = [...new Set(staged.map((row) => row.teamId))];
      const teams = await tx.team.findMany({
        where: { id: { in: teamIds } },
        select: { isActive: true },
      });
      if (teams.length !== teamIds.length || teams.some((team) => !team.isActive)) {
        throw teamInactive();
      }
      if ((await findExistingOverlaps(tx, staged)).length > 0) throw shiftOverlap();

      const result = await tx.shift.createMany({
        data: staged.map((row) => ({
          sectorId: row.sectorId,
          teamId: row.teamId,
          period: row.period,
          startsAt: new Date(row.startsAt),
          endsAt: new Date(row.endsAt),
          source: 'import' as const,
          importId: id,
          createdById: auth.profileId,
        })),
      });
      const updated = await tx.shiftImport.update({
        where: { id },
        data: { status: 'committed', committedAt: now, committedById: auth.profileId },
      });
      await recordAudit(tx, audit, {
        action: 'ROSTER_IMPORT_COMMITTED',
        entityType: 'shift_import',
        entityId: id,
        sectorId: sectorIds.length === 1 ? sectorIds[0] : undefined,
        details: { createdShifts: result.count },
      });
      return {
        id,
        status: 'committed',
        fileName: updated.fileName,
        totalRows: updated.totalRows,
        acceptedRows: updated.acceptedRows,
        rejectedRows: updated.rejectedRows,
        errors: errorsSchema.parse(updated.errors) as RosterError[],
        summary: await summarize(tx, staged),
        expiresAt: updated.expiresAt.toISOString(),
        createdAt: updated.createdAt.toISOString(),
        committedAt: now.toISOString(),
      };
    }, TRANSACTION_OPTIONS);
  } catch (error) {
    if (isConstraintViolation(error, 'shifts_no_overlap_per_team')) throw shiftOverlap();
    throw error;
  }
}
