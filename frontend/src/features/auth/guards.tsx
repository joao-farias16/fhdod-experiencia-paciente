import { ShieldX } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router';

import { ErrorState, Loading } from '../../components/ui/States';
import { useAuth, useMe } from './auth-context';
import { can, homePathFor } from './auth-types';

/**
 * Protege as rotas administrativas: sem sessão válida → /login; com troca de senha pendente →
 * /trocar-senha. É conveniência de navegação: o controle de acesso é sempre do backend.
 */
export function RequireAuth() {
  const { state, reload } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') return <Loading label="Verificando sua sessão…" />;
  if (state.status === 'error') {
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <ErrorState error={new Error(state.message)} onRetry={() => void reload()} />
      </div>
    );
  }
  if (state.status === 'signedOut') {
    // Depois de Sair, o destino anterior não é guardado: quem entrar em seguida vai para a própria
    // tela inicial. Sessão expirada ou acesso direto sem login voltam à tela pedida.
    return (
      <Navigate
        to="/login"
        replace
        state={state.explicit === true ? null : { from: `${location.pathname}${location.search}` }}
      />
    );
  }
  if (state.me.mustChangePassword && location.pathname !== '/trocar-senha') {
    return <Navigate to="/trocar-senha" replace />;
  }
  return <Outlet />;
}

export function ForbiddenPage() {
  const me = useMe();
  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-12 sm:px-6">
      <h1 className="flex items-center gap-2 text-2xl font-bold">
        <ShieldX aria-hidden="true" className="size-6 text-danger-700" />
        Acesso não permitido
      </h1>
      <p className="text-slate-700">Seu perfil não tem acesso a esta área.</p>
      <Link
        to={homePathFor(me)}
        className="inline-flex min-h-11 items-center rounded-lg bg-brand-700 px-4 font-medium text-white hover:bg-brand-800"
      >
        Ir para a tela inicial
      </Link>
    </div>
  );
}

/** Mostra a tela somente se o perfil tiver a permissão recebida do E04. */
export function RequirePermission({
  permission,
  children,
}: {
  permission: string;
  children: ReactNode;
}) {
  const me = useMe();
  return can(me, permission) ? children : <ForbiddenPage />;
}
