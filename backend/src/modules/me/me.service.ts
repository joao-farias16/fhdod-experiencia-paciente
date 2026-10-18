import type { PrismaClient } from '../../lib/prisma.js';
import { type AuditContext, recordAudit } from '../../services/audit.service.js';
import { HttpError } from '../../utils/http-error.js';
import { type AuthAdmin, type AuthContext, AuthWeakPasswordError } from '../auth/auth.types.js';
import { type Permission, permissionsFor } from '../auth/permissions.js';
import { findUserById, type UserDto, toUserDto } from '../users/users.repository.js';

export type MeDto = Pick<
  UserDto,
  'id' | 'fullName' | 'email' | 'role' | 'allSectors' | 'sectors' | 'mustChangePassword'
> & { permissions: Permission[] };

/** E04 — perfil, escopo e permissões do usuário autenticado (RF05). */
export async function getMe(prisma: PrismaClient, auth: AuthContext): Promise<MeDto> {
  const record = await findUserById(prisma, auth.profileId);
  if (record === null) {
    throw new HttpError(
      401,
      'UNAUTHENTICATED',
      'Sua sessão é inválida ou expirou. Entre novamente.',
    );
  }
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
    throw new HttpError(
      401,
      'UNAUTHENTICATED',
      'Sua senha foi redefinida. Entre novamente com a senha temporária.',
    );
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
    await prisma.$transaction(
      async (tx) => {
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
      },
      { timeout: 15_000, maxWait: 5_000 },
    );
  } catch (error) {
    if (error instanceof AuthWeakPasswordError) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Os dados enviados são inválidos.', [
        { field: 'newPassword', message: 'A senha não atende à política de senhas.' },
      ]);
    }
    throw error;
  }
}
