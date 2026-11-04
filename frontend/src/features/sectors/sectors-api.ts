import { useMutation, useQuery } from '@tanstack/react-query';

import { useInvalidateAdmin } from '../../app/query-client';
import { toQueryString } from '../../lib/api-client';
import { useAuth } from '../auth/auth-context';
import type { SectorSummary } from '../auth/auth-types';

/** Setor do E10 (escopo do usuário autenticado). */
export interface AdminSector extends SectorSummary {
  description: string | null;
  activeTeams: number;
  activeSurveys: number;
}

/** Equipe do E13–E15. */
export interface Team {
  id: string;
  sectorId: string;
  sectorCode: string;
  sectorName: string;
  code: string;
  name: string;
  isActive: boolean;
  deactivatedAt: string | null;
}

export interface JourneyStage {
  id: string;
  code: string;
  name: string;
  position: number;
  isActive: boolean;
}

/** E10 — setores do escopo (filtros e associação de usuários em várias telas). */
export function useSectors() {
  const { request } = useAuth();
  return useQuery({
    queryKey: ['admin', 'sectors'],
    queryFn: async () => (await request<AdminSector[]>('/admin/sectors')).data,
  });
}

/** E13 — equipes do escopo (opcionalmente de um setor). */
export function useTeams(sectorId?: string) {
  const { request } = useAuth();
  return useQuery({
    queryKey: ['admin', 'teams', sectorId ?? 'todos'],
    queryFn: async () => (await request<Team[]>(`/admin/teams${toQueryString({ sectorId })}`)).data,
  });
}

/** E16 — etapas da jornada, ordenadas. */
export function useJourneyStages() {
  const { request } = useAuth();
  return useQuery({
    queryKey: ['admin', 'journey-stages'],
    queryFn: async () => (await request<JourneyStage[]>('/admin/journey-stages')).data,
    staleTime: 5 * 60_000,
  });
}

export interface SectorInput {
  code?: string;
  name?: string;
  description?: string;
  isActive?: boolean;
}

/** E11 — cadastro de setor (SA). */
export function useCreateSector() {
  const { request } = useAuth();
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: async (input: SectorInput) =>
      (await request<AdminSector>('/admin/sectors', { method: 'POST', body: input })).data,
    onSuccess: invalidate,
  });
}

/** E12 — edição, desativação e reativação de setor (SA). */
export function useUpdateSector() {
  const { request } = useAuth();
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: SectorInput }) =>
      (await request<AdminSector>(`/admin/sectors/${id}`, { method: 'PATCH', body: input })).data,
    onSuccess: invalidate,
  });
}

export interface TeamInput {
  sectorId?: string;
  code?: string;
  name?: string;
  isActive?: boolean;
}

/** E14 — cadastro de equipe (SA e AS). */
export function useCreateTeam() {
  const { request } = useAuth();
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: async (input: TeamInput) =>
      (await request<Team>('/admin/teams', { method: 'POST', body: input })).data,
    onSuccess: invalidate,
  });
}

/** E15 — edição, desativação e reativação de equipe. */
export function useUpdateTeam() {
  const { request } = useAuth();
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: TeamInput }) =>
      (await request<Team>(`/admin/teams/${id}`, { method: 'PATCH', body: input })).data,
    onSuccess: invalidate,
  });
}
