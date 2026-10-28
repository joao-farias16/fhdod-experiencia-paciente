import type { PrismaClient } from '../../lib/prisma.js';
import type { AuthContext } from './auth.types.js';

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
