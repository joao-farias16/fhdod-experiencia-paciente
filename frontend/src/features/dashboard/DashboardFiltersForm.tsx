import { RotateCw } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../../components/ui/Button';
import { SelectField, TextField } from '../../components/ui/Field';
import { useQuery } from '@tanstack/react-query';
import type { PageMeta } from '../../lib/api-client';
import { addDays, localDateOf } from '../../lib/format';
import { useAuth, useMe } from '../auth/auth-context';
import { can } from '../auth/auth-types';
import { useTeams } from '../structure/structure-api';
import type { SurveySummary } from '../surveys/surveys-api';
import { useSectors } from '../users/users-api';
import { type DashboardFilters, ORIGIN_LABELS, PERIOD_LABELS, periodError } from './dashboard-api';

type Shortcut = '7' | '30' | '90' | 'mes' | 'personalizado';

function shortcutRange(shortcut: Exclude<Shortcut, 'personalizado'>): { from: string; to: string } {
  const today = localDateOf();
  if (shortcut === 'mes') return { from: `${today.slice(0, 8)}01`, to: today };
  return { from: addDays(today, -(Number(shortcut) - 1)), to: today };
}

function shortcutOf(from: string, to: string): Shortcut {
  for (const shortcut of ['7', '30', '90', 'mes'] as const) {
    const range = shortcutRange(shortcut);
    if (range.from === from && range.to === to) return shortcut;
  }
  return 'personalizado';
}

interface Props {
  filters: DashboardFilters;
  compare?: boolean | undefined;
  /** Setor fixo da tela (TL04): o filtro de setor não aparece. */
  fixedSector?: string | undefined;
  onApply: (filters: DashboardFilters, compare: boolean) => void;
  onClear: () => void;
  onRefresh?: (() => void) | undefined;
  refreshing?: boolean;
  /** Texto do botão principal (TL14: "Gerar arquivo Excel"). */
  submitLabel?: string;
  submitting?: boolean;
}

/**
 * Filtros do painel em uma linha acima dos gráficos (RF56, RF57, RF58): atalhos de período e
 * intervalo personalizado, setor, pesquisa (perfis que consultam pesquisas), turno, equipe, origem
 * e comparação com o período anterior. Os valores vão para a URL ao aplicar; a tela remonta o
 * formulário (key) quando os filtros aplicados mudam.
 */
export function DashboardFiltersForm({
  filters,
  compare,
  fixedSector,
  onApply,
  onClear,
  onRefresh,
  refreshing = false,
  submitLabel = 'Aplicar filtros',
  submitting = false,
}: Props) {
  const me = useMe();
  const { request } = useAuth();
  const [draft, setDraft] = useState(filters);
  const [draftCompare, setDraftCompare] = useState(compare ?? false);
  const [error, setError] = useState<string | null>(null);
  const sectors = useSectors();
  const teams = useTeams(fixedSector ?? (draft.sectorIds === '' ? undefined : draft.sectorIds));
  const canSurveys = can(me, 'surveys:read');
  const surveys = useQuery({
    queryKey: ['admin', 'surveys', 'filtro'],
    queryFn: async () =>
      (await request<SurveySummary[], PageMeta>('/admin/surveys?pageSize=100')).data,
    enabled: canSurveys,
  });

  const set = <K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const shortcut = shortcutOf(draft.from, draft.to);

  return (
    <form
      role="search"
      aria-label="Filtros do painel"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const problem = periodError(draft.from, draft.to);
        setError(problem);
        if (problem === null) onApply(draft, draftCompare);
      }}
      className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4"
    >
      <SelectField
        label="Período"
        value={shortcut}
        onChange={(event) => {
          const value = event.target.value as Shortcut;
          if (value !== 'personalizado')
            setDraft((current) => ({ ...current, ...shortcutRange(value) }));
        }}
      >
        <option value="7">Últimos 7 dias</option>
        <option value="30">Últimos 30 dias</option>
        <option value="90">Últimos 90 dias</option>
        <option value="mes">Este mês</option>
        <option value="personalizado">Personalizado</option>
      </SelectField>
      <TextField
        label="De"
        type="date"
        value={draft.from}
        error={error ?? undefined}
        onChange={(event) => {
          set('from', event.target.value);
        }}
      />
      <TextField
        label="Até"
        type="date"
        value={draft.to}
        onChange={(event) => {
          set('to', event.target.value);
        }}
      />
      {fixedSector === undefined ? (
        <SelectField
          label="Setor"
          value={draft.sectorIds}
          onChange={(event) => {
            setDraft((current) => ({ ...current, sectorIds: event.target.value, teamIds: '' }));
          }}
        >
          <option value="">Todos do seu escopo</option>
          {(sectors.data ?? []).map((sector) => (
            <option key={sector.id} value={sector.id}>
              {sector.name}
            </option>
          ))}
        </SelectField>
      ) : null}
      {canSurveys ? (
        <SelectField
          label="Pesquisa"
          value={draft.surveyId}
          onChange={(event) => {
            set('surveyId', event.target.value);
          }}
        >
          <option value="">Todas</option>
          {(surveys.data ?? [])
            .filter((survey) => fixedSector === undefined || survey.sectorId === fixedSector)
            .map((survey) => (
              <option key={survey.id} value={survey.id}>
                {survey.title}
              </option>
            ))}
        </SelectField>
      ) : null}
      <SelectField
        label="Turno"
        hint="Considera só respostas atribuídas a turno."
        value={draft.period}
        onChange={(event) => {
          set('period', event.target.value as DashboardFilters['period']);
        }}
      >
        <option value="">Todos</option>
        {Object.entries(PERIOD_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Equipe"
        hint="Considera só respostas atribuídas a equipe."
        value={draft.teamIds}
        onChange={(event) => {
          set('teamIds', event.target.value);
        }}
      >
        <option value="">Todas</option>
        {(teams.data ?? []).map((team) => (
          <option key={team.id} value={team.id}>
            {fixedSector === undefined ? `${team.sectorName} — ${team.name}` : team.name}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Origem"
        value={draft.origin}
        onChange={(event) => {
          set('origin', event.target.value as DashboardFilters['origin']);
        }}
      >
        <option value="">Todas</option>
        {Object.entries(ORIGIN_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </SelectField>
      {compare === undefined ? null : (
        <label className="flex min-h-11 items-center gap-3 self-end">
          <input
            type="checkbox"
            checked={draftCompare}
            onChange={(event) => {
              setDraftCompare(event.target.checked);
            }}
            className="size-5"
          />
          Comparar com o período anterior
        </label>
      )}
      <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit" disabled={submitting} aria-busy={submitting}>
          {submitLabel}
        </Button>
        <Button variant="secondary" onClick={onClear}>
          Limpar filtros
        </Button>
        {onRefresh === undefined ? null : (
          <Button variant="ghost" onClick={onRefresh} disabled={refreshing}>
            <RotateCw aria-hidden="true" className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        )}
      </div>
    </form>
  );
}
