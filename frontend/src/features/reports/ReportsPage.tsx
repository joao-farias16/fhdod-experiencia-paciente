import { useState } from 'react';

import { Alert } from '../../components/ui/Alert';
import { SelectField } from '../../components/ui/Field';
import { ApiError } from '../../lib/api-client';
import { useMe } from '../auth/auth-context';
import { type DashboardFilters, defaultPeriod } from '../dashboard/dashboard-api';
import { DashboardFiltersForm } from '../dashboard/DashboardFiltersForm';
import { STATUS_LABELS, TYPE_LABELS } from '../ombudsman/ombudsman-api';
import { allowedReports, REPORT_LABELS, type ReportType, useExport } from './reports-api';

const DESCRIPTIONS: Record<ReportType, string> = {
  responses:
    'Abas Filtros, Indicadores, Respostas e Respostas por pergunta. Sem nome, telefone, e-mail ou texto livre.',
  indicators: 'Abas Filtros, Resumo, Por setor, Por pergunta e Tendência, iguais aos do painel.',
  manifestations:
    'Protocolo, datas, setor, tipo, status, prioridade, anonimato e se há contato. Os dados de contato nunca são exportados.',
};

function initialFilters(): DashboardFilters {
  return { ...defaultPeriod(), sectorIds: '', surveyId: '', period: '', teamIds: '', origin: '' };
}

/**
 * TL14 — Exportação de relatórios (/relatorios): tipo conforme a permissão do perfil, filtros
 * comuns e, para a Ouvidoria, status, tipo de manifestação e Incluir textos (RF63–RF67). Limites:
 * 10 exportações a cada 10 minutos e 50.000 linhas por aba (mensagens do backend).
 */
export function ReportsPage() {
  const me = useMe();
  const types = allowedReports(me);
  const [type, setType] = useState<ReportType>(types[0] ?? 'responses');
  const [filters, setFilters] = useState<DashboardFilters>(initialFilters);
  const [status, setStatus] = useState('');
  const [manifestationType, setManifestationType] = useState('');
  const [includeText, setIncludeText] = useState(false);
  const exporter = useExport();

  const generate = (current: DashboardFilters) => {
    setFilters(current);
    exporter.mutate({
      type,
      filters: current,
      ...(type === 'manifestations' ? { status, manifestationType, includeText } : {}),
    });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Relatórios</h1>
        <p className="text-slate-700">
          Gere planilhas do Excel com os filtros escolhidos. Datas no formato dd/mm/aaaa e horário
          de Brasília.
        </p>
      </div>

      <section
        aria-labelledby="tipo-titulo"
        className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <h2 id="tipo-titulo" className="text-lg font-semibold">
          Tipo de relatório
        </h2>
        <SelectField
          label="Relatório"
          value={type}
          hint={DESCRIPTIONS[type]}
          onChange={(event) => {
            setType(event.target.value as ReportType);
            exporter.reset();
          }}
        >
          {types.map((value) => (
            <option key={value} value={value}>
              {REPORT_LABELS[value]}
            </option>
          ))}
        </SelectField>
        {type === 'manifestations' ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField
              label="Status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
              }}
            >
              <option value="">Todos</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Tipo de manifestação"
              value={manifestationType}
              onChange={(event) => {
                setManifestationType(event.target.value);
              }}
            >
              <option value="">Todos</option>
              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>
            <label className="flex min-h-11 items-center gap-3 self-end">
              <input
                type="checkbox"
                checked={includeText}
                onChange={(event) => {
                  setIncludeText(event.target.checked);
                }}
                className="size-5"
              />
              Incluir textos (descrição e providências)
            </label>
          </div>
        ) : null}
      </section>

      <DashboardFiltersForm
        key={JSON.stringify(filters)}
        filters={filters}
        submitLabel={exporter.isPending ? 'Gerando arquivo…' : 'Gerar arquivo Excel'}
        submitting={exporter.isPending}
        onApply={(current) => {
          generate(current);
        }}
        onClear={() => {
          setFilters(initialFilters());
          exporter.reset();
        }}
      />

      <div aria-live="polite" className="space-y-3">
        {exporter.isError ? (
          <Alert
            tone="error"
            title="Não foi possível gerar o relatório"
            requestId={exporter.error instanceof ApiError ? exporter.error.requestId : undefined}
          >
            {exporter.error instanceof ApiError ? exporter.error.message : 'Tente novamente.'}
          </Alert>
        ) : null}
        {exporter.isSuccess ? <Alert tone="success">Arquivo gerado: {exporter.data}</Alert> : null}
      </div>
    </div>
  );
}
