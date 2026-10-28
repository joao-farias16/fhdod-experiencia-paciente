import { ArrowDown, ArrowUp, Lock, Pencil, Plus, Rocket } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useParams } from 'react-router';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { SelectField, TextField } from '../../components/ui/Field';
import { ErrorState, Loading } from '../../components/ui/States';
import { ApiError } from '../../lib/api-client';
import { formatDateTime } from '../../lib/format';
import { noticeOf } from '../../lib/route-state';
import { useJourneyStages } from '../structure/structure-api';
import { applyApiError, type Failure } from '../structure/form-errors';
import { ConfirmDialog } from '../users/ConfirmDialog';
import { useSectors } from '../users/users-api';
import { SurveyQrPanel } from './SurveyQrPanel';
import { StatusTag } from './SurveysPage';
import {
  MAX_ACTIVE_QUESTIONS,
  type SurveyDetail,
  type SurveyPatch,
  type SurveyQuestion,
  usePublishSurvey,
  useSurvey,
  useUpdateSurvey,
} from './surveys-api';

interface DataForm {
  title: string;
  slug: string;
  sectorId: string;
  introText: string;
  thankYouMessage: string;
  npsQuestionText: string;
}

function messageOf(error: unknown): Failure {
  return error instanceof ApiError
    ? { text: error.message, requestId: error.requestId }
    : { text: 'Não foi possível concluir a ação. Tente novamente.' };
}

