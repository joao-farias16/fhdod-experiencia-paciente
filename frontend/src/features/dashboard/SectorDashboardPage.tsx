import { ArrowLeft } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import { ErrorState, Loading } from '../../components/ui/States';
import { formatLocalDate } from '../../lib/format';
import { ExportButtons } from '../reports/ExportButtons';
import { useSectors } from '../users/users-api';
import {
  formatNumber,
  PERIOD_LABELS,
  type QuestionResult,
  useDashboardFilters,
  useQuestionResults,
  useShiftResults,
  useSummary,
  useTeamResults,
  useTrends,
} from './dashboard-api';
import { DashboardFiltersForm } from './DashboardFiltersForm';
import { nText, SUPPRESSED_TEXT } from './dashboard-format';
import { NoData } from './DashboardPage';
import { DistributionChart, GroupTable, Panel, SummaryCards, TrendChart } from './DashboardWidgets';

/** Perguntas agrupadas pela etapa da jornada, na ordem das etapas (TL04). */
function byStage(items: QuestionResult[]): { stage: string; items: QuestionResult[] }[] {
  const groups: { stage: string; items: QuestionResult[] }[] = [];
  for (const item of items) {
    const stage = item.journeyStage.name ?? 'Sem etapa';
    let group = groups.find((entry) => entry.stage === stage);
    if (group === undefined) {
      group = { stage, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

/** RF54 — respostas, média (duas casas), distribuição 1–5 e % de notas 4 e 5 por pergunta. */
function QuestionsTable({ items }: { items: QuestionResult[] }) {
  if (items.length === 0) {
    return <p className="text-slate-700">Nenhuma pergunta específica respondida no período.</p>;
  }
  return (
    <div className="space-y-4">
      {byStage(items).map((group) => (
        <div key={group.stage} className="space-y-2">
          <h3 className="font-semibold">{group.stage}</h3>
          <div
            className="overflow-x-auto"
            role="region"
            aria-label={`Perguntas da etapa ${group.stage}`}
            tabIndex={0}
          >
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-slate-100 text-slate-800">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    Pergunta
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Respostas (n)
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Média (1 a 5)
                  </th>
                  {[1, 2, 3, 4, 5].map((score) => (
                    <th key={score} scope="col" className="px-2 py-2 text-right">
                      Nota {score}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2 text-right">
                    Notas 4 e 5
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {group.items.map((item) => (
                  <tr key={`${item.survey.id}-${item.questionId}`}>
                    <th scope="row" className="px-3 py-2 font-medium">
                      {item.text}
                      <span className="block text-xs font-normal text-slate-600">
                        {item.survey.title}
                      </span>
                    </th>
                    <td className="px-3 py-2 text-right tabular-nums">{nText(item)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {item.suppressed ? 'Oculto' : formatNumber(item.average, 2)}
                    </td>
                    {[0, 1, 2, 3, 4].map((index) => (
                      <td key={index} className="px-2 py-2 text-right tabular-nums">
                        {item.distribution?.[index]?.count ?? '—'}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right tabular-nums">
                      {item.topTwoPercent === null ? '—' : `${formatNumber(item.topTwoPercent)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function coverageText(coverage: {
  attributed: number | null;
  total: number | null;
  percent: number | null;
  suppressed: boolean;
}) {
  if (coverage.suppressed) return `Cobertura: ${SUPPRESSED_TEXT}.`;
  return `Só respostas atribuídas a turno e equipe: ${formatNumber(coverage.attributed, 0)} de ${formatNumber(coverage.total, 0)} (${coverage.percent === null ? '—' : `${formatNumber(coverage.percent)}%`}).`;
}

/**
 * TL04 — Dashboard por setor (/painel/setores/:sectorId): indicadores do setor, perguntas por
 * etapa, turnos, equipes e cobertura (RF51, RF53, RF54, RF56, RF57, RF60, RF62). O setor fica
 * fixo no filtro; um setor fora do escopo é recusado pelo backend (403).
 */
export function SectorDashboardPage() {
  const { sectorId = '' } = useParams();
  const [params] = useSearchParams();
  const fixed = useMemo(() => ({ sectorIds: sectorId }), [sectorId]);
  const { filters, compare, apply, clear } = useDashboardFilters(fixed);
  const sectors = useSectors();
  const summary = useSummary(filters, compare);
  const trends = useTrends(filters);
  const questions = useQuestionResults(filters);
  const shifts = useShiftResults(filters);
  const teams = useTeamResults(filters);
  const queries = [summary, trends, questions, shifts, teams];
  const refreshing = queries.some((query) => query.isFetching);
  const refresh = () => {
    for (const query of queries) void query.refetch();
  };
  const name = sectors.data?.find((sector) => sector.id === sectorId)?.name ?? 'Setor';
  const back = new URLSearchParams(params);
  back.delete('sectorIds');
  const backSearch = back.toString();

  let body;
  if (summary.isPending) {
    body = <Loading label="Carregando indicadores do setor…" />;
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
            {trends.isSuccess ? (
              <TrendChart points={trends.data.data} granularity={trends.data.meta.granularity} />
            ) : trends.isError ? (
              <ErrorState error={trends.error} onRetry={() => void trends.refetch()} />
            ) : (
              <Loading />
            )}
          </Panel>
        </div>
        <Panel title="Perguntas por etapa da jornada">
          {questions.isSuccess ? (
            <QuestionsTable items={questions.data.data} />
          ) : questions.isError ? (
            <ErrorState error={questions.error} onRetry={() => void questions.refetch()} />
          ) : (
            <Loading />
          )}
        </Panel>
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Por turno">
            {shifts.isSuccess ? (
              <>
                <p className="text-sm text-slate-700">{coverageText(shifts.data.meta.coverage)}</p>
                <GroupTable
                  caption="Resultados por turno"
                  rows={shifts.data.data.map((item) => ({
                    key: item.period,
                    label: PERIOD_LABELS[item.period],
                    indicators: item.indicators,
                  }))}
                />
              </>
            ) : shifts.isError ? (
              <ErrorState error={shifts.error} onRetry={() => void shifts.refetch()} />
            ) : (
              <Loading />
            )}
          </Panel>
          <Panel title="Por equipe">
            {teams.isSuccess ? (
              <>
                <p className="text-sm text-slate-700">{coverageText(teams.data.meta.coverage)}</p>
                {teams.data.data.length === 0 ? (
                  <p className="text-slate-700">Nenhuma resposta atribuída a equipes no período.</p>
                ) : (
                  <GroupTable
                    caption="Resultados por equipe"
                    rows={teams.data.data.map((item) => ({
                      key: item.id,
                      label: item.name,
                      indicators: item.indicators,
                    }))}
                  />
                )}
              </>
            ) : teams.isError ? (
              <ErrorState error={teams.error} onRetry={() => void teams.refetch()} />
            ) : (
              <Loading />
            )}
          </Panel>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <Link
        to={`/painel${backSearch === '' ? '' : `?${backSearch}`}`}
        className="inline-flex min-h-11 items-center gap-2 font-medium text-brand-700"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Voltar ao painel geral
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{name}</h1>
          <p className="text-slate-700">
            {formatLocalDate(filters.from)} a {formatLocalDate(filters.to)}
          </p>
        </div>
        <ExportButtons filters={filters} />
      </div>
      <DashboardFiltersForm
        key={`${JSON.stringify(filters)}-${String(compare)}`}
        filters={filters}
        compare={compare}
        fixedSector={sectorId}
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
