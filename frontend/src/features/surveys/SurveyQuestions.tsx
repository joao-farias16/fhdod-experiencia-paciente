import { ArrowDown, ArrowUp, Lock, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { SelectField, TextField } from '../../components/ui/Field';
import { ApiError } from '../../lib/api-client';
import { applyApiError, type Failure, failureOf } from '../../lib/errors';
import { useJourneyStages } from '../sectors/sectors-api';
import {
  MAX_ACTIVE_QUESTIONS,
  type SurveyDetail,
  type SurveyPatch,
  type SurveyQuestion,
  useUpdateSurvey,
} from './surveys-api';

function QuestionDialog({
  question,
  onClose,
  onSubmit,
}: {
  question?: SurveyQuestion | undefined;
  onClose: () => void;
  onSubmit: (values: { text: string; journeyStageId: string }) => Promise<void>;
}) {
  const stages = useJourneyStages();
  const [failure, setFailure] = useState<Failure | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<{ text: string; journeyStageId: string }>({
    defaultValues: { text: question?.text ?? '', journeyStageId: question?.journeyStage?.id ?? '' },
  });
  const submit = handleSubmit(async (values) => {
    setFailure(null);
    try {
      await onSubmit({ text: values.text.trim(), journeyStageId: values.journeyStageId });
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) setFailure(failureOf(error));
      else setFailure(applyApiError(error, ['text', 'journeyStageId'], setError));
    }
  });
  return (
    <Dialog
      open
      title={question === undefined ? 'Nova pergunta específica' : 'Editar pergunta'}
      description="Escala de 1 (Muito ruim) a 5 (Muito bom), opcional para quem responde."
      onClose={onClose}
    >
      <form noValidate onSubmit={(event) => void submit(event)} className="space-y-4">
        {failure === null ? null : (
          <Alert tone="error" requestId={failure.requestId}>
            {failure.text}
          </Alert>
        )}
        <TextField
          label="Texto da pergunta"
          maxLength={200}
          error={errors.text?.message}
          {...register('text', {
            validate: (value) =>
              (value.trim().length >= 5 && value.trim().length <= 200) ||
              'A pergunta deve ter de 5 a 200 caracteres.',
          })}
        />
        <SelectField
          label="Etapa da jornada"
          error={errors.journeyStageId?.message}
          {...register('journeyStageId', { required: 'Escolha a etapa.' })}
        >
          <option value="">Selecione…</option>
          {(stages.data ?? [])
            .filter((stage) => stage.isActive)
            .map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
        </SelectField>
        <div className="flex flex-wrap justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Salvando…' : 'Salvar pergunta'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Perguntas específicas (RF27, RF28): etapa, ordem, ativação; limite de 10 ativas (RN27). */
export function QuestionsSection({
  survey,
  onSaved,
}: {
  survey: SurveyDetail;
  onSaved: (message: string) => void;
}) {
  const update = useUpdateSurvey(survey.id);
  const [editing, setEditing] = useState<{ question?: SurveyQuestion } | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const specifics = survey.questions
    .filter((question) => question.type === 'scale_1_5')
    .sort(
      (a, b) =>
        (a.journeyStage?.position ?? 0) - (b.journeyStage?.position ?? 0) ||
        a.position - b.position,
    );
  const active = specifics.filter((question) => question.isActive).length;

  const change = async (patch: SurveyPatch, message: string) => {
    setFailure(null);
    try {
      await update.mutateAsync(patch);
      onSaved(message);
    } catch (error) {
      setFailure(failureOf(error));
    }
  };

  const move = (index: number, offset: -1 | 1) => {
    const current = specifics[index];
    const other = specifics[index + offset];
    if (current === undefined || other === undefined) return;
    const position =
      other.position === current.position ? current.position + offset : other.position;
    void change(
      {
        questions: [
          { id: current.id, position: Math.max(1, position) },
          { id: other.id, position: Math.max(1, current.position) },
        ],
      },
      'Ordem das perguntas atualizada.',
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-slate-700" aria-live="polite">
          {active} de {MAX_ACTIVE_QUESTIONS} perguntas específicas ativas.
        </p>
        <Button
          disabled={active >= MAX_ACTIVE_QUESTIONS}
          title={
            active >= MAX_ACTIVE_QUESTIONS ? 'Desative uma pergunta para incluir outra.' : undefined
          }
          onClick={() => {
            setEditing({});
          }}
        >
          <Plus aria-hidden="true" className="size-5" />
          Nova pergunta
        </Button>
      </div>
      {failure === null ? null : (
        <Alert tone="error" requestId={failure.requestId}>
          {failure.text}
        </Alert>
      )}
      {specifics.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-border bg-white p-4 text-slate-700">
          Nenhuma pergunta específica. A pesquisa pode ter só a pergunta geral.
        </p>
      ) : (
        <ol className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {specifics.map((question, index) => (
            <li key={question.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 basis-60">
                <p
                  className={`font-medium ${question.isActive ? '' : 'text-slate-600 line-through'}`}
                >
                  {question.text}
                </p>
                <p className="text-sm text-slate-700">
                  {question.journeyStage?.name ?? 'Sem etapa'} ·{' '}
                  {question.isActive ? 'Ativa' : 'Desativada'}
                  {question.locked ? (
                    <>
                      {' '}
                      · <Lock aria-hidden="true" className="inline size-3.5" /> publicada (texto e
                      etapa bloqueados)
                    </>
                  ) : null}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button
                  variant="ghost"
                  aria-label={`Subir: ${question.text}`}
                  disabled={index === 0 || update.isPending}
                  onClick={() => {
                    move(index, -1);
                  }}
                >
                  <ArrowUp aria-hidden="true" className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  aria-label={`Descer: ${question.text}`}
                  disabled={index === specifics.length - 1 || update.isPending}
                  onClick={() => {
                    move(index, 1);
                  }}
                >
                  <ArrowDown aria-hidden="true" className="size-4" />
                </Button>
                {question.locked ? null : (
                  <Button
                    variant="ghost"
                    aria-label={`Editar: ${question.text}`}
                    onClick={() => {
                      setEditing({ question });
                    }}
                  >
                    <Pencil aria-hidden="true" className="size-4" />
                    Editar
                  </Button>
                )}
                <Button
                  variant="ghost"
                  aria-label={`${question.isActive ? 'Desativar' : 'Ativar'}: ${question.text}`}
                  disabled={update.isPending}
                  onClick={() =>
                    void change(
                      { questions: [{ id: question.id, isActive: !question.isActive }] },
                      question.isActive ? 'Pergunta desativada.' : 'Pergunta ativada.',
                    )
                  }
                >
                  {question.isActive ? 'Desativar' : 'Ativar'}
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {editing === null ? null : (
        <QuestionDialog
          question={editing.question}
          onClose={() => {
            setEditing(null);
          }}
          onSubmit={async (values) => {
            await update.mutateAsync({
              questions: [
                editing.question === undefined ? values : { id: editing.question.id, ...values },
              ],
            });
            setEditing(null);
            onSaved(editing.question === undefined ? 'Pergunta incluída.' : 'Pergunta atualizada.');
          }}
        />
      )}
    </div>
  );
}
