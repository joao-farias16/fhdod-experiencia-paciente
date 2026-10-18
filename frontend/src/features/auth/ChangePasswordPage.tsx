import { Circle, CircleCheck, KeyRound, LogOut } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useNavigate } from 'react-router';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Field';
import { ApiError } from '../../lib/api-client';
import { useAuth, useMe } from './auth-context';
import { homePathFor } from './auth-types';
import { isPasswordValid, PASSWORD_RULES } from './password-rules';

interface ChangePasswordForm {
  newPassword: string;
  confirmation: string;
}

function failureMessage(error: unknown): { text: string; requestId?: string | undefined } {
  if (error instanceof ApiError) {
    if (error.status === 429)
      return { text: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' };
    if (error.status === 400)
      return { text: 'A senha não atende às regras. Revise e tente novamente.' };
    if (error.status === 401) return { text: 'Sua sessão terminou. Entre novamente.' };
    return {
      text: 'Não foi possível trocar a senha. Tente novamente.',
      requestId: error.requestId,
    };
  }
  return { text: 'Não foi possível trocar a senha. Tente novamente.' };
}

/**
 * TL02 — Troca obrigatória de senha (/trocar-senha, RF04): nova senha com as regras visíveis e
 * confirmação. Também usada para a troca voluntária. A senha não é guardada pela interface.
 */
export function ChangePasswordPage() {
  const me = useMe();
  const { changePassword, signOut } = useAuth();
  const navigate = useNavigate();
  const mandatory = me.mustChangePassword;
  const [failure, setFailure] = useState<{ text: string; requestId?: string | undefined } | null>(
    null,
  );
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordForm>({ defaultValues: { newPassword: '', confirmation: '' } });
  const newPassword = useWatch({ control, name: 'newPassword' });

  const onSubmit = handleSubmit(async (values) => {
    setFailure(null);
    try {
      await changePassword(values.newPassword);
      reset();
      void navigate(homePathFor({ ...me, mustChangePassword: false }), {
        replace: true,
        state: { notice: 'Senha alterada com sucesso.' },
      });
    } catch (error) {
      setFailure(failureMessage(error));
    }
  });

  return (
    <div className="mx-auto max-w-xl space-y-6 px-4 py-8 sm:px-6">
      <div className="space-y-2">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <KeyRound aria-hidden="true" className="size-6 text-brand-700" />
          {mandatory ? 'Troca obrigatória de senha' : 'Trocar senha'}
        </h1>
        <p className="text-slate-700">
          {mandatory
            ? 'Por segurança, defina uma nova senha antes de continuar. A senha temporária deixa de valer após a troca.'
            : 'Defina uma nova senha para a sua conta.'}
        </p>
      </div>

      {failure === null ? null : (
        <Alert tone="error" requestId={failure.requestId}>
          {failure.text}
        </Alert>
      )}

      <form
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <TextField
          label="Nova senha"
          type="password"
          autoComplete="new-password"
          error={errors.newPassword?.message}
          {...register('newPassword', {
            required: 'Informe a nova senha.',
            validate: (value) =>
              isPasswordValid(value) || 'A senha não atende a todas as regras abaixo.',
          })}
        />

        <div>
          <p id="regras-senha" className="font-medium">
            A senha deve:
          </p>
          <ul aria-describedby="regras-senha" className="mt-2 space-y-1">
            {PASSWORD_RULES.map((rule) => {
              const ok = rule.test(newPassword);
              return (
                <li
                  key={rule.id}
                  className={`flex items-center gap-2 ${ok ? 'text-green-800' : 'text-slate-700'}`}
                >
                  {ok ? (
                    <CircleCheck aria-hidden="true" className="size-4" />
                  ) : (
                    <Circle aria-hidden="true" className="size-4" />
                  )}
                  <span>{rule.label}</span>
                  <span className="sr-only">{ok ? '(atendida)' : '(pendente)'}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <TextField
          label="Confirme a nova senha"
          type="password"
          autoComplete="new-password"
          error={errors.confirmation?.message}
          {...register('confirmation', {
            required: 'Repita a nova senha.',
            validate: (value, values) =>
              value === values.newPassword || 'As senhas não são iguais.',
          })}
        />

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Salvando…' : 'Salvar nova senha'}
          </Button>
          {mandatory ? (
            <Button
              variant="secondary"
              onClick={() => {
                void signOut().then(() => navigate('/login', { replace: true }));
              }}
            >
              <LogOut aria-hidden="true" className="size-4" />
              Sair
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => void navigate(-1)}>
              Cancelar
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
