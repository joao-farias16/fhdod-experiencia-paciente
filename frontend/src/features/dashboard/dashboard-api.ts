import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

import { addDays, daysInclusive, localDateOf, toQueryString } from '../../lib/format';
import { useAuth } from '../auth/auth-context';

/** RF61: atualização a cada 60 s com a aba visível (TanStack Query pausa em segundo plano). */
export const REFRESH_INTERVAL_MS = 60_000;
/** RN25: até 366 dias; padrão, últimos 30 dias. */
export const MAX_RANGE_DAYS = 366;

export type ShiftPeriod = 'morning' | 'afternoon' | 'night';
export type Origin = 'qr_code' | 'link';

export const PERIOD_LABELS: Record<ShiftPeriod, string> = {
  morning: 'Manhã',
  afternoon: 'Tarde',
  night: 'Noite',
};
export const ORIGIN_LABELS: Record<Origin, string> = { qr_code: 'QR Code', link: 'Link' };

/** Filtros comuns do dashboard e dos relatórios (Seção 4.3), espelhados na URL (RF56). */
export interface DashboardFilters {
  from: string;
  to: string;
  sectorIds: string;
  surveyId: string;
  period: ShiftPeriod | '';
  teamIds: string;
  origin: Origin | '';
}

export const FILTER_KEYS = [
  'from',
  'to',
  'sectorIds',
  'surveyId',
  'period',
  'teamIds',
  'origin',
] as const satisfies readonly (keyof DashboardFilters)[];

export function defaultPeriod(): { from: string; to: string } {
  const today = localDateOf();
  return { from: addDays(today, -29), to: today };
}

/** Filtros da URL; período ausente → últimos 30 dias. */
export function useDashboardFilters(fixed: Partial<DashboardFilters> = {}) {
  const [params, setParams] = useSearchParams();
  const filters = useMemo<DashboardFilters>(() => {
    const fallback = defaultPeriod();
    const value = (key: keyof DashboardFilters) => params.get(key) ?? '';
    return {
      from: value('from') || fallback.from,
      to: value('to') || fallback.to,
      sectorIds: value('sectorIds'),
      surveyId: value('surveyId'),
      period: value('period') as DashboardFilters['period'],
      teamIds: value('teamIds'),
      origin: value('origin') as DashboardFilters['origin'],
      ...fixed,
    };
    // `fixed` é um objeto literal das telas; o setor fixo é o que importa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, fixed.sectorIds]);
  const compare = params.get('compare') === 'previous_period';

  const apply = useCallback(
    (next: DashboardFilters, nextCompare = compare) => {
      const search = new URLSearchParams();
      for (const key of FILTER_KEYS) {
        if (next[key] !== '' && fixed[key] === undefined) search.set(key, next[key]);
      }
      if (nextCompare) search.set('compare', 'previous_period');
      setParams(search, { replace: true });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setParams, compare, fixed.sectorIds],
  );

  const clear = useCallback(() => {
    setParams(new URLSearchParams(), { replace: true });
  }, [setParams]);

  return { filters, compare, apply, clear };
}

export function filterQuery(filters: DashboardFilters, extra: Record<string, string> = {}): string {
  return toQueryString({ ...filters, ...extra });
}

export interface NpsIndicator {
  n: number | null;
  nps: number | null;
  promoters: number | null;
  passives: number | null;
  detractors: number | null;
  promotersPercent: number | null;
  passivesPercent: number | null;
  detractorsPercent: number | null;
  suppressed: boolean;
}

export interface Coverage {
  total: number | null;
  attributed: number | null;
  percent: number | null;
  suppressed: boolean;
}

export interface Summary {
  period: { from: string; to: string };
  indicators: NpsIndicator;
  distribution: { score: number; count: number; percent: number | null }[] | null;
  manifestations: {
    total: number | null;
    compliment: number | null;
    complaint: number | null;
    suggestion: number | null;
    suppressed: boolean;
  };
  coverage: Coverage;
  comparison: {
    period: { from: string; to: string };
    indicators: NpsIndicator;
    delta: number | null;
    noPreviousData: boolean;
  } | null;
}

export interface SectorResult {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  indicators: NpsIndicator;
}

export interface ShiftResult {
  period: ShiftPeriod;
  indicators: NpsIndicator;
}

export interface TeamResult {
  id: string;
  code: string;
  name: string;
  sector: { id: string; name: string };
  indicators: NpsIndicator;
}

export interface TrendPoint {
  start: string;
  end: string;
  n: number | null;
  nps: number | null;
  suppressed: boolean;
}

export interface QuestionResult {
  questionId: string;
  text: string;
  journeyStage: { id: string | null; name: string | null; position: number | null };
  survey: { id: string; title: string };
  n: number | null;
  average: number | null;
  distribution: { score: number; count: number }[] | null;
  topTwoPercent: number | null;
  suppressed: boolean;
}

type Meta = { from: string; to: string };

/** Consulta de indicador com atualização periódica e dados anteriores mantidos ao filtrar. */
function useIndicator<T, M = Meta>(name: string, path: string) {
  const { request } = useAuth();
  return useQuery({
    queryKey: ['dashboard', name, path],
    queryFn: () => request<T, M>(path),
    refetchInterval: REFRESH_INTERVAL_MS,
    placeholderData: keepPreviousData,
  });
}

/** E28 */
export function useSummary(filters: DashboardFilters, compare: boolean) {
  return useIndicator<Summary>(
    'summary',
    `/dashboard/summary${filterQuery(filters, compare ? { compare: 'previous_period' } : {})}`,
  );
}

/** E29 */
export function useSectorResults(filters: DashboardFilters) {
  return useIndicator<SectorResult[]>('sectors', `/dashboard/sectors${filterQuery(filters)}`);
}

/** E30 */
export function useShiftResults(filters: DashboardFilters) {
  return useIndicator<ShiftResult[], Meta & { coverage: Coverage }>(
    'shifts',
    `/dashboard/shifts${filterQuery(filters)}`,
  );
}

/** E31 */
export function useTeamResults(filters: DashboardFilters) {
  return useIndicator<TeamResult[], Meta & { coverage: Coverage }>(
    'teams',
    `/dashboard/teams${filterQuery(filters)}`,
  );
}

/** E32 */
export function useTrends(filters: DashboardFilters) {
  return useIndicator<TrendPoint[], Meta & { granularity: 'day' | 'week' | 'month' }>(
    'trends',
    `/dashboard/trends${filterQuery(filters)}`,
  );
}

/** E33 */
export function useQuestionResults(filters: DashboardFilters) {
  return useIndicator<QuestionResult[], Meta & { total: number | null }>(
    'questions',
    `/dashboard/questions${filterQuery(filters)}`,
  );
}

/** Número em pt-BR com vírgula decimal (RNF29); nulo → travessão. */
export function formatNumber(value: number | null, digits = 1): string {
  if (value === null) return '—';
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : digits,
    maximumFractionDigits: digits,
  });
}

/** Valida o período como o backend (RN25): from ≤ to e até 366 dias. */
export function periodError(from: string, to: string): string | null {
  if (from === '' || to === '') return 'Informe as duas datas.';
  if (from > to) return 'A data inicial deve ser anterior ou igual à final.';
  if (daysInclusive(from, to) > MAX_RANGE_DAYS) {
    return `O período deve ter no máximo ${MAX_RANGE_DAYS} dias.`;
  }
  return null;
}
