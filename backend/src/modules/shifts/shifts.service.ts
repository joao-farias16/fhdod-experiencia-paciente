import type { Prisma, PrismaClient, ShiftPeriod, TransactionClient } from '../../lib/prisma.js';
import { type AuditContext, recordAudit } from '../../services/audit.service.js';
import { isSectorInScope, resourceNotFound, sectorOutOfScope } from '../../services/scope.js';
import type { Clock } from '../../utils/clock.js';
import { addDays, localDateOf, localTimeOf, startOfLocalDay } from '../../utils/dates.js';
import { HttpError } from '../../utils/http-error.js';
import { isConstraintViolation } from '../../utils/prisma-errors.js';
import { VALIDATION_MESSAGE } from '../../utils/validation.js';
import type { AuthContext } from '../auth/auth.types.js';
import { sectorInactive } from '../teams/teams.service.js';
import { computeShiftWindow, isDateInShiftWindow, shiftDateWindow } from './shift-rules.js';
import type { CancelShiftInput, CreateShiftInput, ListShiftsQuery } from './shifts.schemas.js';

export interface ShiftDto {
  id: string;
  sectorId: string;
  team: { id: string; code: string; name: string; isActive: boolean };
  period: ShiftPeriod;
  source: 'manual' | 'import';
  importId: string | null;
  /** Data e horas locais (America/Sao_Paulo) para exibição (RF20, RN25). */
  date: string;
  startTime: string;
  endTime: string;
  endsNextDay: boolean;
  startsAt: string;
  endsAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
}

const shiftSelect = {
  id: true,
  sectorId: true,
  period: true,
  source: true,
  importId: true,
  startsAt: true,
  endsAt: true,
  cancelledAt: true,
  cancelReason: true,
  createdAt: true,
  team: { select: { id: true, code: true, name: true, isActive: true } },
} as const;

type ShiftRecord = Prisma.ShiftGetPayload<{ select: typeof shiftSelect }>;

export function toShiftDto(shift: ShiftRecord): ShiftDto {
  const date = localDateOf(shift.startsAt);
  return {
    id: shift.id,
    sectorId: shift.sectorId,
    team: shift.team,
    period: shift.period,
    source: shift.source,
    importId: shift.importId,
    date,
    startTime: localTimeOf(shift.startsAt),
    endTime: localTimeOf(shift.endsAt),
    endsNextDay: localDateOf(shift.endsAt) !== date,
    startsAt: shift.startsAt.toISOString(),
    endsAt: shift.endsAt.toISOString(),
    cancelledAt: shift.cancelledAt?.toISOString() ?? null,
    cancelReason: shift.cancelReason,
    createdAt: shift.createdAt.toISOString(),
  };
}

export function shiftOverlap(): HttpError {
  return new HttpError(
    409,
    'SHIFT_OVERLAP',
    'A equipe já tem um turno que se sobrepõe a este horário.',
  );
}

export function teamInactive(): HttpError {
  return new HttpError(
    422,
    'TEAM_INACTIVE',
    'A equipe está desativada e não pode receber turnos. Reative a equipe antes de continuar.',
  );
}

/**
 * E17 — escala do setor no intervalo de datas locais (até 62 dias): turnos que começam ou
 * terminam dentro do intervalo, com horários no fuso local (RF20). Setor fora do escopo → 403.
 */
export async function listShifts(
  prisma: Pick<PrismaClient, 'shift' | 'sector'>,
  auth: AuthContext,
  query: ListShiftsQuery,
): Promise<ShiftDto[]> {
  if (!isSectorInScope(auth.scope, query.sectorId)) throw sectorOutOfScope();
  const sector = await prisma.sector.findFirst({
    where: { id: query.sectorId, hospitalId: auth.hospitalId },
    select: { id: true },
  });
  if (sector === null) throw resourceNotFound();

  const from = startOfLocalDay(query.from);
  const toExclusive = startOfLocalDay(addDays(query.to, 1));
  const shifts = await prisma.shift.findMany({
    where: {
      sectorId: query.sectorId,
      startsAt: { lt: toExclusive },
      endsAt: { gt: from },
      ...(query.teamId === undefined ? {} : { teamId: query.teamId }),
      ...(query.includeCancelled === true ? {} : { cancelledAt: null }),
    },
    orderBy: [{ startsAt: 'asc' }, { team: { name: 'asc' } }],
    select: shiftSelect,
  });
  return shifts.map(toShiftDto);
}

/**
 * Turno não cancelado da equipe que se sobrepõe ao intervalo (mesma regra do EXCLUDE
 * shifts_no_overlap_per_team), usado para responder 409 antes de chegar ao banco.
 */
