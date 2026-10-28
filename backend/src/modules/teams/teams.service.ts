import type { PrismaClient, TransactionClient } from '../../lib/prisma.js';
import { type AuditContext, recordAudit } from '../../services/audit.service.js';
import {
  isSectorInScope,
  resourceNotFound,
  sectorOutOfScope,
  sectorWhere,
} from '../../services/scope.js';
import type { Clock } from '../../utils/clock.js';
import { HttpError } from '../../utils/http-error.js';
import { isUniqueViolation } from '../../utils/prisma-errors.js';
import type { AuthContext } from '../auth/auth.types.js';
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

const teamSelect = {
  id: true,
  sectorId: true,
  code: true,
  name: true,
  isActive: true,
  deactivatedAt: true,
  sector: { select: { code: true, name: true, isActive: true, hospitalId: true } },
} as const;

type TeamRecord = NonNullable<Awaited<ReturnType<typeof findTeam>>>;

function findTeam(client: Pick<TransactionClient, 'team'>, id: string) {
  return client.team.findUnique({ where: { id }, select: teamSelect });
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

export function sectorInactive(): HttpError {
  return new HttpError(
    422,
    'SECTOR_INACTIVE',
    'O setor está desativado. Reative o setor antes de continuar.',
  );
}

function codeConflict(): HttpError {
  return new HttpError(409, 'CONFLICT', 'Já existe uma equipe com este código no setor.', [
    { field: 'code', message: 'Escolha outro código.' },
  ]);
}

/** E13 — equipes dos setores do escopo; filtro de setor fora do escopo → 403 (RN10, RF17). */
export async function listTeams(
  prisma: Pick<PrismaClient, 'team'>,
  auth: AuthContext,
  filters: ListTeamsQuery,
): Promise<TeamDto[]> {
  const teams = await prisma.team.findMany({
    where: {
      ...sectorWhere(auth.scope, filters.sectorId === undefined ? undefined : [filters.sectorId]),
      sector: { hospitalId: auth.hospitalId },
      ...(filters.isActive === undefined ? {} : { isActive: filters.isActive }),
    },
    orderBy: [{ sector: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
    select: teamSelect,
  });
  return teams.map(toTeamDto);
}

/** E14 — cadastro de equipe (RF16): setor no escopo (403), ativo (422) e código único (409). */
export async function createTeam(
  prisma: PrismaClient,
  auth: AuthContext,
  audit: AuditContext,
  input: CreateTeamInput,
): Promise<TeamDto> {
  if (!isSectorInScope(auth.scope, input.sectorId)) throw sectorOutOfScope();
  try {
    return await prisma.$transaction(async (tx) => {
      const sector = await tx.sector.findFirst({
        where: { id: input.sectorId, hospitalId: auth.hospitalId },
        select: { isActive: true },
      });
      if (sector === null) throw resourceNotFound();
      if (!sector.isActive) throw sectorInactive();
      const existing = await tx.team.findUnique({
        where: { sectorId_code: { sectorId: input.sectorId, code: input.code } },
        select: { id: true },
      });
      if (existing !== null) throw codeConflict();

      const team = await tx.team.create({
        data: { sectorId: input.sectorId, code: input.code, name: input.name },
        select: teamSelect,
      });
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
  prisma: PrismaClient,
  clock: Clock,
  auth: AuthContext,
  audit: AuditContext,
  id: string,
  patch: UpdateTeamInput,
): Promise<TeamDto> {
  return prisma.$transaction(async (tx) => {
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

    const updated = await tx.team.update({
      where: { id },
      data: {
        name,
        isActive,
        ...(isActive === current.isActive ? {} : { deactivatedAt: isActive ? null : clock.now() }),
      },
      select: teamSelect,
    });
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

export interface JourneyStageDto {
  id: string;
  code: string;
  name: string;
  position: number;
  isActive: boolean;
}

/** E16 — etapas da jornada do hospital, ordenadas (mantidas pelo seed, Seção 4.3). */
export async function listJourneyStages(
  prisma: Pick<PrismaClient, 'journeyStage'>,
  auth: AuthContext,
): Promise<JourneyStageDto[]> {
  return prisma.journeyStage.findMany({
    where: { hospitalId: auth.hospitalId },
    orderBy: [{ position: 'asc' }],
    select: { id: true, code: true, name: true, position: true, isActive: true },
  });
}
