import { randomUUID } from 'node:crypto';

import type { Database, Queryable } from '../../lib/database.js';
import type { UserRole } from '../../lib/domain-types.js';
import type { Clock } from '../../utils/dates.js';
import { HttpError, isUniqueViolation } from '../../utils/errors.js';
import { validationError } from '../../utils/validation.js';
import { type AuditContext, recordAudit } from '../audit/audit.service.js';
import { revokeProfileSessions, updatePasswordHash } from '../auth/auth.repository.js';
import type { AuthConfig, AuthContext } from '../auth/auth.types.js';
import { generateTemporaryPassword } from '../auth/password-policy.js';
import { hashPassword } from '../auth/passwords.js';
import { resourceNotFound } from '../auth/scope.js';
import { findSectorsByIds } from '../sectors/sectors.repository.js';
import {
  deleteProfileSectors,
  findProfileIdByEmail,
  findUserById,
  insertProfile,
  insertProfileSectors,
  listUserRecords,
  lockTargetAndSuperadmins,
  type SectorSummary,
  updateProfileRow,
  type UserRecord,
} from './users.repository.js';
import {
  type CreateUserInput,
  type ListUsersQuery,
  scopeViolations,
  type UpdateUserInput,
} from './users.schemas.js';

export type { SectorSummary };

export interface UsersServiceDeps {
  db: Database;
  authConfig: AuthConfig;
  clock: Clock;
}

function emailConflict(): HttpError {
  return new HttpError(409, 'CONFLICT', 'Já existe um usuário com este e-mail.');
}

function selfModification(): HttpError {
  return new HttpError(
    422,
    'SELF_MODIFICATION_FORBIDDEN',
    'Você não pode alterar o próprio perfil, escopo, situação ou senha por esta tela.',
  );
}

/**
 * Novos vínculos só com setores existentes e ativos do hospital (RF08). Vínculos já existentes
 * com setores desativados depois podem ser mantidos (histórico, RF15).
 */
async function assertAssignableSectors(
  tx: Queryable,
  hospitalId: string,
  sectorIds: readonly string[],
  alreadyLinked: readonly string[] = [],
): Promise<void> {
  const newIds = sectorIds.filter((id) => !alreadyLinked.includes(id));
  if (newIds.length === 0) return;
  const sectors = await findSectorsByIds(tx, newIds, hospitalId);
  if (sectors.length !== newIds.length) {
    throw new HttpError(422, 'INVALID_SCOPE', 'Um ou mais setores informados não existem.', [
      { field: 'sectorIds', message: 'Escolha setores existentes.' },
    ]);
  }
  if (sectors.some((sector) => !sector.isActive)) {
    throw new HttpError(422, 'SECTOR_INACTIVE', 'Associe somente setores ativos.', [
      { field: 'sectorIds', message: 'Há setor desativado na lista.' },
    ]);
  }
}

/** E06 — lista paginada com filtros (perfil, situação, setor e busca por nome ou e-mail). */
export async function listUsers(
  db: Queryable,
  actor: AuthContext,
  filters: ListUsersQuery,
): Promise<{ items: UserDto[]; total: number }> {
  const { items, total } = await listUserRecords(db, actor.hospitalId, {
    role: filters.role,
    isActive: filters.isActive,
    sectorId: filters.sectorId,
    search: filters.search,
    offset: (filters.page - 1) * filters.pageSize,
    limit: filters.pageSize,
  });
  return { items: items.map(toUserDto), total };
}

/**
 * E07 — cadastro (RF06): gera a senha temporária (exibida uma única vez), grava o hash bcrypt, o
 * perfil, os vínculos de setor e a auditoria numa única transação. O primeiro acesso exige a
 * troca da senha (must_change_password).
 */
