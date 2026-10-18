import { ChevronLeft, ChevronRight, LoaderCircle, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';

import { ApiError } from '../../lib/api-client';
import { Alert } from './Alert';
import { Button } from './Button';

/** Estado de carregamento anunciado a leitores de tela (Tabela 22). */
export function Loading({ label = 'Carregando…' }: { label?: string }) {
  return (
    <p role="status" className="flex items-center gap-2 py-6 text-slate-700">
      <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
      {label}
    </p>
  );
}

/** Erro com nova tentativa e requestId (Tabela 22). */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message =
    error instanceof ApiError && error.code !== 'UNEXPECTED_RESPONSE'
      ? error.message
      : 'Não foi possível carregar os dados.';
  return (
    <div className="space-y-3">
      <Alert
        tone="error"
        title="Algo deu errado"
        requestId={error instanceof ApiError ? error.requestId : undefined}
      >
        {message}
      </Alert>
      {onRetry === undefined ? null : (
        <Button variant="secondary" onClick={onRetry}>
          <RotateCw aria-hidden="true" className="size-4" />
          Tentar novamente
        </Button>
      )}
    </div>
  );
}

/** Estado vazio com ação (Tabela 22). */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-neutral-border bg-white p-6 text-center">
      <p className="font-semibold">{title}</p>
      {children === undefined ? null : <div className="mt-2 text-slate-700">{children}</div>}
    </div>
  );
}

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

/** Paginação com texto do intervalo exibido e botões de 44 px. */
export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Paginação" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-slate-700">
        {total === 0 ? 'Nenhum registro' : `Exibindo ${first}–${last} de ${total}`}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            onPageChange(page - 1);
          }}
          disabled={page <= 1}
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          Anterior
        </Button>
        <span className="text-sm text-slate-700">
          Página {page} de {pages}
        </span>
        <Button
          variant="secondary"
          onClick={() => {
            onPageChange(page + 1);
          }}
          disabled={page >= pages}
        >
          Próxima
          <ChevronRight aria-hidden="true" className="size-4" />
        </Button>
      </div>
    </nav>
  );
}
