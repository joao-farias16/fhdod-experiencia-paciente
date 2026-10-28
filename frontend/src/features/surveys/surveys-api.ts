import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { PageMeta } from '../../lib/api-client';
import { toQueryString } from '../../lib/format';
import { useAuth } from '../auth/auth-context';

export type SurveyStatus = 'draft' | 'active' | 'inactive';

export const STATUS_LABELS: Record<SurveyStatus, string> = {
  draft: 'Rascunho',
  active: 'Publicada',
  inactive: 'Desativada',
};

/** RN27: limite de perguntas específicas ativas. */
export const MAX_ACTIVE_QUESTIONS = 10;

export interface SurveySummary {
  id: string;
  sectorId: string;
  sectorCode: string;
  sectorName: string;
  sectorIsActive: boolean;
  title: string;
  slug: string;
  status: SurveyStatus;
  isActive: boolean;
  hasUnpublishedChanges: boolean;
  activeSpecificQuestions: number;
  currentVersion: { id: string; versionNumber: number; publishedAt: string } | null;
  updatedAt: string;
}

export interface SurveyQuestion {
  id: string;
  type: 'nps' | 'scale_1_5';
  text: string;
  journeyStage: { id: string; code: string; name: string; position: number } | null;
  position: number;
  isRequired: boolean;
  isActive: boolean;
  locked: boolean;
}

export interface SurveyVersion {
  id: string;
  versionNumber: number;
  title: string;
  introText: string | null;
  thankYouMessage: string;
  publishedAt: string;
  publishedBy: { id: string; fullName: string };
  supersededAt: string | null;
  isCurrent: boolean;
  questions: {
    id: string;
    questionId: string;
    type: 'nps' | 'scale_1_5';
    text: string;
    journeyStageName: string | null;
    position: number;
  }[];
}

export interface SurveyDetail extends SurveySummary {
  introText: string | null;
  thankYouMessage: string;
  deactivatedAt: string | null;
  createdAt: string;
  questions: SurveyQuestion[];
  versions: SurveyVersion[];
  links: { qrUrl: string; linkUrl: string } | null;
}

export interface SurveysFilters {
  sectorId: string;
  status: SurveyStatus | '';
  search: string;
  page: number;
  pageSize: number;
}

export interface QuestionChange {
  id?: string;
  text?: string;
  journeyStageId?: string;
  position?: number;
  isActive?: boolean;
}

export interface SurveyPatch {
  title?: string;
  introText?: string;
  thankYouMessage?: string;
  slug?: string;
  sectorId?: string;
  npsQuestionText?: string;
  isActive?: boolean;
  questions?: QuestionChange[];
}

export interface SurveyCreate {
  sectorId: string;
  title: string;
  slug: string;
  introText?: string;
  thankYouMessage?: string;
}

const surveysKey = ['admin', 'surveys'] as const;

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['admin'] });
}

/** E22 — lista com situação. */
export function useSurveys(filters: SurveysFilters) {
  const { request } = useAuth();
  return useQuery({
    queryKey: [...surveysKey, filters],
    queryFn: () =>
      request<SurveySummary[], PageMeta>(`/admin/surveys${toQueryString({ ...filters })}`),
    placeholderData: keepPreviousData,
  });
}

/** E23 — configuração, perguntas e histórico de versões. */
export function useSurvey(id: string) {
  const { request } = useAuth();
  return useQuery({
    queryKey: [...surveysKey, 'detalhe', id],
    queryFn: async () => (await request<SurveyDetail>(`/admin/surveys/${id}`)).data,
  });
}

/** E24 — rascunho com a pergunta geral. */
export function useCreateSurvey() {
  const { request } = useAuth();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: SurveyCreate) =>
      (await request<SurveyDetail>('/admin/surveys', { method: 'POST', body: input })).data,
    onSuccess: invalidate,
  });
}

/** E25 — textos, perguntas e situação. */
export function useUpdateSurvey(id: string) {
  const { request } = useAuth();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (patch: SurveyPatch) =>
      (await request<SurveyDetail>(`/admin/surveys/${id}`, { method: 'PATCH', body: patch })).data,
    onSuccess: invalidate,
  });
}

/** E26 — publicação de nova versão. */
export function usePublishSurvey(id: string) {
  const { request } = useAuth();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async () =>
      (await request<SurveyVersion>(`/admin/surveys/${id}/publish`, { method: 'POST' })).data,
    onSuccess: invalidate,
  });
}

/** E27 — link e QR Code da versão vigente. */
export function useSurveyLinks(id: string, enabled = true) {
  const { request } = useAuth();
  return useQuery({
    queryKey: [...surveysKey, 'qr', id],
    enabled,
    queryFn: async () =>
      (
        await request<{
          qrUrl: string;
          linkUrl: string;
          slug: string;
          title: string;
          sectorName: string;
        }>(`/admin/surveys/${id}/qr`)
      ).data,
  });
}
