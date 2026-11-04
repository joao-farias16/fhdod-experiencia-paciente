import { RotateCw } from 'lucide-react';
import { useId, useState } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { SelectField } from '../../components/ui/Field';
import { ApiError } from '../../lib/api-client';
import { failureOf, SAVE_FAILED } from '../../lib/errors';
import {
  type ManifestationDetail,
  type ManifestationPatch,
  type ManifestationPriority,
  type ManifestationStatus,
  PRIORITY_LABELS,
  STATUS_LABELS,
  useAddNote,
  useUpdateManifestation,
} from './manifestations-api';

/** RN23: concluir exige providências com 10 caracteres ou mais; arquivar exige nota. */
const ACTIONS_MIN = 10;
const TEXT_MAX = 2000;

const TEXTAREA =
  'block w-full rounded-lg border border-neutral-border bg-white p-3 text-base aria-invalid:border-danger-700';

/** Formulário de tratamento: status (RN23), prioridade, providências e nota ao arquivar (RF46). */
export function TreatmentForm({
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
  const failure = update.error === null ? null : failureOf(update.error, SAVE_FAILED);

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

export function NoteForm({ id }: { id: string }) {
  const ids = useId();
  const add = useAddNote(id);
  const [content, setContent] = useState('');
  const failure = add.error === null ? null : failureOf(add.error, SAVE_FAILED);
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