export async function createUser(
  { db, authConfig }: UsersServiceDeps,
  actor: AuthContext,
  audit: AuditContext,
  input: CreateUserInput,
): Promise<{ user: UserDto; temporaryPassword: string }> {
  if ((await findProfileIdByEmail(db, input.email)) !== null) throw emailConflict();
  await assertAssignableSectors(db, actor.hospitalId, input.sectorIds);

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword, authConfig.bcryptRounds);
  try {
    const created = await db.transaction(async (tx) => {
      const id = randomUUID();
      await insertProfile(tx, {
        id,
        hospitalId: actor.hospitalId,
        fullName: input.fullName,
        email: input.email,
        passwordHash,
        role: input.role,
        allSectors: input.allSectors,
        mustChangePassword: true,
        createdById: actor.profileId,
      });
      await insertProfileSectors(tx, id, input.sectorIds, actor.profileId);
      await recordAudit(tx, audit, {
        action: 'USER_CREATED',
        entityType: 'profile',
        entityId: id,
        details: { role: input.role, allSectors: input.allSectors, sectorIds: input.sectorIds },
      });
      const record = await findUserById(tx, id);
      if (record === null) throw resourceNotFound();
      return record;
    });
    return { user: toUserDto(created), temporaryPassword };
  } catch (error) {
    if (isUniqueViolation(error, 'profiles_email_key')) throw emailConflict();
    throw error;
  }
}

/**
 * Bloqueia (FOR UPDATE) o usuário-alvo e os SA ativos do hospital e lê o alvo (RN24).
 */
