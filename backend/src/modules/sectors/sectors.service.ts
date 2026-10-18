import type { PrismaClient } from '../../lib/prisma.js';
import type { AuthContext } from '../auth/auth.types.js';

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

/**
 * E10 — setores do escopo do usuário com as contagens de equipes e pesquisas ativas (RF13).
 * O escopo é aplicado na própria consulta: usuário restrito vê apenas os setores associados.
 * Antecipado da ET04 somente para leitura, pois TL16 associa usuários a setores (RF08).
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
    select: {
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
    },
  });
  return sectors.map((sector) => ({
    id: sector.id,
    code: sector.code,
    name: sector.name,
    description: sector.description,
    isActive: sector.isActive,
    deactivatedAt: sector.deactivatedAt?.toISOString() ?? null,
    activeTeams: sector._count.teams,
    activeSurveys: sector._count.surveyConfigs,
  }));
}
