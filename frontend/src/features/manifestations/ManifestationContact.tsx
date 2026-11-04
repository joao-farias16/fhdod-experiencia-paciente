import { Eye, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { SelectField } from '../../components/ui/Field';
import { ApiError } from '../../lib/api-client';
import { failureOf, SAVE_FAILED } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import {
  type ContactDeletionReason,
  type ManifestationDetail,
  REASON_LABELS,
  useContactActions,
} from './manifestations-api';

/** Contato por ação explícita, com aviso de finalidade e auditoria (RF48); eliminação (RF49). */
export function ContactPanel({ detail }: { detail: ManifestationDetail }) {
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
              {failureOf(view.error, SAVE_FAILED).text}
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
        error={remove.error === null ? null : failureOf(remove.error, SAVE_FAILED).text}
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
