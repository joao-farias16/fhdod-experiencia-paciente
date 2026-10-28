import type { Logger } from 'pino';

import {
  Prisma,
  type PrismaClient,
  type TransactionClient,
  type UserRole,
} from '../../lib/prisma.js';
import { type AuditContext, recordAudit } from '../../services/audit.service.js';
import { resourceNotFound } from '../../services/scope.js';
import type { Clock } from '../../utils/clock.js';
import { HttpError } from '../../utils/http-error.js';
import { VALIDATION_MESSAGE } from '../../utils/validation.js';
import {
  type AuthAdmin,
  type AuthContext,
  AuthEmailAlreadyRegisteredError,
} from '../auth/auth.types.js';
import { generateTemporaryPassword } from '../auth/password-policy.js';
import {
  findUserById,
  listUsers as listUserRecords,
  toUserDto,
  type UserDto,
  type UserRecord,
  userSelect,
} from './users.repository.js';
import {
  type CreateUserInput,
  type ListUsersQuery,
  scopeViolations,
  type UpdateUserInput,
} from './users.schemas.js';

export interface UsersServiceDeps {
  prisma: PrismaClient;
  authAdmin: AuthAdmin;
  logger: Logger;
  clock: Clock;
}

/** Transações que incluem uma chamada ao Supabase Auth podem demorar mais que o padrão (5 s). */
const TRANSACTION_OPTIONS = { timeout: 15_000, maxWait: 5_000 } as const;

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

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Novos vínculos só com setores existentes e ativos do hospital (RF08). Vínculos já existentes
 * com setores desativados depois podem ser mantidos (histórico, RF15).
 */
async function assertAssignableSectors(
  tx: Pick<TransactionClient, 'sector'>,
  hospitalId: string,
  sectorIds: readonly string[],
  alreadyLinked: readonly string[] = [],
): Promise<void> {
  const newIds = sectorIds.filter((id) => !alreadyLinked.includes(id));
  if (newIds.length === 0) return;
  const sectors = await tx.sector.findMany({
    where: { id: { in: newIds }, hospitalId },
    select: { id: true, isActive: true },
  });
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

/** Executa a compensação no Supabase Auth; uma falha é registrada sem dados pessoais. */
async function compensate(logger: Logger, operation: string, action: () => Promise<void>) {
  try {
    await action();
  } catch (error) {
    logger.error({ err: error, operation }, 'Falha na compensação no Supabase Auth');
  }
}

/** E06 — lista paginada com filtros (perfil, situação, setor e busca por nome ou e-mail). */
export async function listUsers(
  prisma: PrismaClient,
  actor: AuthContext,
  filters: ListUsersQuery,
): Promise<{ items: UserDto[]; total: number }> {
  const { items, total } = await listUserRecords(prisma, actor.hospitalId, filters);
  return { items: items.map(toUserDto), total };
}

/**
 * E07 — cadastro (RF06): cria a conta no Supabase Auth com senha temporária e, em seguida, o
 * perfil, os vínculos de setor e a auditoria numa transação. Se a transação falhar, a conta do
 * Auth é excluída (compensação), sem deixar conta órfã.
 */
export async function createUser(
  { prisma, authAdmin, logger }: UsersServiceDeps,
  actor: AuthContext,
  audit: AuditContext,
  input: CreateUserInput,
): Promise<{ user: UserDto; temporaryPassword: string }> {
  const existing = await prisma.profile.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing !== null) throw emailConflict();
  await assertAssignableSectors(prisma, actor.hospitalId, input.sectorIds);

  const temporaryPassword = generateTemporaryPassword();
  let authUserId: string;
  try {
    ({ authUserId } = await authAdmin.createUser({
      email: input.email,
      password: temporaryPassword,
    }));
  } catch (error) {
    if (error instanceof AuthEmailAlreadyRegisteredError) throw emailConflict();
    throw error;
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const profile = await tx.profile.create({
        data: {
          hospitalId: actor.hospitalId,
          authUserId,
          fullName: input.fullName,
          email: input.email,
          role: input.role,
          allSectors: input.allSectors,
          mustChangePassword: true,
          createdById: actor.profileId,
          sectorLinks: {
            create: input.sectorIds.map((sectorId) => ({ sectorId, createdById: actor.profileId })),
          },
        },
        select: userSelect,
      });
      await recordAudit(tx, audit, {
        action: 'USER_CREATED',
        entityType: 'profile',
        entityId: profile.id,
        details: { role: input.role, allSectors: input.allSectors, sectorIds: input.sectorIds },
      });
      return profile;
    }, TRANSACTION_OPTIONS);
    return { user: toUserDto(created), temporaryPassword };
  } catch (error) {
    await compensate(logger, 'deleteUser', () => authAdmin.deleteUser(authUserId));
    if (isUniqueViolation(error)) throw emailConflict();
    throw error;
  }
}

interface LockedTarget {
  record: UserRecord;
  authUserId: string;
  hospitalId: string;
}

/**
 * Bloqueia (FOR UPDATE) o usuário-alvo e os SA ativos numa única instrução, em ordem de id,
 * evitando deadlocks e garantindo a contagem de SA ativos sob concorrência (RN24).
 */
