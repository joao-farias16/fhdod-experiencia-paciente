import { useLocation } from 'react-router';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ErrorState, Loading } from '../../components/ui/States';
import { formatLocalDate } from '../../lib/format';
import { noticeOf } from '../../lib/route-state';
import { useMe } from '../auth/auth-context';
import { ROLE_LABELS } from '../auth/auth-types';
import { ExportButtons } from '../reports/ExportButtons';
import {
  type DashboardFilters,
  useDashboardFilters,
  useSectorResults,
  useSummary,
  useTrends,
} from './dashboard-api';
import { DashboardFiltersForm } from './DashboardFiltersForm';
import { DistributionChart, GroupTable, Panel, SummaryCards, TrendChart } from './DashboardWidgets';

/** RF60: estado sem dados com mensagem e Limpar filtros (NPS nunca exibido como 0). */
export function NoData({ onClear }: { onClear: () => void }) {
  return (
    <div className="space-y-3 rounded-xl border border-dashed border-neutral-border bg-white p-6 text-center">
      <p className="font-semibold">Nenhuma resposta para os filtros escolhidos.</p>
      <p className="text-slate-700">Amplie o período ou limpe os filtros.</p>
      <Button variant="secondary" onClick={onClear}>
        Limpar filtros
      </Button>
    </div>
  );
}

function periodTitle(filters: DashboardFilters): string {
  return `${formatLocalDate(filters.from)} a ${formatLocalDate(filters.to)}`;
}

/**
 * TL03 — Dashboard geral (/painel): filtros na URL, cartões com n, distribuição 0–10, setores,
 * tendência, comparação e exportação (RF50–RF53, RF55, RF56, RF58–RF62). Atualiza ao filtrar, pelo
 * botão Atualizar e a cada 60 s com a aba visível.
 */
export function DashboardPage() {
  const me = useMe();
  const location = useLocation();
  const notice = noticeOf(location.state);
  const { filters, compare, apply, clear } = useDashboardFilters();
  const summary = useSummary(filters, compare);
  const sectors = useSectorResults(filters);
  const trends = useTrends(filters);
  const refreshing = summary.isFetching || sectors.isFetching || trends.isFetching;

  const refresh = () => {
    void summary.refetch();
    void sectors.refetch();
    void trends.refetch();
  };

  let body;
  if (summary.isPending) {
    body = <Loading label="Carregando indicadores…" />;
  } else if (summary.isError) {
    body = <ErrorState error={summary.error} onRetry={refresh} />;
  } else if (summary.data.data.indicators.n === 0) {
    body = <NoData onClear={clear} />;
  } else {
    const data = summary.data.data;
    body = (
      <div className="space-y-6">
        <SummaryCards summary={data} />
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Distribuição das notas de 0 a 10">
            <DistributionChart summary={data} />
          </Panel>
          <Panel title="Tendência">
            {trends.isPending ? (
              <Loading />
            ) : trends.isError ? (
              <ErrorState error={trends.error} onRetry={() => void trends.refetch()} />
            ) : (
              <TrendChart points={trends.data.data} granularity={trends.data.meta.granularity} />
            )}
          </Panel>
        </div>
        <Panel title="Resultados por setor">
          <p className="text-sm text-slate-700">
            Ordenados pelo NPS; setores sem respostas ficam ao final. Selecione um setor para ver
            perguntas, turnos e equipes.
          </p>
          {sectors.isPending ? (
            <Loading />
          ) : sectors.isError ? (
            <ErrorState error={sectors.error} onRetry={() => void sectors.refetch()} />
          ) : (
            <GroupTable
              caption="Resultados por setor"
              rows={sectors.data.data.map((sector) => ({
                key: sector.id,
                label: sector.isActive ? sector.name : `${sector.name} (desativado)`,
                href: `/painel/setores/${sector.id}${location.search}`,
                indicators: sector.indicators,
              }))}
            />
          )}
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      {notice === undefined ? null : <Alert tone="success">{notice}</Alert>}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Olá, {me.fullName}</h1>
          <p className="text-slate-700">
            Painel de indicadores · {periodTitle(filters)} · {ROLE_LABELS[me.role]}
            {me.role === 'viewer' ? ' · grupos com menos de 5 respostas ficam ocultos.' : ''}
          </p>
          <p className="text-sm text-slate-700">
            Escopo:{' '}
            {me.allSectors
              ? 'todos os setores do hospital.'
              : me.sectors.length === 0
                ? 'nenhum setor associado. Procure o superadministrador.'
                : me.sectors.map((sector, index) => (
                    <span key={sector.id}>
                      {index === 0 ? '' : ', '}
                      <span>{sector.name}</span>
                      {sector.isActive ? '' : ' (setor desativado)'}
                    </span>
                  ))}
          </p>
        </div>
        <ExportButtons filters={filters} />
      </div>
      <DashboardFiltersForm
        key={`${JSON.stringify(filters)}-${String(compare)}`}
        filters={filters}
        compare={compare}
        onApply={apply}
        onClear={clear}
        onRefresh={refresh}
        refreshing={refreshing}
      />
      <div aria-live="polite" aria-busy={refreshing}>
        {body}
      </div>
    </div>
  );
}
