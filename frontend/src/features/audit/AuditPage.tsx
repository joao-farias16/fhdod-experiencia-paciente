import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '../../components/ui/Button';
import { SelectField, TextField } from '../../components/ui/Field';
import { EmptyState, ErrorState, Loading, Pagination } from '../../components/ui/States';
import type { PageMeta } from '../../lib/api-client';
import {
  addDays,
  daysInclusive,
  formatDateTime,
  formatLocalDate,
  localDateOf,
  toQueryString,
} from '../../lib/format';
import { useAuth } from '../auth/auth-context';
import { ROLE_LABELS, type UserRole } from '../auth/auth-types';
import { type AdminUser, useSectors } from '../users/users-api';
import { ACTION_LABELS, describeDetails, ENTITY_LABELS } from './audit-labels';

interface AuditLog {
  id: string;
  occurredAt: string;
  actor: { id: string; fullName: string; role: UserRole | null } | null;
  action: string;
  entityType: string;
  entityId: string | null;
  sectorId: string | null;
  details: unknown;
  requestId: string | null;
}

interface AuditFilters {
  from: string;
  to: string;
  actorProfileId: string;
  action: string;
  entityType: string;
  entityId: string;
  pageSize: string;
}

type AuditMeta = PageMeta & { from: string; to: string };

/** RN25: até 366 dias; padrão, últimos 30 dias. RF11: até 100 por página. */
const MAX_DAYS = 366;

function defaultFilters(): AuditFilters {
  const today = localDateOf();
  return {
    from: addDays(today, -29),
    to: today,
    actorProfileId: '',
    action: '',
    entityType: '',
    entityId: '',
    pageSize: '50',
  };
}

/** TL17 — Auditoria (/admin/auditoria, SA): eventos com filtros por período, autor, ação e entidade. */
export function AuditPage() {
  const { request } = useAuth();
  const [filters, setFilters] = useState<AuditFilters>(defaultFilters);
  const [page, setPage] = useState(1);
  const form = useForm<AuditFilters>({ defaultValues: filters });
  const sectors = useSectors();

  const logs = useQuery({
    queryKey: ['admin', 'audit-logs', filters, page],
    queryFn: () =>
      request<AuditLog[], AuditMeta>(
        `/admin/audit-logs${toQueryString({ ...filters, entityId: filters.entityId.trim(), page })}`,
      ),
    placeholderData: keepPreviousData,
  });
  const authors = useQuery({
    queryKey: ['admin', 'users', 'autores'],
    queryFn: async () => (await request<AdminUser[], PageMeta>('/admin/users?pageSize=100')).data,
  });

  const sectorName = (id: string) => sectors.data?.find((sector) => sector.id === id)?.name ?? id;

  const apply = form.handleSubmit((values) => {
    setPage(1);
    setFilters(values);
  });

  const items = logs.data?.data ?? [];
  const meta = logs.data?.meta;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Auditoria</h1>
        <p className="text-slate-700">
          Operações sensíveis e acessos negados, do mais recente para o mais antigo. A trilha não
          pode ser alterada.
        </p>
      </div>

      <form
        role="search"
        aria-label="Filtros da auditoria"
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
        <SelectField label="Autor" {...form.register('actorProfileId')}>
          <option value="">Todos</option>
          {(authors.data ?? []).map((user) => (
            <option key={user.id} value={user.id}>
              {user.fullName}
            </option>
          ))}
        </SelectField>
        <SelectField label="Ação" {...form.register('action')}>
          <option value="">Todas</option>
          {Object.entries(ACTION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
        <SelectField label="Entidade" {...form.register('entityType')}>
          <option value="">Todas</option>
          {Object.entries(ENTITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Identificador da entidade"
          maxLength={64}
          {...form.register('entityId')}
        />
        <SelectField label="Itens por página" {...form.register('pageSize')}>
          <option value="25">25</option>
          <option value="50">50</option>
          <option value="100">100</option>
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
            Limpar
          </Button>
        </div>
      </form>

      <section aria-labelledby="eventos-titulo" className="space-y-4">
        <h2 id="eventos-titulo" className="text-lg font-semibold">
          Eventos de {formatLocalDate(filters.from)} a {formatLocalDate(filters.to)}
        </h2>
        {logs.isPending ? (
          <Loading label="Carregando eventos…" />
        ) : logs.isError ? (
          <ErrorState error={logs.error} onRetry={() => void logs.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState title="Nenhum evento encontrado">
            <p>Amplie o período ou limpe os filtros.</p>
          </EmptyState>
        ) : (
          <div
            className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm"
            tabIndex={0}
            role="region"
            aria-label="Tabela de eventos de auditoria"
          >
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="bg-slate-100 text-slate-800">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Data e hora
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Autor
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Ação
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Entidade
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Detalhes
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {items.map((log) => (
                  <tr key={log.id} className="align-top">
                    <td className="px-4 py-3 whitespace-nowrap">
                      {formatDateTime(log.occurredAt)}
                    </td>
                    <td className="px-4 py-3">
                      {log.actor === null ? (
                        'Sistema'
                      ) : (
                        <>
                          <span className="block font-medium">{log.actor.fullName}</span>
                          <span className="text-slate-700">
                            {log.actor.role === null ? '' : ROLE_LABELS[log.actor.role]}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3">{ACTION_LABELS[log.action] ?? log.action}</td>
                    <td className="px-4 py-3">
                      <span className="block">
                        {ENTITY_LABELS[log.entityType] ?? log.entityType}
                      </span>
                      {log.entityId === null ? null : (
                        <span className="font-mono text-xs break-all text-slate-700">
                          {log.entityId}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ul className="space-y-0.5">
                        {describeDetails(log.details, sectorName).map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                      {log.requestId === null ? null : (
                        <span className="mt-1 block font-mono text-xs text-slate-600">
                          Requisição {log.requestId}
                        </span>
                      )}
                    </td>
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
