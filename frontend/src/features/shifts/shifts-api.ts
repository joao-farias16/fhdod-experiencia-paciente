import { useMutation, useQuery } from '@tanstack/react-query';

import { useInvalidateAdmin } from '../../app/query-client';
import { toQueryString } from '../../lib/api-client';
import { useAuth } from '../auth/auth-context';

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
