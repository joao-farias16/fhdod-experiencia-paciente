import type { Prisma, PrismaClient, TransactionClient, UserRole } from '../../lib/prisma.js';
import type { ListUsersQuery } from './users.schemas.js';

/** Campos de um usuário administrativo devolvidos pela API (sem identificadores do Auth). */
export const userSelect = {
  id: true,
  fullName: true,
  email: true,
  role: true,
  allSectors: true,
  isActive: true,
  mustChangePassword: true,
  deactivatedAt: true,
  createdAt: true,
  updatedAt: true,
  sectorLinks: {
    select: { sector: { select: { id: true, code: true, name: true, isActive: true } } },
    orderBy: { sector: { name: 'asc' } },
  },
} as const satisfies Prisma.ProfileSelect;

export type UserRecord = Prisma.ProfileGetPayload<{ select: typeof userSelect }>;

export interface SectorSummary {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
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
    sectors: record.sectorLinks.map((link) => link.sector),
    isActive: record.isActive,
    mustChangePassword: record.mustChangePassword,
    deactivatedAt: record.deactivatedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

type Reader = Pick<PrismaClient, 'profile'> | Pick<TransactionClient, 'profile'>;

function listWhere(hospitalId: string, filters: ListUsersQuery): Prisma.ProfileWhereInput {
  return {
    hospitalId,
    ...(filters.role === undefined ? {} : { role: filters.role }),
    ...(filters.isActive === undefined ? {} : { isActive: filters.isActive }),
    ...(filters.sectorId === undefined
      ? {}
      : { sectorLinks: { some: { sectorId: filters.sectorId } } }),
    ...(filters.search === undefined
      ? {}
      : {
          OR: [
            { fullName: { contains: filters.search, mode: 'insensitive' } },
            { email: { contains: filters.search.toLowerCase() } },
          ],
        }),
  };
}

export async function listUsers(
  prisma: Reader,
  hospitalId: string,
  filters: ListUsersQuery,
): Promise<{ items: UserRecord[]; total: number }> {
  const where = listWhere(hospitalId, filters);
  const [items, total] = await Promise.all([
    prisma.profile.findMany({
      where,
      select: userSelect,
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    prisma.profile.count({ where }),
  ]);
  return { items, total };
}

export function findUserById(prisma: Reader, id: string): Promise<UserRecord | null> {
  return prisma.profile.findUnique({ where: { id }, select: userSelect });
}
