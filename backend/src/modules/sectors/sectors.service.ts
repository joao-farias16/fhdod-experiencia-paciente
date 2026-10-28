import type { PrismaClient, TransactionClient } from '../../lib/prisma.js';
import { type AuditContext, recordAudit } from '../../services/audit.service.js';
import { resourceNotFound } from '../../services/scope.js';
import type { Clock } from '../../utils/clock.js';
import { HttpError } from '../../utils/http-error.js';
import { isUniqueViolation } from '../../utils/prisma-errors.js';
import type { AuthContext } from '../auth/auth.types.js';
import type { CreateSectorInput, UpdateSectorInput } from './sectors.schemas.js';

export interface SectorDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  deactivatedAt: string | null;
  activeTeams: number;
  activeSurveys: number;
}

export interface ListSectorsFilters {
  isActive?: boolean | undefined;
  search?: string | undefined;
}

const sectorSelect = {
  id: true,
  code: true,
  name: true,
  description: true,
  isActive: true,
  deactivatedAt: true,
  _count: {
    select: {
      teams: { where: { isActive: true } },
      surveyConfigs: { where: { isActive: true } },
    },
  },
} as const;

function findSector(client: Pick<TransactionClient, 'sector'>, hospitalId: string, id: string) {
  return client.sector.findFirst({ where: { id, hospitalId }, select: sectorSelect });
}

type SectorRecord = NonNullable<Awaited<ReturnType<typeof findSector>>>;

function toSectorDto(sector: SectorRecord): SectorDto {
  return {
    id: sector.id,
    code: sector.code,
    name: sector.name,
    description: sector.description,
    isActive: sector.isActive,
    deactivatedAt: sector.deactivatedAt?.toISOString() ?? null,
    activeTeams: sector._count.teams,
    activeSurveys: sector._count.surveyConfigs,
  };
}

function codeConflict(): HttpError {
  return new HttpError(409, 'CONFLICT', 'Já existe um setor com este código.', [
    { field: 'code', message: 'Escolha outro código.' },
  ]);
}

function nameConflict(): HttpError {
  return new HttpError(409, 'CONFLICT', 'Já existe um setor com este nome.', [
    { field: 'name', message: 'Escolha outro nome.' },
  ]);
}

/** Nome único no hospital sem distinguir maiúsculas (índice sectors_hospital_id_lower_name_key). */
async function assertNameAvailable(
  tx: Pick<TransactionClient, 'sector'>,
  hospitalId: string,
  name: string,
  exceptId?: string,
): Promise<void> {
  const existing = await tx.sector.findFirst({
    where: {
      hospitalId,
      name: { equals: name, mode: 'insensitive' },
      ...(exceptId === undefined ? {} : { id: { not: exceptId } }),
    },
    select: { id: true },
  });
  if (existing !== null) throw nameConflict();
}

/** Corrida entre duas requisições: a restrição do banco decide qual conflito informar. */
function translateUniqueViolation(error: unknown): never {
  if (isUniqueViolation(error, 'sectors_hospital_id_code_key')) throw codeConflict();
  if (isUniqueViolation(error, 'lower_name')) throw nameConflict();
  if (isUniqueViolation(error)) throw codeConflict();
  throw error;
}

/**
 * E10 — setores do escopo do usuário com as contagens de equipes e pesquisas ativas (RF13).
 * O escopo é aplicado na própria consulta: usuário restrito vê apenas os setores associados.
 */
export async function listSectors(
  prisma: Pick<PrismaClient, 'sector'>,
  auth: AuthContext,
  filters: ListSectorsFilters,
): Promise<SectorDto[]> {
  const sectors = await prisma.sector.findMany({
    where: {
      hospitalId: auth.hospitalId,
      ...(auth.scope.all ? {} : { id: { in: [...auth.scope.sectorIds] } }),
      ...(filters.isActive === undefined ? {} : { isActive: filters.isActive }),
      ...(filters.search === undefined
        ? {}
        : {
            OR: [
              { name: { contains: filters.search, mode: 'insensitive' } },
              { code: { contains: filters.search, mode: 'insensitive' } },
            ],
          }),
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: sectorSelect,
  });
  return sectors.map(toSectorDto);
}

/** E11 — cadastro de setor (RF12): código e nome únicos no hospital; auditoria na transação. */
export async function createSector(
  prisma: PrismaClient,
  auth: AuthContext,
  audit: AuditContext,
  input: CreateSectorInput,
): Promise<SectorDto> {
  try {
    return await prisma.$transaction(async (tx) => {
      const byCode = await tx.sector.findFirst({
        where: { hospitalId: auth.hospitalId, code: input.code },
        select: { id: true },
      });
      if (byCode !== null) throw codeConflict();
      await assertNameAvailable(tx, auth.hospitalId, input.name);

      const created = await tx.sector.create({
        data: {
          hospitalId: auth.hospitalId,
          code: input.code,
          name: input.name,
          description: input.description ?? null,
        },
        select: sectorSelect,
      });
      await recordAudit(tx, audit, {
        action: 'SECTOR_CREATED',
        entityType: 'sector',
        entityId: created.id,
        sectorId: created.id,
        details: { code: created.code },
      });
      return toSectorDto(created);
    });
  } catch (error) {
    return translateUniqueViolation(error);
  }
}

/**
 * E12 — edição de nome e descrição, desativação e reativação (RF14, RF15). A desativação é lógica
 * (RN11): bloqueia novas respostas, turnos e importações do setor, mantendo o histórico.
 */
export async function updateSector(
  prisma: PrismaClient,
  clock: Clock,
  auth: AuthContext,
  audit: AuditContext,
  id: string,
  patch: UpdateSectorInput,
): Promise<SectorDto> {
  try {
    return await prisma.$transaction(async (tx) => {
      const current = await findSector(tx, auth.hospitalId, id);
      if (current === null) throw resourceNotFound();

      const name = patch.name ?? current.name;
      const description = patch.description === undefined ? current.description : patch.description;
      const isActive = patch.isActive ?? current.isActive;
      const changedFields = [
        ...(name !== current.name ? ['name'] : []),
        ...(description !== current.description ? ['description'] : []),
        ...(isActive !== current.isActive ? ['isActive'] : []),
      ];
      if (changedFields.length === 0) return toSectorDto(current);
      if (name !== current.name) await assertNameAvailable(tx, auth.hospitalId, name, id);

      const updated = await tx.sector.update({
        where: { id },
        data: {
          name,
          description,
          isActive,
          ...(isActive === current.isActive
            ? {}
            : { deactivatedAt: isActive ? null : clock.now() }),
        },
        select: sectorSelect,
      });
      await recordAudit(tx, audit, {
        action:
          isActive === current.isActive
            ? 'SECTOR_UPDATED'
            : isActive
              ? 'SECTOR_REACTIVATED'
              : 'SECTOR_DEACTIVATED',
        entityType: 'sector',
        entityId: id,
        sectorId: id,
        details: { changedFields },
      });
      return toSectorDto(updated);
    });
  } catch (error) {
    return translateUniqueViolation(error);
  }
}