async function lockTarget(
  tx: TransactionClient,
  targetId: string,
  hospitalId: string,
): Promise<{ target: LockedTarget | null; activeSuperadmins: number }> {
  const locked = await tx.$queryRaw<{ id: string; role: UserRole; is_active: boolean }[]>`
    SELECT id, role, is_active FROM profiles
    WHERE id = ${targetId}::uuid
       OR (role = 'superadmin' AND is_active AND hospital_id = ${hospitalId}::uuid)
    ORDER BY id
    FOR UPDATE`;
  const activeSuperadmins = locked.filter(
    (row) => row.role === 'superadmin' && row.is_active,
  ).length;
  const record = await findUserById(tx, targetId);
  if (record === null) return { target: null, activeSuperadmins };
  const ids = await tx.profile.findUniqueOrThrow({
    where: { id: targetId },
    select: { authUserId: true, hospitalId: true },
  });
  return { target: { record, ...ids }, activeSuperadmins };
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
  const currentSectorIds = current.sectorLinks.map((link) => link.sector.id);
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
 * seguinte (o perfil é lido a cada requisição). Desativação e reativação também bloqueiam ou
 * liberam a conta no Supabase Auth; a chamada é o último passo da transação, que é desfeita se
 * ela falhar. Um único registro de auditoria por operação.
 */
export async function updateUser(
  { prisma, authAdmin, logger, clock }: UsersServiceDeps,
  actor: AuthContext,
  audit: AuditContext,
  targetId: string,
  patch: UpdateUserInput,
): Promise<UserDto> {
  let banChangedTo: boolean | undefined;
  let authUserIdForCompensation: string | undefined;
  try {
    return await prisma.$transaction(async (tx) => {
      const { target, activeSuperadmins } = await lockTarget(tx, targetId, actor.hospitalId);
      if (target === null || target.hospitalId !== actor.hospitalId) throw resourceNotFound();
      const current = target.record;
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
        throw new HttpError(400, 'VALIDATION_ERROR', VALIDATION_MESSAGE, violations);
      }
      await assertAssignableSectors(tx, actor.hospitalId, next.sectorIds, next.currentSectorIds);

      const removed = next.currentSectorIds.filter((id) => !next.sectorIds.includes(id));
      const added = next.sectorIds.filter((id) => !next.currentSectorIds.includes(id));
      if (removed.length > 0) {
        await tx.profileSector.deleteMany({
          where: { profileId: targetId, sectorId: { in: removed } },
        });
      }
      if (added.length > 0) {
        await tx.profileSector.createMany({
          data: added.map((sectorId) => ({
            profileId: targetId,
            sectorId,
            createdById: actor.profileId,
          })),
        });
      }
      const updated = await tx.profile.update({
        where: { id: targetId },
        data: {
          fullName: next.fullName,
          role: next.role,
          allSectors: next.allSectors,
          isActive: next.isActive,
          ...(activeChanged
            ? next.isActive
              ? { deactivatedAt: null, deactivatedById: null }
              : { deactivatedAt: clock.now(), deactivatedById: actor.profileId }
            : {}),
        },
        select: userSelect,
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

      if (activeChanged) {
        authUserIdForCompensation = target.authUserId;
        await authAdmin.setBanned(target.authUserId, !next.isActive);
        banChangedTo = !next.isActive;
      }
      return toUserDto(updated);
    }, TRANSACTION_OPTIONS);
  } catch (error) {
    // Falha depois do bloqueio/liberação no Auth (por exemplo, no COMMIT): desfaz no Auth.
    if (banChangedTo !== undefined && authUserIdForCompensation !== undefined) {
      const authUserId = authUserIdForCompensation;
      const revertTo = !banChangedTo;
      await compensate(logger, 'setBanned', () => authAdmin.setBanned(authUserId, revertTo));
    }
    throw error;
  }
}

/**
 * E09 — redefinição assistida (RF03): gera senha temporária de 16 caracteres (CSPRNG), marca a
 * troca obrigatória e audita sem a senha. A troca no Supabase Auth é o último passo da transação;
 * ela revoga os tokens de renovação e a senha anterior deixa de autenticar.
 */
export async function resetUserPassword(
  { prisma, authAdmin }: UsersServiceDeps,
  actor: AuthContext,
  audit: AuditContext,
  targetId: string,
): Promise<{ temporaryPassword: string }> {
  return prisma.$transaction(async (tx) => {
    const { target } = await lockTarget(tx, targetId, actor.hospitalId);
    if (target === null || target.hospitalId !== actor.hospitalId) throw resourceNotFound();
    if (targetId === actor.profileId) throw selfModification();
    if (!target.record.isActive) {
      throw new HttpError(422, 'USER_INACTIVE', 'Reative o usuário antes de redefinir a senha.');
    }
    await tx.profile.update({ where: { id: targetId }, data: { mustChangePassword: true } });
    await recordAudit(tx, audit, {
      action: 'USER_PASSWORD_RESET',
      entityType: 'profile',
      entityId: targetId,
      details: { changeRequired: true },
    });
    const temporaryPassword = generateTemporaryPassword();
    await authAdmin.updatePassword(target.authUserId, temporaryPassword);
    return { temporaryPassword };
  }, TRANSACTION_OPTIONS);
}