export async function findOverlappingShift(
  tx: Pick<TransactionClient, 'shift'>,
  teamId: string,
  startsAt: Date,
  endsAt: Date,
): Promise<{ id: string } | null> {
  return tx.shift.findFirst({
    where: { teamId, cancelledAt: null, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
    select: { id: true },
  });
}

/**
 * E18 — cadastro manual de turno (RF19): equipe do escopo (404), equipe e setor ativos (422), data
 * na janela (422), duração de 1 a 24 h (400) e sem sobreposição na equipe (409 SHIFT_OVERLAP).
 */
export async function createShift(
  prisma: PrismaClient,
  clock: Clock,
  auth: AuthContext,
  audit: AuditContext,
  input: CreateShiftInput,
): Promise<ShiftDto> {
  const window = computeShiftWindow(input.date, input.startTime, input.endTime);
  if (!window.ok) {
    throw new HttpError(400, 'VALIDATION_ERROR', VALIDATION_MESSAGE, [
      { field: 'endTime', message: 'O turno deve durar de 1 a 24 horas.' },
    ]);
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const team = await tx.team.findUnique({
        where: { id: input.teamId },
        select: {
          sectorId: true,
          isActive: true,
          sector: { select: { hospitalId: true, isActive: true } },
        },
      });
      if (team?.sector.hospitalId !== auth.hospitalId) throw resourceNotFound();
      if (!isSectorInScope(auth.scope, team.sectorId)) throw resourceNotFound();
      if (!team.sector.isActive) throw sectorInactive();
      if (!team.isActive) throw teamInactive();
      if (!isDateInShiftWindow(input.date, clock.now())) {
        const { min, max } = shiftDateWindow(clock.now());
        throw new HttpError(
          422,
          'DATE_OUT_OF_RANGE',
          `A data deve estar entre ${min} e ${max} (de 30 dias antes a 180 dias depois de hoje).`,
          [{ field: 'date', message: 'Escolha uma data dentro da janela permitida.' }],
        );
      }
      if ((await findOverlappingShift(tx, input.teamId, window.startsAt, window.endsAt)) !== null) {
        throw shiftOverlap();
      }

      const created = await tx.shift.create({
        data: {
          sectorId: team.sectorId,
          teamId: input.teamId,
          period: input.period,
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          source: 'manual',
          createdById: auth.profileId,
        },
        select: shiftSelect,
      });
      await recordAudit(tx, audit, {
        action: 'SHIFT_CREATED',
        entityType: 'shift',
        entityId: created.id,
        sectorId: team.sectorId,
        details: { teamId: input.teamId, period: input.period, source: 'manual' },
      });
      return toShiftDto(created);
    });
  } catch (error) {
    // Corrida entre dois cadastros: a restrição de exclusão do banco decide (RNF18).
    if (isConstraintViolation(error, 'shifts_no_overlap_per_team')) throw shiftOverlap();
    throw error;
  }
}

/**
 * E19 — cancelamento irreversível com motivo (RF21). O turno cancelado é ignorado em novas
 * atribuições; as respostas já atribuídas permanecem (RN11, RN15). Já cancelado → 409.
 */
export async function cancelShift(
  prisma: PrismaClient,
  clock: Clock,
  auth: AuthContext,
  audit: AuditContext,
  id: string,
  input: CancelShiftInput,
): Promise<ShiftDto> {
  return prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM shifts WHERE id = ${id}::uuid FOR UPDATE`;
    const current =
      locked === undefined
        ? null
        : await tx.shift.findUnique({
            where: { id },
            select: { sectorId: true, cancelledAt: true, sector: { select: { hospitalId: true } } },
          });
    if (current?.sector.hospitalId !== auth.hospitalId) throw resourceNotFound();
    if (!isSectorInScope(auth.scope, current.sectorId)) throw resourceNotFound();
    if (current.cancelledAt !== null) {
      throw new HttpError(409, 'SHIFT_ALREADY_CANCELLED', 'Este turno já foi cancelado.');
    }
    const updated = await tx.shift.update({
      where: { id },
      data: { cancelledAt: clock.now(), cancelledById: auth.profileId, cancelReason: input.reason },
      select: shiftSelect,
    });
    await recordAudit(tx, audit, {
      action: 'SHIFT_CANCELLED',
      entityType: 'shift',
      entityId: id,
      sectorId: current.sectorId,
      details: { reasonLength: input.reason.length },
    });
    return toShiftDto(updated);
  });
}
