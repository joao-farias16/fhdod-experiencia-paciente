import { randomUUID } from 'node:crypto';

import type { Database, Queryable } from '../../lib/database.js';
import type { Clock } from '../../utils/dates.js';
import { HttpError, isUniqueViolation } from '../../utils/errors.js';
import { type AuditContext, recordAudit } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { resourceNotFound } from '../auth/scope.js';
import {
  findSector,
  findSectorIdByCode,
  findSectorIdByName,
  insertSector,
  listSectorRecords,
  type SectorRecord,
  updateSectorRow,
} from './sectors.repository.js';
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

function toSectorDto(sector: SectorRecord): SectorDto {
  return {
    id: sector.id,
    code: sector.code,
    name: sector.name,
    description: sector.description,
    isActive: sector.isActive,
    deactivatedAt: sector.deactivatedAt?.toISOString() ?? null,
    activeTeams: sector.activeTeams,
    activeSurveys: sector.activeSurveys,
  };
}

/** Operação que exige setor ativo (equipes, turnos e pesquisas). */
export function sectorInactive(): HttpError {
  return new HttpError(
    422,
    'SECTOR_INACTIVE',
    'O setor está desativado. Reative o setor antes de continuar.',
  );
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
  tx: Queryable,
  hospitalId: string,
  name: string,
  exceptId?: string,
): Promise<void> {
  if ((await findSectorIdByName(tx, hospitalId, name, exceptId)) !== null) throw nameConflict();
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
  db: Queryable,
  auth: AuthContext,
  filters: ListSectorsFilters,
): Promise<SectorDto[]> {
  const sectors = await listSectorRecords(db, auth.hospitalId, {
    sectorIds: auth.scope.all ? undefined : auth.scope.sectorIds,
    isActive: filters.isActive,
    search: filters.search,
  });
  return sectors.map(toSectorDto);
}

/** E11 — cadastro de setor (RF12): código e nome únicos no hospital; auditoria na transação. */
export async function createSector(
  db: Database,
  auth: AuthContext,
  audit: AuditContext,
  input: CreateSectorInput,
): Promise<SectorDto> {
  try {
    return await db.transaction(async (tx) => {
      if ((await findSectorIdByCode(tx, auth.hospitalId, input.code)) !== null) {
        throw codeConflict();
      }
      await assertNameAvailable(tx, auth.hospitalId, input.name);

      const id = randomUUID();
      await insertSector(tx, {
        id,
        hospitalId: auth.hospitalId,
        code: input.code,
        name: input.name,
        description: input.description ?? null,
      });
      const created = await findSector(tx, auth.hospitalId, id);
      if (created === null) throw resourceNotFound();
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
  db: Database,
  clock: Clock,
  auth: AuthContext,
  audit: AuditContext,
  id: string,
  patch: UpdateSectorInput,
): Promise<SectorDto> {
  try {
    return await db.transaction(async (tx) => {
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

      await updateSectorRow(tx, id, {
        name,
        description,
        isActive,
        deactivatedAt:
          isActive === current.isActive ? current.deactivatedAt : isActive ? null : clock.now(),
      });
      const updated = await findSector(tx, auth.hospitalId, id);
      if (updated === null) throw resourceNotFound();
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
