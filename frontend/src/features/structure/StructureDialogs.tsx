import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { TextField } from '../../components/ui/Field';
import { applyApiError, CODE_PATTERN, type Failure } from './form-errors';

interface SectorForm {
  code: string;
  name: string;
  description: string;
}

interface SectorFormDialogProps {
  sector?: { code: string; name: string; description: string | null } | undefined;
  onClose: () => void;
  onSubmit: (values: SectorForm) => Promise<void>;
}

/** Cadastro e edição de setor (RF12, RF14): o código não muda depois de criado. */
export function SectorFormDialog({ sector, onClose, onSubmit }: SectorFormDialogProps) {
  const editing = sector !== undefined;
  const [failure, setFailure] = useState<Failure | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SectorForm>({
    defaultValues: {
      code: sector?.code ?? '',
      name: sector?.name ?? '',
      description: sector?.description ?? '',
    },
  });
  const submit = handleSubmit(async (values) => {
    setFailure(null);
    try {
      await onSubmit({ ...values, code: values.code.trim().toUpperCase() });
    } catch (error) {
      setFailure(applyApiError(error, ['code', 'name', 'description'], setError, 'code'));
    }
  });

  return (
    <Dialog open title={editing ? 'Editar setor' : 'Novo setor'} onClose={onClose}>
      <form noValidate onSubmit={(event) => void submit(event)} className="space-y-4">
        {failure === null ? null : (
          <Alert tone="error" requestId={failure.requestId}>
            {failure.text}
          </Alert>
        )}
        <TextField
          label="Código"
          disabled={editing}
          hint={
            editing
              ? 'O código não pode ser alterado.'
              : 'De 2 a 20 caracteres: letras maiúsculas, números, _ ou -.'
          }
          error={errors.code?.message}
          autoComplete="off"
          {...register('code', {
            validate: (value) =>
              editing ||
              CODE_PATTERN.test(value.trim().toUpperCase()) ||
              'Use de 2 a 20 caracteres: letras maiúsculas, números, _ ou -.',
          })}
        />
        <TextField
          label="Nome"
          error={errors.name?.message}
          autoComplete="off"
          {...register('name', {
            validate: (value) =>
              (value.trim().length >= 2 && value.trim().length <= 120) ||
              'O nome deve ter de 2 a 120 caracteres.',
          })}
        />
        <TextField
          label="Descrição (opcional)"
          maxLength={500}
          error={errors.description?.message}
          {...register('description')}
        />
        <div className="flex flex-wrap justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Salvando…' : editing ? 'Salvar alterações' : 'Cadastrar setor'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

interface TeamForm {
  code: string;
  name: string;
}

interface TeamFormDialogProps {
  sectorName: string;
  team?: { code: string; name: string } | undefined;
  onClose: () => void;
  onSubmit: (values: TeamForm) => Promise<void>;
}

/** Cadastro e edição de equipe (RF16, RF17): equipe sem integrantes; código imutável. */
export function TeamFormDialog({ sectorName, team, onClose, onSubmit }: TeamFormDialogProps) {
  const editing = team !== undefined;
  const [failure, setFailure] = useState<Failure | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<TeamForm>({ defaultValues: { code: team?.code ?? '', name: team?.name ?? '' } });
  const submit = handleSubmit(async (values) => {
    setFailure(null);
    try {
      await onSubmit({ ...values, code: values.code.trim().toUpperCase() });
    } catch (error) {
      setFailure(applyApiError(error, ['code', 'name'], setError, 'code'));
    }
  });

  return (
    <Dialog
      open
      title={editing ? 'Editar equipe' : 'Nova equipe'}
      description={`Setor: ${sectorName}. As equipes não têm integrantes cadastrados.`}
      onClose={onClose}
    >
      <form noValidate onSubmit={(event) => void submit(event)} className="space-y-4">
        {failure === null ? null : (
          <Alert tone="error" requestId={failure.requestId}>
            {failure.text}
          </Alert>
        )}
        <TextField
          label="Código"
          disabled={editing}
          hint={editing ? 'O código não pode ser alterado.' : 'Usado na planilha de escala.'}
          error={errors.code?.message}
          autoComplete="off"
          {...register('code', {
            validate: (value) =>
              editing ||
              CODE_PATTERN.test(value.trim().toUpperCase()) ||
              'Use de 2 a 20 caracteres: letras maiúsculas, números, _ ou -.',
          })}
        />
        <TextField
          label="Nome"
          error={errors.name?.message}
          autoComplete="off"
          {...register('name', {
            validate: (value) =>
              (value.trim().length >= 2 && value.trim().length <= 120) ||
              'O nome deve ter de 2 a 120 caracteres.',
          })}
        />
        <div className="flex flex-wrap justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Salvando…' : editing ? 'Salvar alterações' : 'Cadastrar equipe'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
