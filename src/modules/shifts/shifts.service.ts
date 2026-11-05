import { randomUUID } from 'node:crypto';

import type { Database, Queryable } from '../../lib/database.js';
import type { ShiftPeriod } from '../../lib/domain-types.js';
import {
  addDays,
  type Clock,
  localDateOf,
  localTimeOf,
  startOfLocalDay,
} from '../../utils/dates.js';
import { HttpError, isConstraintViolation } from '../../utils/errors.js';
import { invalidField } from '../../utils/validation.js';
import { type AuditContext, recordAudit } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { isSectorInScope, resourceNotFound, sectorOutOfScope } from '../auth/scope.js';
import { findSectorState } from '../sectors/sectors.repository.js';
import { sectorInactive } from '../sectors/sectors.service.js';
import { findTeam, lockTeam } from '../teams/teams.repository.js';
import { computeShiftWindow, isDateInShiftWindow, shiftDateWindow } from './shift-rules.js';
import {
  cancelShiftRow,
  findOverlappingShiftId,
  findShift,
  insertShifts,
  listShiftRecords,
  lockShiftForCancellation,
  type ShiftRecord,
} from './shifts.repository.js';
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
  db: Queryable,
  auth: AuthContext,
  query: ListShiftsQuery,
): Promise<ShiftDto[]> {
  if (!isSectorInScope(auth.scope, query.sectorId)) throw sectorOutOfScope();
  if ((await findSectorState(db, auth.hospitalId, query.sectorId)) === null) {
    throw resourceNotFound();
  }
  const shifts = await listShiftRecords(db, {
    sectorId: query.sectorId,
    from: startOfLocalDay(query.from),
    toExclusive: startOfLocalDay(addDays(query.to, 1)),
    teamId: query.teamId,
    includeCancelled: query.includeCancelled === true,
  });
  return shifts.map(toShiftDto);
}

/**
 * E18 — cadastro manual de turno (RF19): equipe do escopo (404), equipe e setor ativos (422), data
 * na janela (422), duração de 1 a 24 h (400) e sem sobreposição na equipe (409 SHIFT_OVERLAP).
 */
export async function createShift(
  db: Database,
  clock: Clock,
  auth: AuthContext,
  audit: AuditContext,
  input: CreateShiftInput,
): Promise<ShiftDto> {
  const window = computeShiftWindow(input.date, input.startTime, input.endTime);
  if (!window.ok) {
    throw invalidField('endTime', 'O turno deve durar de 1 a 24 horas.');
  }
  try {
    return await db.transaction(async (tx) => {
      const team = await findTeam(tx, input.teamId);
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
      // Serializa os cadastros da equipe antes de conferir a sobreposição (RNF18).
      await lockTeam(tx, input.teamId);
      const overlapping = await findOverlappingShiftId(
        tx,
        input.teamId,
        window.startsAt,
        window.endsAt,
      );
      if (overlapping !== null) throw shiftOverlap();

      const id = randomUUID();
      await insertShifts(tx, [
        {
          id,
          sectorId: team.sectorId,
          teamId: input.teamId,
          period: input.period,
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          source: 'manual',
          importId: null,
          createdById: auth.profileId,
        },
      ]);
      const created = await findShift(tx, id);
      if (created === null) throw resourceNotFound();
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
    // Corrida entre dois cadastros: o gatilho de sobreposição do banco decide (RNF18).
    if (isConstraintViolation(error, 'shifts_no_overlap_per_team')) throw shiftOverlap();
    throw error;
  }
}

/**
 * E19 — cancelamento irreversível com motivo (RF21). O turno cancelado é ignorado em novas
 * atribuições; as respostas já atribuídas permanecem (RN11, RN15). Já cancelado → 409.
 */
export async function cancelShift(
  db: Database,
  clock: Clock,
  auth: AuthContext,
  audit: AuditContext,
  id: string,
  input: CancelShiftInput,
): Promise<ShiftDto> {
  return db.transaction(async (tx) => {
    const current = await lockShiftForCancellation(tx, id);
    if (current?.hospitalId !== auth.hospitalId) throw resourceNotFound();
    if (!isSectorInScope(auth.scope, current.sectorId)) throw resourceNotFound();
    if (current.cancelledAt !== null) {
      throw new HttpError(409, 'SHIFT_ALREADY_CANCELLED', 'Este turno já foi cancelado.');
    }
    await cancelShiftRow(tx, id, { at: clock.now(), by: auth.profileId, reason: input.reason });
    const updated = await findShift(tx, id);
    if (updated === null) throw resourceNotFound();
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
