import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router';

import { Alert } from '../../components/ui/Alert';
import { ErrorState, Loading } from '../../components/ui/States';
import { ApiError } from '../../lib/api-client';
import { formatDateTime } from '../../lib/format';
import { ContactPanel } from './ManifestationContact';
import {
  type ContactDeletionReason,
  type ManifestationPriority,
  type ManifestationStatus,
  PRIORITY_LABELS,
  REASON_LABELS,
  STATUS_LABELS,
  type TimelineEvent,
  TYPE_LABELS,
  useManifestation,
} from './manifestations-api';
import { NoteForm, TreatmentForm } from './ManifestationTreatment';

function describeEvent(event: TimelineEvent): string {
  switch (event.kind) {
    case 'created':
      return 'Manifestação recebida pela pesquisa pública.';
    case 'status_changed':
      return `Status: ${STATUS_LABELS[event.fromValue as ManifestationStatus]} → ${STATUS_LABELS[event.toValue as ManifestationStatus]}.`;
    case 'priority_changed':
      return `Prioridade: ${PRIORITY_LABELS[event.fromValue as ManifestationPriority]} → ${PRIORITY_LABELS[event.toValue as ManifestationPriority]}.`;
    case 'actions_updated':
      return `Providências atualizadas: ${event.content ?? ''}`;
    case 'note':
      return `Nota interna: ${event.content ?? ''}`;
    case 'contact_deleted':
      return `Dados de contato eliminados (${REASON_LABELS[event.toValue as ContactDeletionReason]}).`;
  }
}

/**
 * TL13 — Detalhes e acompanhamento (/ouvidoria/manifestacoes/:id, OU): texto, resposta vinculada,
 * status, prioridade, providências, notas, linha do tempo e contato auditado (RF45–RF49).
 */
export function ManifestationDetailPage() {
  const { id = '' } = useParams();
  const query = useManifestation(id);

  let content;
  if (query.isPending) {
    content = <Loading label="Carregando manifestação…" />;
  } else if (query.isError) {
    content =
      query.error instanceof ApiError && query.error.status === 404 ? (
        <Alert tone="error" title="Manifestação não encontrada">
          Ela não existe ou está fora do seu escopo de setores.
        </Alert>
      ) : (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      );
  } else {
    const detail = query.data;
    content = (
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Manifestação {detail.protocol}</h1>
          <p className="text-slate-700">
            {TYPE_LABELS[detail.type]} · {detail.sector.name} · recebida em{' '}
            {formatDateTime(detail.receivedAt)}
          </p>
          <p className="text-slate-700">
            Status: <strong>{STATUS_LABELS[detail.status]}</strong> · Prioridade:{' '}
            <strong>{PRIORITY_LABELS[detail.priority]}</strong>
            {detail.resolvedAt === null
              ? null
              : ` · concluída em ${formatDateTime(detail.resolvedAt)}`}
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-6">
            <section
              aria-labelledby="texto-titulo"
              className="space-y-2 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <h2 id="texto-titulo" className="text-lg font-semibold">
                Relato
              </h2>
              <p className="break-words whitespace-pre-wrap">{detail.description}</p>
            </section>
            <TreatmentForm
              key={detail.updatedAt}
              detail={detail}
              onReload={() => void query.refetch()}
            />
            <section
              aria-labelledby="linha-titulo"
              className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <h2 id="linha-titulo" className="text-lg font-semibold">
                Linha do tempo
              </h2>
              <ol className="space-y-3 border-l-2 border-slate-200 pl-4">
                {detail.timeline.map((event) => (
                  <li key={event.id}>
                    <p className="text-sm text-slate-600">
                      {formatDateTime(event.createdAt)} ·{' '}
                      {event.author?.fullName ?? 'Pesquisa pública'}
                    </p>
                    <p className="break-words whitespace-pre-wrap">{describeEvent(event)}</p>
                  </li>
                ))}
              </ol>
              <NoteForm id={detail.id} />
            </section>
          </div>
          <div className="space-y-6">
            <section
              aria-labelledby="resposta-titulo"
              className="space-y-2 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <h2 id="resposta-titulo" className="text-lg font-semibold">
                Avaliação vinculada
              </h2>
              <p>
                Nota geral: <strong>{detail.response.npsScore}</strong>
                {detail.response.lowScore ? ' (nota baixa)' : ''}
              </p>
              <p className="text-sm text-slate-700">
                {detail.response.survey.title}, versão {detail.response.survey.versionNumber} ·{' '}
                {detail.response.origin === 'qr_code' ? 'QR Code' : 'Link'} ·{' '}
                {formatDateTime(detail.response.submittedAt)}
              </p>
              {detail.response.answers.length === 0 ? (
                <p className="text-sm text-slate-700">Sem respostas às perguntas específicas.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {detail.response.answers.map((answer) => (
                    <li key={answer.questionText}>
                      {answer.journeyStageName === null ? '' : `${answer.journeyStageName}: `}
                      {answer.questionText} — <strong>{answer.score}</strong> de 5
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <ContactPanel detail={detail} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <Link
        to="/ouvidoria/manifestacoes"
        className="inline-flex min-h-11 items-center gap-2 font-medium text-brand-700"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Voltar para a lista
      </Link>
      {content}
    </div>
  );
}
