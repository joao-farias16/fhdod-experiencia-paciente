import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { PageMeta } from '../../lib/api-client';
import { toQueryString } from '../../lib/format';
import { useAuth } from '../auth/auth-context';
import type { SectorSummary, UserRole } from '../auth/auth-types';

/** Usuário administrativo devolvido por E06–E08. */
export interface AdminUser {
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

/** Setor do E10 (escopo do usuário autenticado). */
export interface AdminSector extends SectorSummary {
  description: string | null;
  activeTeams: number;
  activeSurveys: number;
}

export interface UsersFilters {
  search: string;
  role: UserRole | '';
  isActive: 'true' | 'false' | '';
  sectorId: string;
  page: number;
  pageSize: number;
}

export interface UserInput {
  fullName?: string;
  email?: string;
  role?: UserRole;
  allSectors?: boolean;
  sectorIds?: string[];
  isActive?: boolean;
}

export const usersKey = ['admin', 'users'] as const;

/** E06 — lista paginada com filtros. */
export function useUsers(filters: UsersFilters) {
  const { request } = useAuth();
  return useQuery({
    queryKey: [...usersKey, filters],
    queryFn: () => request<AdminUser[], PageMeta>(`/admin/users${toQueryString({ ...filters })}`),
    placeholderData: keepPreviousData,
  });
}

/** E10 — setores do escopo (para associar usuários e filtrar). */
export function useSectors() {
  const { request } = useAuth();
  return useQuery({
    queryKey: ['admin', 'sectors'],
    queryFn: async () => (await request<AdminSector[]>('/admin/sectors')).data,
  });
}

function useInvalidateUsers() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['admin'] });
}

/** E07 — cadastro; a resposta traz a senha temporária, exibida uma única vez. */
export function useCreateUser() {
  const { request } = useAuth();
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: async (input: UserInput) =>
      (
        await request<{ user: AdminUser; temporaryPassword: string }>('/admin/users', {
          method: 'POST',
          body: input,
        })
      ).data,
    onSuccess: invalidate,
  });
}

/** E08 — edição, desativação e reativação. */
export function useUpdateUser() {
  const { request } = useAuth();
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UserInput }) =>
      (await request<AdminUser>(`/admin/users/${id}`, { method: 'PATCH', body: input })).data,
    onSuccess: invalidate,
  });
}

/** E09 — redefinição assistida de senha. */
export function useResetPassword() {
  const { request } = useAuth();
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: async (id: string) =>
      (
        await request<{ temporaryPassword: string }>(`/admin/users/${id}/reset-password`, {
          method: 'POST',
        })
      ).data,
    onSuccess: invalidate,
  });
}
