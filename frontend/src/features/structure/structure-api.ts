import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { toQueryString } from '../../lib/format';
import { useAuth } from '../auth/auth-context';
import type { AdminSector } from '../users/users-api';

export type { AdminSector };

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

export type ShiftPeriod = 'morning' | 'afternoon' | 'night';

export const PERIOD_LABELS: Record<ShiftPeriod, string> = {
  morning: 'Manhã',
  afternoon: 'Tarde',
  night: 'Noite',
};

/** Turno do E17–E19, com data e horas locais do hospital. */
export interface Shift {
  id: string;
  sectorId: string;
  team: { id: string; code: string; name: string; isActive: boolean };
  period: ShiftPeriod;
  source: 'manual' | 'import';
  date: string;
  startTime: string;
  endTime: string;
  endsNextDay: boolean;
  startsAt: string;
  endsAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
}

export interface RosterError {
  line: number;
  column: string;
  code: string;
  message: string;
}

/** Importação de escala (E20, E21). */
export interface RosterImport {
  id: string;
  status: 'validated' | 'rejected' | 'committed';
  fileName: string;
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  errors: RosterError[];
  summary: {
    sectorCode: string;
    sectorName: string;
    teamCode: string;
    teamName: string;
    shifts: number;
  }[];
  expiresAt: string;
  committedAt: string | null;
}

function useInvalidateAdmin() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['admin'] });
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

export interface ShiftsFilters {
  sectorId: string;
  from: string;
  to: string;
  teamId: string;
  includeCancelled: boolean;
}

/** E17 — escala do setor no intervalo (até 62 dias). */
export function useShifts(filters: ShiftsFilters) {
  const { request } = useAuth();
  return useQuery({
    queryKey: ['admin', 'shifts', filters],
    enabled: filters.sectorId !== '',
    queryFn: async () =>
      (
        await request<Shift[]>(
          `/admin/shifts${toQueryString({
            sectorId: filters.sectorId,
            from: filters.from,
            to: filters.to,
            teamId: filters.teamId,
            includeCancelled: filters.includeCancelled ? 'true' : undefined,
          })}`,
        )
      ).data,
  });
}

export interface ShiftInput {
  teamId: string;
  date: string;
  period: ShiftPeriod;
  startTime: string;
  endTime: string;
}

/** E18 — cadastro manual de turno. */
export function useCreateShift() {
  const { request } = useAuth();
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: async (input: ShiftInput) =>
      (await request<Shift>('/admin/shifts', { method: 'POST', body: input })).data,
    onSuccess: invalidate,
  });
}

/** E19 — cancelamento irreversível com motivo. */
export function useCancelShift() {
  const { request } = useAuth();
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      (
        await request<Shift>(`/admin/shifts/${id}`, {
          method: 'PATCH',
          body: { cancelled: true, reason },
        })
      ).data,
    onSuccess: invalidate,
  });
}

/** E20 — pré-validação do CSV (multipart, campo "file"). */
export function useValidateRoster() {
  const { request } = useAuth();
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return (await request<RosterImport>('/admin/rosters/import', { method: 'POST', body: form }))
        .data;
    },
  });
}

/** E21 — confirmação da importação validada. */
export function useConfirmRoster() {
  const { request } = useAuth();
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: async (id: string) =>
      (await request<RosterImport>(`/admin/rosters/imports/${id}/confirm`, { method: 'POST' }))
        .data,
    onSuccess: invalidate,
  });
}
