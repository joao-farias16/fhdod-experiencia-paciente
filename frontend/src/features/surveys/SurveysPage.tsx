import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { SelectField, TextField } from '../../components/ui/Field';
import { EmptyState, ErrorState, Loading, Pagination } from '../../components/ui/States';
import { formatDateTime } from '../../lib/format';
import { applyApiError, type Failure } from '../structure/form-errors';
import { slugify } from './slug';
import { useSectors } from '../users/users-api';
import {
  STATUS_LABELS,
  type SurveyCreate,
  type SurveysFilters,
  type SurveyStatus,
  useCreateSurvey,
  useSurveys,
} from './surveys-api';

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function StatusTag({ status }: { status: SurveyStatus }) {
  const style =
    status === 'active'
      ? 'border-green-700 text-green-800'
      : status === 'draft'
        ? 'border-brand-700 text-brand-800'
        : 'border-slate-500 text-slate-700';
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-sm font-medium ${style}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function CreateSurveyDialog({ onClose }: { onClose: () => void }) {
  const sectors = useSectors();
  const create = useCreateSurvey();
  const navigate = useNavigate();
  const [failure, setFailure] = useState<Failure | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    getValues,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<SurveyCreate>({
    defaultValues: { sectorId: '', title: '', slug: '', introText: '', thankYouMessage: '' },
  });
  const submit = handleSubmit(async (values) => {
    setFailure(null);
    try {
      const created = await create.mutateAsync({
        sectorId: values.sectorId,
        title: values.title.trim(),
        slug: values.slug.trim(),
        ...(values.introText?.trim() ? { introText: values.introText.trim() } : {}),
        ...(values.thankYouMessage?.trim()
          ? { thankYouMessage: values.thankYouMessage.trim() }
          : {}),
      });
      void navigate(`/admin/pesquisas/${created.id}`, {
        state: { notice: 'Pesquisa criada em rascunho com a pergunta geral de 0 a 10.' },
      });
    } catch (error) {
      setFailure(
        applyApiError(
          error,
          ['sectorId', 'title', 'slug', 'introText', 'thankYouMessage'],
          setError,
          'slug',
        ),
      );
    }
  });
  const titleField = register('title', {
    validate: (value) =>
      (value.trim().length >= 3 && value.trim().length <= 120) ||
      'O título deve ter de 3 a 120 caracteres.',
  });

  return (
    <Dialog
      open
      size="lg"
      title="Nova pesquisa"
      description="A pesquisa nasce em rascunho, com a pergunta geral de 0 a 10. O link só funciona depois de publicar."
      onClose={onClose}
    >
      <form noValidate onSubmit={(event) => void submit(event)} className="space-y-4">
        {failure === null ? null : (
          <Alert tone="error" requestId={failure.requestId}>
            {failure.text}
          </Alert>
        )}
        <SelectField
          label="Setor"
          error={errors.sectorId?.message}
          {...register('sectorId', { required: 'Escolha o setor.' })}
        >
          <option value="">Selecione…</option>
          {(sectors.data ?? [])
            .filter((sector) => sector.isActive)
            .map((sector) => (
              <option key={sector.id} value={sector.id}>
                {sector.name}
              </option>
            ))}
        </SelectField>
        <TextField
          label="Título"
          error={errors.title?.message}
          {...titleField}
          onChange={(event) => {
            void titleField.onChange(event);
            if (dirtyFields.slug !== true) setValue('slug', slugify(getValues('title')));
          }}
        />
        <TextField
          label="Endereço (slug)"
          hint="Letras minúsculas, números e hífens. Não muda depois da primeira publicação."
          error={errors.slug?.message}
          {...register('slug', {
            validate: (value) =>
              (SLUG_PATTERN.test(value.trim()) && value.trim().length <= 80) ||
              'Use letras minúsculas, números e hífens (exemplo: pronto-atendimento).',
          })}
        />
        <TextField label="Introdução (opcional)" maxLength={500} {...register('introText')} />
        <TextField
          label="Agradecimento (opcional)"
          hint="Exibido depois do envio. Em branco, usa o texto padrão."
          maxLength={500}
          {...register('thankYouMessage')}
        />
        <div className="flex flex-wrap justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Criando…' : 'Criar rascunho'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

const INITIAL: SurveysFilters = { sectorId: '', status: '', search: '', page: 1, pageSize: 20 };

/** TL08 — lista de pesquisas (/admin/pesquisas; RF25, RF32), com situação e versão vigente. */
export function SurveysPage() {
  const [filters, setFilters] = useState<SurveysFilters>(INITIAL);
  const [creating, setCreating] = useState(false);
  const surveys = useSurveys(filters);
  const sectors = useSectors();
  const list = surveys.data?.data ?? [];
  const meta = surveys.data?.meta;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pesquisas</h1>
          <p className="text-slate-700">
            Configuração, publicação de versões, link e QR Code por setor.
          </p>
        </div>
        <Button
          onClick={() => {
            setCreating(true);
          }}
        >
          <Plus aria-hidden="true" className="size-5" />
          Nova pesquisa
        </Button>
      </div>

      <form
        role="search"
        aria-label="Filtros de pesquisas"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
        }}
        className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3"
      >
        <SelectField
          label="Setor"
          value={filters.sectorId}
          onChange={(event) => {
            setFilters({ ...filters, sectorId: event.target.value, page: 1 });
          }}
        >
          <option value="">Todos</option>
          {(sectors.data ?? []).map((sector) => (
            <option key={sector.id} value={sector.id}>
              {sector.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Situação"
          value={filters.status}
          onChange={(event) => {
            setFilters({ ...filters, status: event.target.value as SurveyStatus | '', page: 1 });
          }}
        >
          <option value="">Todas</option>
          {(Object.keys(STATUS_LABELS) as SurveyStatus[]).map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Buscar por título ou endereço"
          value={filters.search}
          maxLength={120}
          onChange={(event) => {
            setFilters({ ...filters, search: event.target.value, page: 1 });
          }}
        />
      </form>

      <section aria-labelledby="lista-pesquisas" className="space-y-4">
        <h2 id="lista-pesquisas" className="sr-only">
          Lista de pesquisas
        </h2>
        {surveys.isPending ? (
          <Loading label="Carregando pesquisas…" />
        ) : surveys.isError ? (
          <ErrorState error={surveys.error} onRetry={() => void surveys.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState title="Nenhuma pesquisa encontrada">
            <p>Crie uma pesquisa para um setor do seu escopo.</p>
          </EmptyState>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {list.map((survey) => (
              <li
                key={survey.id}
                className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusTag status={survey.status} />
                  {survey.hasUnpublishedChanges && survey.currentVersion !== null ? (
                    <span className="text-sm text-slate-700">Alterações não publicadas</span>
                  ) : null}
                </div>
                <Link
                  to={`/admin/pesquisas/${survey.id}`}
                  className="block text-lg font-semibold text-brand-700 underline-offset-4 hover:underline"
                >
                  {survey.title}
                </Link>
                <p className="text-sm text-slate-700">
                  {survey.sectorName} · /p/{survey.slug} · {survey.activeSpecificQuestions}{' '}
                  perguntas específicas ativas
                </p>
                <p className="text-sm text-slate-700">
                  {survey.currentVersion === null
                    ? 'Ainda não publicada'
                    : `Versão ${survey.currentVersion.versionNumber} publicada em ${formatDateTime(survey.currentVersion.publishedAt)}`}
                </p>
              </li>
            ))}
          </ul>
        )}
        {meta === undefined || list.length === 0 ? null : (
          <Pagination
            page={meta.page}
            pageSize={meta.pageSize}
            total={meta.total}
            onPageChange={(page) => {
              setFilters({ ...filters, page });
            }}
          />
        )}
      </section>

      {creating ? (
        <CreateSurveyDialog
          onClose={() => {
            setCreating(false);
          }}
        />
      ) : null}
    </div>
  );
}
