import { ArrowLeft, Eye, RotateCw, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { Link, useParams } from 'react-router';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { SelectField } from '../../components/ui/Field';
import { ErrorState, Loading } from '../../components/ui/States';
import { ApiError } from '../../lib/api-client';
import { formatDateTime } from '../../lib/format';
import { ConfirmDialog } from '../users/ConfirmDialog';
import {
  type ContactDeletionReason,
  type ManifestationDetail,
  type ManifestationPatch,
  type ManifestationPriority,
  type ManifestationStatus,
  PRIORITY_LABELS,
  REASON_LABELS,
  STATUS_LABELS,
  type TimelineEvent,
  TYPE_LABELS,
  useAddNote,
  useContactActions,
  useManifestation,
  useUpdateManifestation,
} from './ombudsman-api';

/** RN23: concluir exige providências com 10 caracteres ou mais; arquivar exige nota. */
const ACTIONS_MIN = 10;
const TEXT_MAX = 2000;

const TEXTAREA =
  'block w-full rounded-lg border border-neutral-border bg-white p-3 text-base aria-invalid:border-danger-700';

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

function errorText(error: unknown): { text: string; requestId?: string | undefined } {
  if (error instanceof ApiError) return { text: error.message, requestId: error.requestId };
  return { text: 'Não foi possível salvar. Tente novamente.' };
}

/** Formulário de tratamento: status (RN23), prioridade, providências e nota ao arquivar (RF46). */
function TreatmentForm({
  detail,
  onReload,
}: {
  detail: ManifestationDetail;
  onReload: () => void;
}) {
  const ids = useId();
  const update = useUpdateManifestation(detail.id);
  const [status, setStatus] = useState<ManifestationStatus | ''>('');
  const [priority, setPriority] = useState<ManifestationPriority>(detail.priority);
  const [actions, setActions] = useState(detail.actionsTaken ?? '');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const trimmedActions = actions.trim();
  const save = () => {
    setSaved(false);
    const patch: ManifestationPatch = { updatedAt: detail.updatedAt };
    if (status !== '') patch.status = status;
    if (priority !== detail.priority) patch.priority = priority;
    if (trimmedActions !== '' && trimmedActions !== (detail.actionsTaken ?? '')) {
      patch.actionsTaken = trimmedActions;
    }
    if (note.trim() !== '') patch.note = note.trim();
    if (
      patch.status === undefined &&
      patch.priority === undefined &&
      patch.actionsTaken === undefined
    ) {
      setProblem('Altere o status, a prioridade ou as providências antes de salvar.');
      return;
    }
    if (status === 'resolved' && trimmedActions.length < ACTIONS_MIN) {
      setProblem(
        `Para concluir, descreva as providências com pelo menos ${ACTIONS_MIN} caracteres.`,
      );
      return;
    }
    if (status === 'archived' && note.trim() === '') {
      setProblem('Para arquivar, registre uma nota com o motivo.');
      return;
    }
    setProblem(null);
    update.mutate(patch, {
      onSuccess: () => {
        setSaved(true);
      },
    });
  };

  const stale = update.error instanceof ApiError && update.error.code === 'STALE_RESOURCE';
  const failure = update.error === null ? null : errorText(update.error);

  return (
    <section
      aria-labelledby={`${ids}-titulo`}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2 id={`${ids}-titulo`} className="text-lg font-semibold">
        Tratamento
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Novo status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as ManifestationStatus | '');
          }}
          hint={`Atual: ${STATUS_LABELS[detail.status]}.`}
        >
          <option value="">Manter</option>
          {detail.allowedTransitions.map((value) => (
            <option key={value} value={value}>
              {STATUS_LABELS[value]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Prioridade"
          value={priority}
          onChange={(event) => {
            setPriority(event.target.value as ManifestationPriority);
          }}
        >
          {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${ids}-providencias`} className="block font-medium">
          Providências
        </label>
        <textarea
          id={`${ids}-providencias`}
          rows={4}
          maxLength={TEXT_MAX}
          value={actions}
          onChange={(event) => {
            setActions(event.target.value);
          }}
          aria-describedby={`${ids}-providencias-dica`}
          className={TEXTAREA}
        />
        <p id={`${ids}-providencias-dica`} className="text-sm text-slate-600">
          Obrigatório para concluir (pelo menos 10 caracteres).
        </p>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${ids}-nota`} className="block font-medium">
          Nota interna (obrigatória para arquivar)
        </label>
        <textarea
          id={`${ids}-nota`}
          rows={2}
          maxLength={TEXT_MAX}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
          className={TEXTAREA}
        />
      </div>
      {problem === null ? null : <Alert tone="error">{problem}</Alert>}
      {failure === null ? null : (
        <Alert tone="error" title="Alteração não salva" requestId={failure.requestId}>
          {failure.text}
        </Alert>
      )}
      {saved && update.error === null ? <Alert tone="success">Alterações salvas.</Alert> : null}
      <div className="flex flex-wrap gap-3">
        <Button onClick={save} disabled={update.isPending}>
          {update.isPending ? 'Salvando…' : 'Salvar alterações'}
        </Button>
        {stale ? (
          <Button
            variant="secondary"
            onClick={() => {
              update.reset();
              onReload();
            }}
          >
            <RotateCw aria-hidden="true" className="size-4" />
            Recarregar a versão atual
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function NoteForm({ id }: { id: string }) {
  const ids = useId();
  const add = useAddNote(id);
  const [content, setContent] = useState('');
  const failure = add.error === null ? null : errorText(add.error);
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (content.trim() === '') return;
        add.mutate(content.trim(), {
          onSuccess: () => {
            setContent('');
          },
        });
      }}
      className="space-y-2"
    >
      <label htmlFor={`${ids}-nota`} className="block font-medium">
        Nova nota interna
      </label>
      <textarea
        id={`${ids}-nota`}
        rows={2}
        maxLength={TEXT_MAX}
        value={content}
        onChange={(event) => {
          setContent(event.target.value);
        }}
        className={TEXTAREA}
      />
      <p className="text-sm text-slate-600">Notas não podem ser editadas e nunca são exportadas.</p>
      {failure === null ? null : (
        <Alert tone="error" requestId={failure.requestId}>
          {failure.text}
        </Alert>
      )}
      <Button type="submit" variant="secondary" disabled={add.isPending || content.trim() === ''}>
        {add.isPending ? 'Salvando…' : 'Adicionar nota'}
      </Button>
    </form>
  );
}

/** Contato por ação explícita, com aviso de finalidade e auditoria (RF48); eliminação (RF49). */
function ContactPanel({ detail }: { detail: ManifestationDetail }) {
  const ids = useId();
  const { view, remove } = useContactActions(detail.id);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState<ContactDeletionReason>('return_completed');

  return (
    <section
      aria-labelledby={`${ids}-titulo`}
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2 id={`${ids}-titulo`} className="text-lg font-semibold">
        Contato do respondente
      </h2>
      {!detail.hasContact ? (
        <p className="text-slate-700">
          {detail.isAnonymous
            ? 'Manifestação anônima: sem dados de contato.'
            : 'Os dados de contato foram eliminados.'}
        </p>
      ) : view.data === undefined ? (
        <>
          <p className="text-slate-700">
            Use o contato somente para dar retorno sobre esta manifestação. Cada consulta fica
            registrada na auditoria.
          </p>
          {view.error === null ? null : (
            <Alert
              tone="error"
              requestId={view.error instanceof ApiError ? view.error.requestId : undefined}
            >
              {errorText(view.error).text}
            </Alert>
          )}
          <Button
            variant="secondary"
            onClick={() => {
              view.mutate();
            }}
            disabled={view.isPending}
          >
            <Eye aria-hidden="true" className="size-4" />
            {view.isPending ? 'Carregando…' : 'Ver contato'}
          </Button>
        </>
      ) : (
        <>
          <Alert tone="info">{view.data.purposeText}</Alert>
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
            <dt className="font-medium">Nome</dt>
            <dd>{view.data.fullName}</dd>
            <dt className="font-medium">Telefone</dt>
            <dd>{view.data.phone ?? 'Não informado'}</dd>
            <dt className="font-medium">E-mail</dt>
            <dd className="break-all">{view.data.email ?? 'Não informado'}</dd>
            <dt className="font-medium">Aceite</dt>
            <dd>
              {formatDateTime(view.data.consentGivenAt)} (finalidade {view.data.purposeTextVersion})
            </dd>
          </dl>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                view.reset();
              }}
            >
              Ocultar contato
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirming(true);
              }}
            >
              <Trash2 aria-hidden="true" className="size-4" />
              Eliminar contato
            </Button>
          </div>
        </>
      )}
      <ConfirmDialog
        open={confirming}
        title="Eliminar os dados de contato?"
        confirmLabel="Eliminar contato"
        danger
        busy={remove.isPending}
        error={remove.error === null ? null : errorText(remove.error).text}
        onClose={() => {
          setConfirming(false);
          remove.reset();
        }}
        onConfirm={() => {
          remove.mutate(reason, {
            onSuccess: () => {
              setConfirming(false);
            },
          });
        }}
      >
        <div className="space-y-3">
          <p>A manifestação e o histórico são mantidos. O contato não pode ser recuperado.</p>
          <SelectField
            label="Motivo"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value as ContactDeletionReason);
            }}
          >
            {Object.entries(REASON_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
        </div>
      </ConfirmDialog>
    </section>
  );
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
