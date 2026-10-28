import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';

import { Button } from '../../components/ui/Button';
import { SelectField, TextField } from '../../components/ui/Field';
import { EmptyState, ErrorState, Loading, Pagination } from '../../components/ui/States';
import {
  addDays,
  daysInclusive,
  formatDateTime,
  formatLocalDate,
  localDateOf,
} from '../../lib/format';
import { useSectors } from '../users/users-api';
import {
  type ManifestationFilters,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TYPE_LABELS,
  useManifestations,
} from './ombudsman-api';

/** RN25: até 366 dias; padrão, últimos 30 dias. */
const MAX_DAYS = 366;

function defaultFilters(): ManifestationFilters {
  const today = localDateOf();
  return {
    from: addDays(today, -29),
    to: today,
    status: '',
    type: '',
    priority: '',
    sectorIds: '',
    protocol: '',
    hasContact: '',
    sort: 'received_desc',
  };
}

/**
 * TL12 — Lista de manifestações (/ouvidoria/manifestacoes, OU): filtros por status, tipo,
 * prioridade, setor, período, protocolo e contato (RF44). Mostra só o trecho de 120 caracteres e
 * se há contato; os dados de contato ficam no detalhe, por ação explícita (RF48).
 */
export function ManifestationsPage() {
  const [filters, setFilters] = useState<ManifestationFilters>(defaultFilters);
  const [page, setPage] = useState(1);
  const form = useForm<ManifestationFilters>({ defaultValues: filters });
  const sectors = useSectors();
  const list = useManifestations(filters, page);

  const apply = form.handleSubmit((values) => {
    setPage(1);
    setFilters(values);
  });

  const items = list.data?.data ?? [];
  const meta = list.data?.meta;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Manifestações</h1>
        <p className="text-slate-700">
          Elogios, reclamações e sugestões recebidas pela pesquisa, da mais recente para a mais
          antiga.
        </p>
      </div>

      <form
        role="search"
        aria-label="Filtros das manifestações"
        noValidate
        onSubmit={(event) => void apply(event)}
        className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4"
      >
        <TextField
          label="De"
          type="date"
          error={form.formState.errors.from?.message}
          {...form.register('from', {
            required: 'Informe a data inicial.',
            validate: (value, values) => {
              if (value > values.to) return 'A data inicial deve ser anterior ou igual à final.';
              return (
                daysInclusive(value, values.to) <= MAX_DAYS ||
                `O período deve ter no máximo ${MAX_DAYS} dias.`
              );
            },
          })}
        />
        <TextField
          label="Até"
          type="date"
          error={form.formState.errors.to?.message}
          {...form.register('to', { required: 'Informe a data final.' })}
        />
        <SelectField label="Status" {...form.register('status')}>
          <option value="">Todos</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
        <SelectField label="Tipo" {...form.register('type')}>
          <option value="">Todos</option>
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
        <SelectField label="Prioridade" {...form.register('priority')}>
          <option value="">Todas</option>
          {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
        <SelectField label="Setor" {...form.register('sectorIds')}>
          <option value="">Todos do seu escopo</option>
          {(sectors.data ?? []).map((sector) => (
            <option key={sector.id} value={sector.id}>
              {sector.name}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Protocolo"
          placeholder="FHD-AAAA-NNNNNN"
          maxLength={15}
          error={form.formState.errors.protocol?.message}
          {...form.register('protocol', {
            validate: (value) =>
              value.trim() === '' ||
              /^FHD-\d{4}-\d{6}$/i.test(value.trim()) ||
              'Use o formato FHD-AAAA-NNNNNN.',
          })}
        />
        <SelectField label="Contato" {...form.register('hasContact')}>
          <option value="">Com ou sem contato</option>
          <option value="true">Com contato</option>
          <option value="false">Sem contato</option>
        </SelectField>
        <SelectField label="Ordenar por" {...form.register('sort')}>
          <option value="received_desc">Mais recentes primeiro</option>
          <option value="received_asc">Mais antigas primeiro</option>
          <option value="priority_desc">Maior prioridade</option>
          <option value="status_asc">Status</option>
        </SelectField>
        <div className="flex items-end gap-2">
          <Button type="submit">Filtrar</Button>
          <Button
            variant="secondary"
            onClick={() => {
              const initial = defaultFilters();
              form.reset(initial);
              setPage(1);
              setFilters(initial);
            }}
          >
            Limpar filtros
          </Button>
        </div>
      </form>

      <section aria-labelledby="lista-titulo" className="space-y-4">
        <h2 id="lista-titulo" className="text-lg font-semibold">
          Recebidas de {formatLocalDate(filters.from)} a {formatLocalDate(filters.to)}
        </h2>
        {list.isPending ? (
          <Loading label="Carregando manifestações…" />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState title="Nenhuma manifestação encontrada">
            <p>Amplie o período ou limpe os filtros.</p>
          </EmptyState>
        ) : (
          <div
            className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm"
            tabIndex={0}
            role="region"
            aria-label="Tabela de manifestações"
          >
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-slate-100 text-slate-800">
                <tr>
                  {[
                    'Protocolo',
                    'Recebida em',
                    'Setor',
                    'Tipo',
                    'Status',
                    'Prioridade',
                    'Trecho',
                    'Contato',
                  ].map((label) => (
                    <th key={label} scope="col" className="px-4 py-3">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {items.map((item) => (
                  <tr key={item.id} className="align-top">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Link
                        to={`/ouvidoria/manifestacoes/${item.id}`}
                        className="inline-flex min-h-11 items-center font-medium text-brand-700 underline underline-offset-4"
                      >
                        {item.protocol}
                      </Link>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {formatDateTime(item.receivedAt)}
                    </td>
                    <td className="px-4 py-3">{item.sector.name}</td>
                    <td className="px-4 py-3">{TYPE_LABELS[item.type]}</td>
                    <td className="px-4 py-3">{STATUS_LABELS[item.status]}</td>
                    <td className="px-4 py-3">{PRIORITY_LABELS[item.priority]}</td>
                    <td className="max-w-xs px-4 py-3 break-words">{item.excerpt}</td>
                    <td className="px-4 py-3">{item.hasContact ? 'Sim' : 'Não'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {meta === undefined || items.length === 0 ? null : (
          <Pagination
            page={meta.page}
            pageSize={meta.pageSize}
            total={meta.total}
            onPageChange={setPage}
          />
        )}
      </section>
    </div>
  );
}
