import { CircleCheck, CircleX, LoaderCircle, RotateCw } from 'lucide-react';

import { ApiError } from '../../lib/api-client';
import { formatDateTime } from '../../lib/format';
import { useApiHealth } from './use-api-health';

/** Mostra a disponibilidade da API, sempre com ícone e texto (RNF08: nunca só por cor). */
export function ApiStatusCard() {
  const { data, error, isPending, isFetching, refetch } = useApiHealth();

  return (
    <section
      aria-labelledby="api-status-title"
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2 id="api-status-title" className="text-lg font-semibold">
        Situação da API
      </h2>

      <div aria-live="polite" className="mt-3">
        {isPending ? (
          <p className="flex items-center gap-2 text-slate-700">
            <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
            Conectando ao servidor…
          </p>
        ) : error ? (
          <div className="space-y-3">
            <p className="flex items-center gap-2 font-medium text-danger-700">
              <CircleX aria-hidden="true" className="size-5" />
              API indisponível
            </p>
            <p className="text-sm text-slate-700">
              Verifique se o backend está em execução e tente novamente.
              {error instanceof ApiError && error.requestId ? (
                <span className="block text-xs text-slate-600">
                  Código da requisição: {error.requestId}
                </span>
              ) : null}
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={isFetching}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-neutral-border px-4 font-medium hover:bg-slate-100 disabled:opacity-60"
            >
              <RotateCw aria-hidden="true" className="size-4" />
              {isFetching ? 'Tentando…' : 'Tentar novamente'}
            </button>
          </div>
        ) : (
          <p className="flex flex-wrap items-center gap-2 text-slate-800">
            <CircleCheck aria-hidden="true" className="size-5 text-green-700" />
            <span className="font-medium">API disponível</span>
            <span className="text-sm text-slate-600">
              (verificado em {formatDateTime(data.timestamp)})
            </span>
          </p>
        )}
      </div>
    </section>
  );
}
