/**
 * Serviços da autenticação: perfil carregado a cada requisição, E04 (perfil e permissões) e E05
 * (troca da própria senha).
 */
import { AUTH_TRANSACTION_OPTIONS, type PrismaClient } from '../../lib/prisma.js';
import { unauthenticated } from '../../utils/errors.js';
import { invalidField } from '../../utils/validation.js';
import { type AuditContext, recordAudit } from '../audit/audit.service.js';
import { findUserById, toUserDto, type UserDto } from '../users/users.service.js';
import { type AuthAdmin, type AuthContext, AuthWeakPasswordError } from './auth.types.js';
import { type Permission, permissionsFor } from './permissions.js';

export type AuthProfileReader = Pick<PrismaClient, 'profile'>;

/** Perfil carregado a cada requisição para validar a conta e montar o escopo (RF09, RN18). */
export async function findAuthProfile(
  prisma: AuthProfileReader,
  authUserId: string,
): Promise<(AuthContext & { isActive: boolean }) | null> {
  const profile = await prisma.profile.findUnique({
    where: { authUserId },
    select: {
      id: true,
      authUserId: true,
      hospitalId: true,
      role: true,
      allSectors: true,
      isActive: true,
      mustChangePassword: true,
      sectorLinks: { select: { sectorId: true }, orderBy: { sectorId: 'asc' } },
    },
  });
  if (profile === null) return null;
  return {
    profileId: profile.id,
    authUserId: profile.authUserId,
    hospitalId: profile.hospitalId,
    role: profile.role,
    // SA é sempre global (CHECK profiles_scope_by_role); AS nunca.
    scope: profile.allSectors
      ? { all: true }
      : { all: false, sectorIds: profile.sectorLinks.map((link) => link.sectorId) },
    mustChangePassword: profile.mustChangePassword,
    isActive: profile.isActive,
  };
}

export type MeDto = Pick<
  UserDto,
  'id' | 'fullName' | 'email' | 'role' | 'allSectors' | 'sectors' | 'mustChangePassword'
> & { permissions: Permission[] };

/** E04 — perfil, escopo e permissões do usuário autenticado (RF05). */
export async function getMe(prisma: PrismaClient, auth: AuthContext): Promise<MeDto> {
  const record = await findUserById(prisma, auth.profileId);
  if (record === null) throw unauthenticated();
  const user = toUserDto(record);
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    allSectors: user.allSectors,
    sectors: user.sectors,
    mustChangePassword: user.mustChangePassword,
    permissions: permissionsFor(auth.role),
  };
}

/**
 * Sessão emitida antes da última redefinição assistida não pode concluir a troca obrigatória:
 * só quem entrou com a senha temporária define a nova senha (RF03). O `iat` tem precisão de
 * segundos; o token é recusado quando certamente anterior à redefinição.
 */
async function assertSessionAfterLastReset(
  prisma: Pick<PrismaClient, 'auditLog'>,
  auth: AuthContext,
): Promise<void> {
  const lastReset = await prisma.auditLog.findFirst({
    where: { action: 'USER_PASSWORD_RESET', entityType: 'profile', entityId: auth.profileId },
    orderBy: { occurredAt: 'desc' },
    select: { occurredAt: true },
  });
  if (lastReset === null) return;
  const issuedAt = auth.tokenIssuedAt?.getTime();
  if (issuedAt === undefined || issuedAt + 1_000 <= lastReset.occurredAt.getTime()) {
    throw unauthenticated('Sua senha foi redefinida. Entre novamente com a senha temporária.');
  }
}

/**
 * E05 — troca da própria senha (RF04): obrigatória no primeiro acesso e após redefinição, ou
 * voluntária. Atualiza o Supabase Auth (último passo da transação) e must_change_password, com
 * auditoria sem a senha. A troca revoga os tokens de renovação do usuário no Supabase.
 */
export async function changeOwnPassword(
  { prisma, authAdmin }: { prisma: PrismaClient; authAdmin: AuthAdmin },
  auth: AuthContext,
  audit: AuditContext,
  newPassword: string,
): Promise<void> {
  if (auth.mustChangePassword) await assertSessionAfterLastReset(prisma, auth);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.profile.update({
        where: { id: auth.profileId },
        data: { mustChangePassword: false },
      });
      await recordAudit(tx, audit, {
        action: 'PASSWORD_CHANGED',
        entityType: 'profile',
        entityId: auth.profileId,
        details: { mandatory: auth.mustChangePassword },
      });
      await authAdmin.updatePassword(auth.authUserId, newPassword);
    }, AUTH_TRANSACTION_OPTIONS);
  } catch (error) {
    if (error instanceof AuthWeakPasswordError) {
      throw invalidField('newPassword', 'A senha não atende à política de senhas.');
    }
    throw error;
  }
}
