import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { SelectField, TextField } from '../../components/ui/Field';
import { Loading } from '../../components/ui/States';
import { ApiError } from '../../lib/api-client';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type UserRole } from '../auth/auth-types';
import { type AdminSector, type AdminUser, type UserInput, useSectors } from './users-api';

interface UserForm {
  fullName: string;
  email: string;
  role: UserRole | '';
  scope: 'all' | 'sectors';
  sectorIds: string[];
}

/** Montado a cada abertura (o formulário começa sempre dos valores do usuário). */
interface UserFormDialogProps {
  open: boolean;
  /** Usuário em edição; ausente → cadastro (E07). */
  user?: AdminUser | undefined;
  /** Edição da própria conta: somente o nome (RN24). */
  isSelf?: boolean;
  onClose: () => void;
  onSubmit: (input: UserInput) => Promise<void>;
}

const ROLES = Object.keys(ROLE_LABELS) as UserRole[];
const FIELD_NAMES = ['fullName', 'email', 'role', 'sectorIds'] as const;

function initialValues(user: AdminUser | undefined): UserForm {
  return {
    fullName: user?.fullName ?? '',
    email: user?.email ?? '',
    role: user?.role ?? '',
    scope: user === undefined || user.allSectors ? 'all' : 'sectors',
    sectorIds: user?.sectors.map((sector) => sector.id) ?? [],
  };
}

/** RN18 no formulário (o backend valida de novo): SA global; AS com setores; demais, um ou outro. */
function scopeOf(values: UserForm): { allSectors: boolean; sectorIds: string[] } {
  if (values.role === 'superadmin') return { allSectors: true, sectorIds: [] };
  if (values.role === 'sector_admin' || values.scope === 'sectors') {
    return { allSectors: false, sectorIds: values.sectorIds };
  }
  return { allSectors: true, sectorIds: [] };
}

