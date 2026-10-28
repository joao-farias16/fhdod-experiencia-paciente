import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { PageMeta } from '../../lib/api-client';
import { toQueryString } from '../../lib/format';
import { useAuth } from '../auth/auth-context';

export type ManifestationType = 'compliment' | 'complaint' | 'suggestion';
export type ManifestationStatus = 'received' | 'in_review' | 'forwarded' | 'resolved' | 'archived';
export type ManifestationPriority = 'low' | 'medium' | 'high';
export type ContactDeletionReason = 'holder_request' | 'return_completed' | 'other';

export const TYPE_LABELS: Record<ManifestationType, string> = {
  compliment: 'Elogio',
  complaint: 'Reclamação',
  suggestion: 'Sugestão',
};

export const STATUS_LABELS: Record<ManifestationStatus, string> = {
  received: 'Recebida',
  in_review: 'Em análise',
  forwarded: 'Encaminhada',
  resolved: 'Concluída',
  archived: 'Arquivada',
};

export const PRIORITY_LABELS: Record<ManifestationPriority, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
};

export const REASON_LABELS: Record<ContactDeletionReason, string> = {
  holder_request: 'Pedido do titular',
  return_completed: 'Retorno concluído',
  other: 'Outro motivo',
};

export interface ManifestationListItem {
  id: string;
  protocol: string;
  receivedAt: string;
  updatedAt: string;
  sector: { id: string; name: string };
  type: ManifestationType;
  status: ManifestationStatus;
  priority: ManifestationPriority;
  excerpt: string;
  isAnonymous: boolean;
  hasContact: boolean;
  triggeredByLowScore: boolean;
}

export interface TimelineEvent {
  id: string;
  kind:
    | 'created'
    | 'status_changed'
    | 'priority_changed'
    | 'actions_updated'
    | 'note'
    | 'contact_deleted';
  content: string | null;
  fromValue: string | null;
  toValue: string | null;
  createdAt: string;
  author: { id: string; fullName: string } | null;
}

export interface ManifestationDetail extends Omit<ManifestationListItem, 'excerpt'> {
  description: string;
  actionsTaken: string | null;
  resolvedAt: string | null;
  allowedTransitions: ManifestationStatus[];
  response: {
    id: string;
    submittedAt: string;
    origin: 'qr_code' | 'link';
    npsScore: number;
    lowScore: boolean;
    survey: { title: string; versionNumber: number };
    answers: { questionText: string; journeyStageName: string | null; score: number }[];
  };
  timeline: TimelineEvent[];
}

export interface Contact {
  fullName: string;
  phone: string | null;
  email: string | null;
  consentGivenAt: string;
  purposeTextVersion: string;
  purposeText: string;
}

export interface ManifestationFilters {
  from: string;
  to: string;
  status: ManifestationStatus | '';
  type: ManifestationType | '';
  priority: ManifestationPriority | '';
  sectorIds: string;
  protocol: string;
  hasContact: '' | 'true' | 'false';
  sort: 'received_desc' | 'received_asc' | 'priority_desc' | 'status_asc';
}

export type ManifestationsMeta = PageMeta & { from: string; to: string };

export interface ManifestationPatch {
  updatedAt: string;
  status?: ManifestationStatus;
  priority?: ManifestationPriority;
  actionsTaken?: string;
  note?: string;
}

const key = ['ouvidoria'] as const;

/** E35 — lista com filtros (RF44). */
export function useManifestations(filters: ManifestationFilters, page: number) {
  const { request } = useAuth();
  return useQuery({
    queryKey: [...key, 'list', filters, page],
    queryFn: () =>
      request<ManifestationListItem[], ManifestationsMeta>(
        `/ouvidoria/manifestations${toQueryString({
          ...filters,
          protocol: filters.protocol.trim(),
          page,
          pageSize: 25,
        })}`,
      ),
    placeholderData: keepPreviousData,
  });
}

/** E36 — detalhe auditado; não é guardado em cache entre telas (sempre consultado de novo). */
export function useManifestation(id: string) {
  const { request } = useAuth();
  return useQuery({
    queryKey: [...key, 'detail', id],
    queryFn: async () =>
      (await request<ManifestationDetail>(`/ouvidoria/manifestations/${id}`)).data,
    gcTime: 0,
  });
}

function useRefresh(id: string) {
  const queryClient = useQueryClient();
  return (detail?: ManifestationDetail) => {
    if (detail !== undefined) queryClient.setQueryData([...key, 'detail', id], detail);
    return queryClient.invalidateQueries({ queryKey: [...key, 'list'] });
  };
}

/** E37 — status, prioridade e providências com updatedAt (RF46). */
export function useUpdateManifestation(id: string) {
  const { request } = useAuth();
  const refresh = useRefresh(id);
  return useMutation({
    mutationFn: async (patch: ManifestationPatch) =>
      (
        await request<ManifestationDetail>(`/ouvidoria/manifestations/${id}`, {
          method: 'PATCH',
          body: patch,
        })
      ).data,
    onSuccess: (detail) => refresh(detail),
  });
}

/** E38 — nota interna (RF47). */
export function useAddNote(id: string) {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      request<TimelineEvent>(`/ouvidoria/manifestations/${id}/notes`, {
        method: 'POST',
        body: { content },
      }),
    onSuccess: ({ data }) => {
      queryClient.setQueryData<ManifestationDetail>([...key, 'detail', id], (current) =>
        current === undefined ? current : { ...current, timeline: [...current.timeline, data] },
      );
    },
  });
}

/** E39 — contato por ação explícita; o resultado fica só no estado da tela (sem cache). */
export function useContactActions(id: string) {
  const { request } = useAuth();
  const refresh = useRefresh(id);
  const queryClient = useQueryClient();
  // gcTime 0: o contato não permanece no cache de mutações depois que a tela é fechada.
  const view = useMutation({
    gcTime: 0,
    mutationFn: async () =>
      (await request<Contact>(`/ouvidoria/manifestations/${id}/contact`)).data,
  });
  const remove = useMutation({
    mutationFn: (reason: ContactDeletionReason) =>
      request(`/ouvidoria/manifestations/${id}/contact`, { method: 'DELETE', body: { reason } }),
    onSuccess: async () => {
      view.reset();
      await refresh();
      await queryClient.invalidateQueries({ queryKey: [...key, 'detail', id] });
    },
  });
  return { view, remove };
}
