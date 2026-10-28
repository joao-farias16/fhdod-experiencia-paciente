import type { ComponentType } from 'react';
import type { RouteObject } from 'react-router';

import type * as AdminAreaModule from '../features/admin/admin-area';
import { AppLayout } from '../components/AppLayout';
import { Loading } from '../components/ui/States';
import { HomePage } from '../features/home/HomePage';
import { NotFoundPage } from '../features/not-found/NotFoundPage';

type AdminArea = typeof AdminAreaModule;

/** Carrega um componente da área administrativa (um único pedaço de JavaScript sob demanda). */
function admin(pick: (module: AdminArea) => ComponentType) {
  return async () => {
    const module = await import('../features/admin/admin-area');
    return { Component: pick(module) };
  };
}

/** Rotas da aplicação. As telas TL01–TL17 são adicionadas nas etapas correspondentes. */
export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      {
        // ET06: pesquisa pública (TL09, TL11), em pedaço próprio e sem o cliente do Supabase.
        path: 'p/:slug',
        lazy: async () => ({
          Component: (await import('../features/public-survey/PublicSurveyPage')).PublicSurveyPage,
        }),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    // ET03: autenticação (TL01, TL02) e administração (TL16, TL17).
    lazy: admin((m) => m.AdminRoot),
    hydrateFallbackElement: <Loading label="Carregando a área administrativa…" />,
    children: [
      { path: 'login', lazy: admin((m) => m.LoginPage) },
      {
        lazy: admin((m) => m.ProtectedArea),
        children: [
          {
            lazy: admin((m) => m.AdminShell),
            children: [
              { path: 'trocar-senha', lazy: admin((m) => m.ChangePasswordPage) },
              { path: 'painel', lazy: admin((m) => m.PainelPage) },
              { path: 'admin/usuarios', lazy: admin((m) => m.UsersRoute) },
              { path: 'admin/auditoria', lazy: admin((m) => m.AuditRoute) },
              // ET04: setores e equipes (TL05), escala (TL06) e importação (TL07).
              { path: 'admin/setores', lazy: admin((m) => m.SectorsRoute) },
              { path: 'admin/turnos', lazy: admin((m) => m.ShiftsRoute) },
              { path: 'admin/escalas/importar', lazy: admin((m) => m.RosterImportRoute) },
              // ET05: pesquisas (TL08).
              { path: 'admin/pesquisas', lazy: admin((m) => m.SurveysRoute) },
              { path: 'admin/pesquisas/:id', lazy: admin((m) => m.SurveyEditorRoute) },
            ],
          },
          // Cartaz A4 do QR Code (RF30): sem o layout administrativo, para impressão.
          { path: 'admin/pesquisas/:id/cartaz', lazy: admin((m) => m.SurveyPosterRoute) },
        ],
      },
    ],
  },
];