/** Dados da pesquisa (RF26): setor, endereço e pergunta geral bloqueados após publicar. */
function SurveyDataForm({
  survey,
  onSaved,
}: {
  survey: SurveyDetail;
  onSaved: (message: string) => void;
}) {
  const sectors = useSectors();
  const update = useUpdateSurvey(survey.id);
  const published = survey.versions.length > 0;
  const nps = survey.questions.find((question) => question.type === 'nps');
  const [failure, setFailure] = useState<Failure | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<DataForm>({
    values: {
      title: survey.title,
      slug: survey.slug,
      sectorId: survey.sectorId,
      introText: survey.introText ?? '',
      thankYouMessage: survey.thankYouMessage,
      npsQuestionText: nps?.text ?? '',
    },
  });

  const submit = handleSubmit(async (values) => {
    setFailure(null);
    const patch: SurveyPatch = {};
    if (values.title.trim() !== survey.title) patch.title = values.title.trim();
    if (values.introText.trim() !== (survey.introText ?? ''))
      patch.introText = values.introText.trim();
    if (values.thankYouMessage.trim() !== survey.thankYouMessage)
      patch.thankYouMessage = values.thankYouMessage.trim();
    if (!published && values.slug.trim() !== survey.slug) patch.slug = values.slug.trim();
    if (!published && values.sectorId !== survey.sectorId) patch.sectorId = values.sectorId;
    if (nps !== undefined && !nps.locked && values.npsQuestionText.trim() !== nps.text)
      patch.npsQuestionText = values.npsQuestionText.trim();
    if (Object.keys(patch).length === 0) return;
    try {
      const updated = await update.mutateAsync(patch);
      reset(undefined, { keepValues: true });
      onSaved(
        updated.currentVersion === null
          ? 'Dados salvos.'
          : 'Dados salvos. Publique para que as mudanças apareçam na pesquisa.',
      );
    } catch (error) {
      setFailure(
        applyApiError(
          error,
          ['title', 'slug', 'sectorId', 'introText', 'thankYouMessage', 'npsQuestionText'],
          setError,
          'slug',
        ),
      );
    }
  });

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="space-y-4">
      {failure === null ? null : (
        <Alert tone="error" requestId={failure.requestId}>
          {failure.text}
        </Alert>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label="Título"
          error={errors.title?.message}
          {...register('title', {
            validate: (value) =>
              (value.trim().length >= 3 && value.trim().length <= 120) ||
              'O título deve ter de 3 a 120 caracteres.',
          })}
        />
        <SelectField
          label="Setor"
          disabled={published}
          hint={published ? 'Não muda depois da primeira publicação.' : undefined}
          error={errors.sectorId?.message}
          {...register('sectorId')}
        >
          {(sectors.data ?? [])
            .filter((sector) => sector.isActive || sector.id === survey.sectorId)
            .map((sector) => (
              <option key={sector.id} value={sector.id}>
                {sector.name}
              </option>
            ))}
        </SelectField>
        <TextField
          label="Endereço (slug)"
          disabled={published}
          hint={published ? 'Não muda depois da primeira publicação.' : `/p/${survey.slug}`}
          error={errors.slug?.message}
          {...register('slug')}
        />
        <TextField label="Introdução" maxLength={500} {...register('introText')} />
        <TextField
          label="Agradecimento"
          maxLength={500}
          error={errors.thankYouMessage?.message}
          {...register('thankYouMessage', {
            validate: (value) =>
              (value.trim().length >= 3 && value.trim().length <= 500) ||
              'O agradecimento deve ter de 3 a 500 caracteres.',
          })}
        />
        <TextField
          label="Pergunta geral (0 a 10)"
          disabled={nps?.locked === true}
          hint={
            nps?.locked === true ? 'Publicada: não pode mudar.' : 'Obrigatória em todas as versões.'
          }
          error={errors.npsQuestionText?.message}
          {...register('npsQuestionText')}
        />
      </div>
      <Button type="submit" disabled={isSubmitting || !isDirty}>
        {isSubmitting ? 'Salvando…' : 'Salvar dados'}
      </Button>
    </form>
  );
}

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
      if (error instanceof ApiError && error.status === 422) setFailure(messageOf(error));
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
function QuestionsSection({
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
      setFailure(messageOf(error));
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

/**
 * TL08 — Configuração de pesquisas (/admin/pesquisas/:id; RF25–RF32): dados, perguntas,
 * publicação de versões imutáveis, histórico, link, QR Code e cartaz.
 */
export function SurveyEditorPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const survey = useSurvey(id);
  const publish = usePublishSurvey(id);
  const toggle = useUpdateSurvey(id);
  const [notice, setNotice] = useState<string | null>(noticeOf(location.state) ?? null);
  const [confirm, setConfirm] = useState<'publish' | 'toggle' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (survey.isPending) return <Loading label="Carregando a pesquisa…" />;
  if (survey.isError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <ErrorState error={survey.error} onRetry={() => void survey.refetch()} />
      </div>
    );
  }
  const data = survey.data;
  const nextVersion = (data.versions[0]?.versionNumber ?? 0) + 1;
  const canPublish = data.isActive && (data.currentVersion === null || data.hasUnpublishedChanges);

  const run = async (action: () => Promise<unknown>, message: string) => {
    setActionError(null);
    try {
      await action();
      setConfirm(null);
      setNotice(message);
    } catch (error) {
      setActionError(messageOf(error).text);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6">
      <div className="space-y-3">
        <Link
          to="/admin/pesquisas"
          className="font-medium text-brand-700 underline-offset-4 hover:underline"
        >
          ← Pesquisas
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusTag status={data.status} />
              {data.hasUnpublishedChanges && data.currentVersion !== null ? (
                <span className="text-sm text-slate-700">Há alterações não publicadas</span>
              ) : null}
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{data.title}</h1>
            <p className="text-slate-700">
              {data.sectorName}
              {data.currentVersion === null
                ? ' · ainda não publicada'
                : ` · versão ${data.currentVersion.versionNumber} vigente`}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                setConfirm('toggle');
              }}
            >
              {data.isActive ? 'Desativar pesquisa' : 'Reativar pesquisa'}
            </Button>
            <Button
              disabled={!canPublish}
              title={
                canPublish
                  ? undefined
                  : data.isActive
                    ? 'Não há alterações desde a última publicação.'
                    : 'Reative a pesquisa para publicar.'
              }
              onClick={() => {
                setConfirm('publish');
              }}
            >
              <Rocket aria-hidden="true" className="size-5" />
              Publicar versão {nextVersion}
            </Button>
          </div>
        </div>
      </div>

      {notice === null ? null : <Alert tone="success">{notice}</Alert>}

      <section
        aria-labelledby="dados"
        className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <h2 id="dados" className="text-lg font-semibold">
          Dados da pesquisa
        </h2>
        <SurveyDataForm survey={data} onSaved={setNotice} />
      </section>

      <section aria-labelledby="perguntas" className="space-y-4">
        <h2 id="perguntas" className="text-lg font-semibold">
          Perguntas específicas
        </h2>
        <QuestionsSection survey={data} onSaved={setNotice} />
      </section>

      <section
        aria-labelledby="link-qr"
        className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <h2 id="link-qr" className="text-lg font-semibold">
          Link e QR Code
        </h2>
        {data.links === null ? (
          <p className="text-slate-700">Publique a pesquisa para gerar o link e o QR Code.</p>
        ) : (
          <SurveyQrPanel
            surveyId={data.id}
            slug={data.slug}
            qrUrl={data.links.qrUrl}
            linkUrl={data.links.linkUrl}
          />
        )}
      </section>

      <section aria-labelledby="versoes" className="space-y-4">
        <h2 id="versoes" className="text-lg font-semibold">
          Histórico de versões
        </h2>
        {data.versions.length === 0 ? (
          <p className="text-slate-700">Nenhuma versão publicada.</p>
        ) : (
          <ul className="space-y-3">
            {data.versions.map((version) => (
              <li key={version.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <details>
                  <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2">
                    <span className="font-semibold">Versão {version.versionNumber}</span>
                    {version.isCurrent ? (
                      <span className="rounded-full border border-green-700 px-2 text-sm text-green-800">
                        Vigente
                      </span>
                    ) : null}
                    <span className="text-sm text-slate-700">
                      Publicada em {formatDateTime(version.publishedAt)} por{' '}
                      {version.publishedBy.fullName}
                      {version.supersededAt === null
                        ? ''
                        : ` · substituída em ${formatDateTime(version.supersededAt)}`}
                    </span>
                  </summary>
                  <div className="mt-3 space-y-2 text-sm">
                    <p>
                      <strong>Título:</strong> {version.title}
                    </p>
                    <p>
                      <strong>Agradecimento:</strong> {version.thankYouMessage}
                    </p>
                    <ol className="list-inside list-decimal space-y-1">
                      {version.questions.map((question) => (
                        <li key={question.id}>
                          {question.text}{' '}
                          <span className="text-slate-700">
                            (
                            {question.type === 'nps'
                              ? 'geral, 0 a 10'
                              : `${question.journeyStageName ?? ''}, 1 a 5`}
                            )
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={confirm === 'publish'}
        title={`Publicar versão ${nextVersion}`}
        confirmLabel="Publicar"
        busy={publish.isPending}
        error={actionError}
        onClose={() => {
          setConfirm(null);
          setActionError(null);
        }}
        onConfirm={() => void run(() => publish.mutateAsync(), `Versão ${nextVersion} publicada.`)}
      >
        A versão fica imutável. Respostas já registradas continuam ligadas à versão em que foram
        dadas; a versão anterior aceita respostas por mais 24 horas.
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === 'toggle'}
        title={data.isActive ? 'Desativar pesquisa' : 'Reativar pesquisa'}
        confirmLabel={data.isActive ? 'Desativar' : 'Reativar'}
        danger={data.isActive}
        busy={toggle.isPending}
        error={actionError}
        onClose={() => {
          setConfirm(null);
          setActionError(null);
        }}
        onConfirm={() =>
          void run(
            () => toggle.mutateAsync({ isActive: !data.isActive }),
            data.isActive ? 'Pesquisa desativada.' : 'Pesquisa reativada.',
          )
        }
      >
        {data.isActive
          ? 'O link e o QR Code deixam de receber respostas. Respostas e indicadores são mantidos.'
          : 'O link e o QR Code voltam a receber respostas na versão vigente.'}
      </ConfirmDialog>
    </div>
  );
}