/** Diálogo de cadastro e edição de usuário da TL16 (RF06–RF08). */
export function UserFormDialog({
  open,
  user,
  isSelf = false,
  onClose,
  onSubmit,
}: UserFormDialogProps) {
  const editing = user !== undefined;
  const sectors = useSectors();
  const [failure, setFailure] = useState<{ text: string; requestId?: string | undefined } | null>(
    null,
  );
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<UserForm>({ defaultValues: initialValues(user) });

  const role = useWatch({ control, name: 'role' });
  const scope = useWatch({ control, name: 'scope' });
  const needsSectors =
    role === 'sector_admin' || (role !== 'superadmin' && role !== '' && scope === 'sectors');
  const chooseScope = role !== '' && role !== 'superadmin' && role !== 'sector_admin';

  // Setores ativos e, na edição, os já associados que foram desativados depois (podem ser mantidos).
  const options: AdminSector[] = (sectors.data ?? []).filter(
    (sector) =>
      sector.isActive || (user?.sectors.some((linked) => linked.id === sector.id) ?? false),
  );

  const submit = handleSubmit(async (values) => {
    setFailure(null);
    if (needsSectors && values.sectorIds.length === 0) {
      setError('sectorIds', { message: 'Escolha ao menos um setor.' });
      return;
    }
    const input: UserInput = isSelf
      ? { fullName: values.fullName.trim() }
      : {
          fullName: values.fullName.trim(),
          ...(editing ? {} : { email: values.email.trim() }),
          ...(values.role === '' ? {} : { role: values.role }),
          ...scopeOf(values),
        };
    try {
      await onSubmit(input);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setFailure({ text: 'Não foi possível salvar. Tente novamente.' });
        return;
      }
      if (error.status === 409) {
        setError('email', { message: 'Já existe um usuário com este e-mail.' });
        return;
      }
      let mapped = false;
      for (const detail of error.details) {
        const field =
          FIELD_NAMES.find((name) => detail.field === name) ??
          (detail.field === 'allSectors' ? 'sectorIds' : undefined);
        if (field !== undefined) {
          setError(field, { message: detail.message });
          mapped = true;
        }
      }
      if (!mapped || error.status !== 400)
        setFailure({ text: error.message, requestId: error.requestId });
    }
  });

  return (
    <Dialog
      open={open}
      size="lg"
      title={editing ? 'Editar usuário' : 'Novo usuário'}
      description={
        editing
          ? 'O e-mail não pode ser alterado. A mudança de perfil vale a partir da próxima ação do usuário.'
          : 'A conta é criada com uma senha temporária, exibida uma única vez.'
      }
      onClose={onClose}
    >
      <form noValidate onSubmit={(event) => void submit(event)} className="space-y-4">
        {failure === null ? null : (
          <Alert tone="error" requestId={failure.requestId}>
            {failure.text}
          </Alert>
        )}

        <TextField
          label="Nome completo"
          autoComplete="off"
          error={errors.fullName?.message}
          {...register('fullName', {
            required: 'Informe o nome completo.',
            validate: (value) => {
              const length = value.trim().length;
              return (length >= 3 && length <= 120) || 'O nome deve ter de 3 a 120 caracteres.';
            },
          })}
        />

        {editing ? (
          <div>
            <p className="font-medium">E-mail</p>
            <p className="text-slate-700">{user.email}</p>
          </div>
        ) : (
          <TextField
            label="E-mail"
            type="email"
            autoComplete="off"
            error={errors.email?.message}
            {...register('email', {
              required: 'Informe o e-mail.',
              pattern: {
                value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                message: 'Informe um e-mail válido.',
              },
            })}
          />
        )}

        <SelectField
          label="Perfil"
          disabled={isSelf}
          hint={
            isSelf
              ? 'Você não pode alterar o próprio perfil nem o próprio escopo.'
              : role === ''
                ? undefined
                : ROLE_DESCRIPTIONS[role]
          }
          error={errors.role?.message}
          {...register('role', { required: 'Escolha o perfil.' })}
        >
          <option value="">Selecione…</option>
          {ROLES.map((value) => (
            <option key={value} value={value}>
              {ROLE_LABELS[value]}
            </option>
          ))}
        </SelectField>

        {role === 'superadmin' ? (
          <p className="rounded-lg bg-slate-100 p-3 text-slate-800">
            Escopo: todos os setores (sempre global).
          </p>
        ) : null}

        {chooseScope && !isSelf ? (
          <fieldset className="space-y-2">
            <legend className="font-medium">Escopo de setores</legend>
            <label className="flex min-h-11 items-center gap-3">
              <input type="radio" value="all" className="size-5" {...register('scope')} />
              Todos os setores
            </label>
            <label className="flex min-h-11 items-center gap-3">
              <input type="radio" value="sectors" className="size-5" {...register('scope')} />
              Setores específicos
            </label>
          </fieldset>
        ) : null}

        {needsSectors && !isSelf ? (
          <fieldset
            className="space-y-2"
            aria-describedby={errors.sectorIds ? 'erro-setores' : undefined}
          >
            <legend className="font-medium">Setores associados</legend>
            {sectors.isPending ? (
              <Loading label="Carregando setores…" />
            ) : options.length === 0 ? (
              <p className="text-slate-700">Nenhum setor ativo disponível.</p>
            ) : (
              <div className="grid gap-1 sm:grid-cols-2">
                {options.map((sector) => (
                  <label key={sector.id} className="flex min-h-11 items-center gap-3">
                    <input
                      type="checkbox"
                      value={sector.id}
                      className="size-5"
                      {...register('sectorIds')}
                    />
                    <span>
                      {sector.name}
                      {sector.isActive ? '' : ' (desativado)'}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {errors.sectorIds?.message === undefined ? null : (
              <p id="erro-setores" className="text-sm font-medium text-danger-700">
                {errors.sectorIds.message}
              </p>
            )}
          </fieldset>
        ) : null}

        <div className="flex flex-wrap justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Salvando…' : editing ? 'Salvar alterações' : 'Cadastrar usuário'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
