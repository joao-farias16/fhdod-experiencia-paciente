import { Eye, EyeOff, HeartPulse, LogIn } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Field';
import { Loading } from '../../components/ui/States';
import { useAuth } from './auth-context';
import { homePathFor } from './auth-types';

interface LoginForm {
  email: string;
  password: string;
}

/** Destino salvo pela guarda de rota (somente caminhos internos). */
function redirectTarget(state: unknown): string | undefined {
  if (typeof state !== 'object' || state === null || !('from' in state)) return undefined;
  const { from } = state;
  return typeof from === 'string' &&
    from.startsWith('/') &&
    !from.startsWith('//') &&
    from !== '/login'
    ? from
    : undefined;
}

/**
 * TL01 — Login administrativo (/login, RF01). E-mail e senha no Supabase Auth; o perfil vem do E04
 * e define a tela inicial ou a troca obrigatória de senha. Erro sempre genérico.
 */
export function LoginPage() {
  const { state, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [failure, setFailure] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const failureRef = useRef<HTMLDivElement>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ defaultValues: { email: '', password: '' } });

  useEffect(() => {
    if (failure !== null) failureRef.current?.focus();
  }, [failure]);

  if (state.status === 'loading') return <Loading label="Verificando sua sessão…" />;
  if (state.status === 'signedIn') {
    return (
      <Navigate
        to={
          state.me.mustChangePassword
            ? '/trocar-senha'
            : (redirectTarget(location.state) ?? homePathFor(state.me))
        }
        replace
      />
    );
  }

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setFailure(null);
    const result = await signIn(email, password);
    if (!result.ok) {
      setFailure(result.message);
      return;
    }
    const target = result.me.mustChangePassword
      ? '/trocar-senha'
      : (redirectTarget(location.state) ?? homePathFor(result.me));
    void navigate(target, { replace: true });
  });

  const notice = state.status === 'signedOut' ? state.notice : undefined;

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:shadow"
      >
        Pular para o conteúdo
      </a>
      <header className="bg-brand-700 text-white">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-4 sm:px-6">
          <HeartPulse aria-hidden="true" className="size-7" />
          <span className="text-xl font-bold tracking-tight">FHDOD</span>
          <span className="hidden text-sm text-blue-100 sm:inline">Área administrativa</span>
        </div>
      </header>

      <main
        id="conteudo"
        tabIndex={-1}
        className="flex flex-1 items-start justify-center px-4 py-10 sm:py-16"
      >
        <div className="w-full max-w-md space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">Acesso administrativo</h1>
            <p className="text-slate-700">
              Entre com o e-mail e a senha cadastrados pelo superadministrador.
            </p>
          </div>

          {notice === undefined ? null : <Alert tone="info">{notice}</Alert>}
          {failure === null ? null : (
            <div ref={failureRef} tabIndex={-1}>
              <Alert tone="error">{failure}</Alert>
            </div>
          )}

          <form noValidate onSubmit={(event) => void onSubmit(event)} className="space-y-4">
            <TextField
              label="E-mail"
              type="email"
              autoComplete="username"
              inputMode="email"
              error={errors.email?.message}
              {...register('email', {
                required: 'Informe o e-mail.',
                pattern: {
                  value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                  message: 'Informe um e-mail válido.',
                },
              })}
            />
            <div className="space-y-2">
              <TextField
                label="Senha"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                error={errors.password?.message}
                {...register('password', { required: 'Informe a senha.' })}
              />
              <button
                type="button"
                aria-pressed={showPassword}
                onClick={() => {
                  setShowPassword((value) => !value);
                }}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium text-brand-700 hover:bg-brand-50"
              >
                {showPassword ? (
                  <EyeOff aria-hidden="true" className="size-4" />
                ) : (
                  <Eye aria-hidden="true" className="size-4" />
                )}
                {showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              </button>
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              <LogIn aria-hidden="true" className="size-5" />
              {isSubmitting ? 'Entrando…' : 'Entrar'}
            </Button>
          </form>

          <p className="text-sm text-slate-700">
            Esqueceu a senha? Procure o superadministrador, que pode gerar uma senha temporária.
          </p>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <p className="mx-auto max-w-5xl px-4 py-4 text-sm text-slate-700 sm:px-6">
          Ambiente acadêmico — somente dados fictícios. Projeto da ETE Monteiro Lobato (CIMOL) para
          a Fundação Hospitalar Dr. Oswaldo Diesel.
        </p>
      </footer>
    </div>
  );
}