async function lockTarget(
  tx: Queryable,
  targetId: string,
  hospitalId: string,
): Promise<{ target: UserRecord | null; activeSuperadmins: number }> {
  const locked = await lockTargetAndSuperadmins(tx, targetId, hospitalId);
  const activeSuperadmins = locked.filter(
    (row) => row.role === 'superadmin' && row.isActive,
  ).length;
  return { target: await findUserById(tx, targetId), activeSuperadmins };
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

/**
 * Estado final do usuário após o PATCH. Conveniências: passar a SA ou marcar escopo global sem
 * informar setores remove os vínculos; informar setores sem `allSectors` torna o escopo restrito.
 */
function mergeUpdate(current: UserRecord, patch: UpdateUserInput) {
  const role = patch.role ?? current.role;
  const currentSectorIds = current.sectors.map((sector) => sector.id);
  let allSectors = patch.allSectors;
  if (allSectors === undefined) {
    if (role === 'superadmin') allSectors = true;
    else if (patch.sectorIds !== undefined && patch.sectorIds.length > 0) allSectors = false;
    else if (role === 'sector_admin') allSectors = false;
    else allSectors = current.allSectors;
  }
  const sectorIds = patch.sectorIds ?? (allSectors ? [] : currentSectorIds);
  return {
    fullName: patch.fullName ?? current.fullName,
    role,
    allSectors,
    sectorIds,
    isActive: patch.isActive ?? current.isActive,
    currentSectorIds,
  };
}

/**
 * E08 — edição (RF07–RF09): nome, perfil, escopo e situação. O novo perfil vale na requisição
 * seguinte (o perfil é lido a cada requisição). A desativação bloqueia imediatamente o uso dos
 * tokens, a renovação e o login (403 ACCOUNT_DISABLED); a reativação libera de novo. Um único
 * registro de auditoria por operação.
 */
export async function updateUser(
  { db, clock }: UsersServiceDeps,
  actor: AuthContext,
  audit: AuditContext,
  targetId: string,
  patch: UpdateUserInput,
): Promise<UserDto> {
  return db.transaction(async (tx) => {
    const { target, activeSuperadmins } = await lockTarget(tx, targetId, actor.hospitalId);
    if (target === null || target.hospitalId !== actor.hospitalId) throw resourceNotFound();
    const current = target;
    const next = mergeUpdate(current, patch);

    const nameChanged = next.fullName !== current.fullName;
    const roleChanged = next.role !== current.role;
    const scopeChanged =
      next.allSectors !== current.allSectors || !sameSet(next.sectorIds, next.currentSectorIds);
    const activeChanged = next.isActive !== current.isActive;

    // RN24: sempre há ao menos um SA ativo; ninguém desativa a si nem altera o próprio perfil.
    const losesSuperadmin =
      current.role === 'superadmin' && current.isActive && (roleChanged || !next.isActive);
    if (losesSuperadmin && activeSuperadmins <= 1) {
      throw new HttpError(
        422,
        'LAST_SUPERADMIN',
        'O sistema precisa de ao menos um superadministrador ativo.',
      );
    }
    if (targetId === actor.profileId && (roleChanged || scopeChanged || activeChanged)) {
      throw selfModification();
    }
    if (!nameChanged && !roleChanged && !scopeChanged && !activeChanged) {
      return toUserDto(current);
    }

    const violations = scopeViolations(next.role, next.allSectors, next.sectorIds);
    if (violations.length > 0) {
      throw validationError(violations);
    }
    await assertAssignableSectors(tx, actor.hospitalId, next.sectorIds, next.currentSectorIds);

    const removed = next.currentSectorIds.filter((id) => !next.sectorIds.includes(id));
    const added = next.sectorIds.filter((id) => !next.currentSectorIds.includes(id));
    await deleteProfileSectors(tx, targetId, removed);
    await insertProfileSectors(tx, targetId, added, actor.profileId);
    await updateProfileRow(tx, targetId, {
      fullName: next.fullName,
      role: next.role,
      allSectors: next.allSectors,
      isActive: next.isActive,
      ...(activeChanged
        ? { deactivation: next.isActive ? null : { at: clock.now(), by: actor.profileId } }
        : {}),
    });

    const changedFields = [
      ...(nameChanged ? ['fullName'] : []),
      ...(roleChanged ? ['role'] : []),
      ...(scopeChanged ? ['scope'] : []),
      ...(activeChanged ? ['isActive'] : []),
    ];
    await recordAudit(tx, audit, {
      action: activeChanged
        ? next.isActive
          ? 'USER_REACTIVATED'
          : 'USER_DEACTIVATED'
        : 'USER_UPDATED',
      entityType: 'profile',
      entityId: targetId,
      details: {
        changedFields,
        ...(roleChanged ? { roleFrom: current.role, roleTo: next.role } : {}),
        ...(scopeChanged
          ? { allSectors: next.allSectors, sectorIdsAdded: added, sectorIdsRemoved: removed }
          : {}),
      },
    });

    const updated = await findUserById(tx, targetId);
    if (updated === null) throw resourceNotFound();
    return toUserDto(updated);
  });
}

/**
 * E09 — redefinição assistida (RF03): gera senha temporária de 16 caracteres (CSPRNG), grava o
 * hash, marca a troca obrigatória, encerra todas as sessões do usuário (a senha e os tokens
 * anteriores deixam de valer) e audita sem a senha.
 */
export async function resetUserPassword(
  { db, authConfig, clock }: UsersServiceDeps,
  actor: AuthContext,
  audit: AuditContext,
  targetId: string,
): Promise<{ temporaryPassword: string }> {
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword, authConfig.bcryptRounds);
  return db.transaction(async (tx) => {
    const { target } = await lockTarget(tx, targetId, actor.hospitalId);
    if (target === null || target.hospitalId !== actor.hospitalId) throw resourceNotFound();
    if (targetId === actor.profileId) throw selfModification();
    if (!target.isActive) {
      throw new HttpError(422, 'USER_INACTIVE', 'Reative o usuário antes de redefinir a senha.');
    }
    const now = clock.now();
    await updatePasswordHash(tx, targetId, { passwordHash, mustChangePassword: true, at: now });
    await revokeProfileSessions(tx, targetId, 'password_reset', now);
    await recordAudit(tx, audit, {
      action: 'USER_PASSWORD_RESET',
      entityType: 'profile',
      entityId: targetId,
      details: { changeRequired: true },
    });
    return { temporaryPassword };
  });
}

export interface UserDto {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  allSectors: boolean;
  sectors: SectorSummary[];
  isActive: boolean;
  mustChangePassword: boolean;
  deactivatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toUserDto(record: UserRecord): UserDto {
  return {
    id: record.id,
    fullName: record.fullName,
    email: record.email,
    role: record.role,
    allSectors: record.allSectors,
    sectors: record.sectors,
    isActive: record.isActive,
    mustChangePassword: record.mustChangePassword,
    deactivatedAt: record.deactivatedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
