import { HeartPulse, KeyRound, LogOut, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';

import { useAuth, useMe } from '../auth/auth-context';
import { can, homePathFor, ROLE_LABELS } from '../auth/auth-types';

/** Itens do menu montados a partir das permissões do E04 (RF05); o backend continua decidindo. */
const NAV_ITEMS = [
  { to: '/painel', label: 'Painel', permission: 'dashboard:read' },
  { to: '/ouvidoria/manifestacoes', label: 'Ouvidoria', permission: 'manifestations:read' },
  { to: '/relatorios', label: 'Relatórios', permission: 'reports:' },
  { to: '/admin/pesquisas', label: 'Pesquisas', permission: 'surveys:read' },
  { to: '/admin/setores', label: 'Setores e equipes', permission: 'teams:create' },
  { to: '/admin/turnos', label: 'Escalas', permission: 'shifts:read' },
  { to: '/admin/usuarios', label: 'Usuários', permission: 'users:read' },
  { to: '/admin/auditoria', label: 'Auditoria', permission: 'audit_logs:read' },
] as const;

/** Layout das telas administrativas: menu por perfil, usuário, Trocar senha, Sair e aviso fictício. */
export function AdminLayout() {
  const me = useMe();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const items = me.mustChangePassword
    ? []
    : NAV_ITEMS.filter((item) =>
        // "reports:" = qualquer permissão de exportação (tipo conforme o perfil, Tabela 13).
        item.permission === 'reports:'
          ? me.permissions.some((permission) => permission.startsWith('reports:'))
          : can(me, item.permission),
      );

  const onSignOut = () => {
    void signOut().then(() => navigate('/login', { replace: true }));
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:shadow"
      >
        Pular para o conteúdo
      </a>
      <header className="bg-brand-700 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            to={homePathFor(me)}
            className="flex min-h-11 items-center gap-2 rounded-md text-white"
          >
            <HeartPulse aria-hidden="true" className="size-7" />
            <span className="text-xl font-bold tracking-tight">FHDOD</span>
          </Link>

          {items.length > 0 ? (
            <button
              type="button"
              aria-expanded={menuOpen}
              aria-controls="menu-administrativo"
              onClick={() => {
                setMenuOpen((open) => !open);
              }}
              className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-lg px-3 hover:bg-brand-800 md:hidden"
            >
              {menuOpen ? (
                <X aria-hidden="true" className="size-5" />
              ) : (
                <Menu aria-hidden="true" className="size-5" />
              )}
              Menu
            </button>
          ) : null}

          <nav
            id="menu-administrativo"
            aria-label="Menu administrativo"
            className={`${menuOpen ? 'flex' : 'hidden'} w-full flex-col gap-1 md:flex md:w-auto md:flex-row md:items-center`}
          >
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => {
                  setMenuOpen(false);
                }}
                className={({ isActive }) =>
                  `inline-flex min-h-11 items-center rounded-lg px-3 font-medium ${isActive ? 'bg-white text-brand-800' : 'text-white hover:bg-brand-800'}`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex w-full flex-wrap items-center gap-2 md:ml-auto md:w-auto">
            <p className="mr-2 text-sm leading-tight">
              <span className="block font-semibold">{me.fullName}</span>
              <span className="text-blue-100">{ROLE_LABELS[me.role]}</span>
            </p>
            {me.mustChangePassword ? null : (
              <Link
                to="/trocar-senha"
                className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium hover:bg-brand-800"
              >
                <KeyRound aria-hidden="true" className="size-4" />
                Trocar senha
              </Link>
            )}
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/60 px-3 text-sm font-medium hover:bg-brand-800"
            >
              <LogOut aria-hidden="true" className="size-4" />
              Sair
            </button>
          </div>
        </div>
      </header>

      <main id="conteudo" tabIndex={-1} className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <p className="mx-auto max-w-6xl px-4 py-4 text-sm text-slate-700 sm:px-6">
          Ambiente acadêmico — somente dados fictícios. Nenhum dado real de pacientes deve ser
          inserido.
        </p>
      </footer>
    </div>
  );
}
