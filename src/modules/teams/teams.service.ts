import { randomUUID } from 'node:crypto';

import type { Database, Queryable } from '../../lib/database.js';
import type { Clock } from '../../utils/dates.js';
import { HttpError, isUniqueViolation } from '../../utils/errors.js';
import { type AuditContext, recordAudit } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import {
  isSectorInScope,
  resolveSectorFilter,
  resourceNotFound,
  sectorOutOfScope,
} from '../auth/scope.js';
import { findSectorState } from '../sectors/sectors.repository.js';
import { sectorInactive } from '../sectors/sectors.service.js';
import {
  findTeam,
  findTeamIdByCode,
  insertTeam,
  type JourneyStageRecord,
  listJourneyStageRecords,
  listTeamRecords,
  type TeamRecord,
  updateTeamRow,
} from './teams.repository.js';
import type { CreateTeamInput, ListTeamsQuery, UpdateTeamInput } from './teams.schemas.js';

export interface TeamDto {
  id: string;
  sectorId: string;
  sectorCode: string;
  sectorName: string;
  code: string;
  name: string;
  isActive: boolean;
  deactivatedAt: string | null;
}

function toTeamDto(team: TeamRecord): TeamDto {
  return {
    id: team.id,
    sectorId: team.sectorId,
    sectorCode: team.sector.code,
    sectorName: team.sector.name,
    code: team.code,
    name: team.name,
    isActive: team.isActive,
    deactivatedAt: team.deactivatedAt?.toISOString() ?? null,
  };
}

function codeConflict(): HttpError {
  return new HttpError(409, 'CONFLICT', 'Já existe uma equipe com este código no setor.', [
    { field: 'code', message: 'Escolha outro código.' },
  ]);
}

/** E13 — equipes dos setores do escopo; filtro de setor fora do escopo → 403 (RN10, RF17). */
export async function listTeams(
  db: Queryable,
  auth: AuthContext,
  filters: ListTeamsQuery,
): Promise<TeamDto[]> {
  const teams = await listTeamRecords(db, auth.hospitalId, {
    sectorIds: resolveSectorFilter(
      auth.scope,
      filters.sectorId === undefined ? undefined : [filters.sectorId],
    ),
    isActive: filters.isActive,
  });
  return teams.map(toTeamDto);
}

/** E14 — cadastro de equipe (RF16): setor no escopo (403), ativo (422) e código único (409). */
export async function createTeam(
  db: Database,
  auth: AuthContext,
  audit: AuditContext,
  input: CreateTeamInput,
): Promise<TeamDto> {
  if (!isSectorInScope(auth.scope, input.sectorId)) throw sectorOutOfScope();
  try {
    return await db.transaction(async (tx) => {
      const sector = await findSectorState(tx, auth.hospitalId, input.sectorId);
      if (sector === null) throw resourceNotFound();
      if (!sector.isActive) throw sectorInactive();
      if ((await findTeamIdByCode(tx, input.sectorId, input.code)) !== null) throw codeConflict();

      const id = randomUUID();
      await insertTeam(tx, { id, sectorId: input.sectorId, code: input.code, name: input.name });
      const team = await findTeam(tx, id);
      if (team === null) throw resourceNotFound();
      await recordAudit(tx, audit, {
        action: 'TEAM_CREATED',
        entityType: 'team',
        entityId: team.id,
        sectorId: team.sectorId,
        details: { code: team.code },
      });
      return toTeamDto(team);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw codeConflict();
    throw error;
  }
}

/**
 * E15 — edição do nome, desativação e reativação (RF17, RF18). Equipe inativa não recebe turnos
 * nem novas atribuições; as atribuições anteriores são mantidas (RN11).
 */
export async function updateTeam(
  db: Database,
  clock: Clock,
  auth: AuthContext,
  audit: AuditContext,
  id: string,
  patch: UpdateTeamInput,
): Promise<TeamDto> {
  return db.transaction(async (tx) => {
    const current = await findTeam(tx, id);
    if (current?.sector.hospitalId !== auth.hospitalId) throw resourceNotFound();
    if (!isSectorInScope(auth.scope, current.sectorId)) throw resourceNotFound();

    const name = patch.name ?? current.name;
    const isActive = patch.isActive ?? current.isActive;
    const changedFields = [
      ...(name !== current.name ? ['name'] : []),
      ...(isActive !== current.isActive ? ['isActive'] : []),
    ];
    if (changedFields.length === 0) return toTeamDto(current);
    if (isActive && !current.isActive && !current.sector.isActive) throw sectorInactive();

    await updateTeamRow(tx, id, {
      name,
      isActive,
      deactivatedAt:
        isActive === current.isActive ? current.deactivatedAt : isActive ? null : clock.now(),
    });
    const updated = await findTeam(tx, id);
    if (updated === null) throw resourceNotFound();
    await recordAudit(tx, audit, {
      action:
        isActive === current.isActive
          ? 'TEAM_UPDATED'
          : isActive
            ? 'TEAM_REACTIVATED'
            : 'TEAM_DEACTIVATED',
      entityType: 'team',
      entityId: id,
      sectorId: current.sectorId,
      details: { changedFields },
    });
    return toTeamDto(updated);
  });
}

export type JourneyStageDto = JourneyStageRecord;

/** E16 — etapas da jornada do hospital, ordenadas (mantidas pelo seed, Seção 4.3). */
export async function listJourneyStages(
  db: Queryable,
  auth: AuthContext,
): Promise<JourneyStageDto[]> {
  return listJourneyStageRecords(db, auth.hospitalId);
}
