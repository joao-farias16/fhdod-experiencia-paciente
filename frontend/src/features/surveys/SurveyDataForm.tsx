import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { SelectField, TextField } from '../../components/ui/Field';
import { applyApiError, type Failure } from '../../lib/errors';
import { useSectors } from '../sectors/sectors-api';
import { type SurveyDetail, type SurveyPatch, useUpdateSurvey } from './surveys-api';

interface DataForm {
  title: string;
  slug: string;
  sectorId: string;
  introText: string;
  thankYouMessage: string;
  npsQuestionText: string;
}

/** Dados da pesquisa (RF26): setor, endereço e pergunta geral bloqueados após publicar. */
export function SurveyDataForm({
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
