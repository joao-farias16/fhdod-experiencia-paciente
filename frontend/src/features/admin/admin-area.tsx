import { Outlet } from 'react-router';

import { AuditPage } from '../audit/AuditPage';
import { AuthProvider } from '../auth/AuthProvider';
import { ChangePasswordPage } from '../auth/ChangePasswordPage';
import { RequireAuth, RequirePermission } from '../auth/guards';
import { LoginPage } from '../auth/LoginPage';
import { RosterImportPage } from '../structure/RosterImportPage';
import { SectorsPage } from '../structure/SectorsPage';
import { ShiftsPage } from '../structure/ShiftsPage';
import { SurveyEditorPage } from '../surveys/SurveyEditorPage';
import { SurveyPosterPage } from '../surveys/SurveyPosterPage';
import { SurveysPage } from '../surveys/SurveysPage';
import { UsersPage } from '../users/UsersPage';
import { AdminLayout } from './AdminLayout';
import { PainelPage } from './PainelPage';

/**
 * Área administrativa (TL01, TL02, TL05–TL08, TL16 e TL17). Carregada sob demanda pelas rotas: o supabase-js e
 * a sessão existem somente aqui, nunca na pesquisa pública nem na TV Wall (Seção 7, RF72).
 */
export function AdminRoot() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

export function ProtectedArea() {
  return <RequireAuth />;
}

export function AdminShell() {
  return <AdminLayout />;
}

export function UsersRoute() {
  return (
    <RequirePermission permission="users:read">
      <UsersPage />
    </RequirePermission>
  );
}

export function AuditRoute() {
  return (
    <RequirePermission permission="audit_logs:read">
      <AuditPage />
    </RequirePermission>
  );
}

/** TL05 — setores e equipes (SA; AS para as equipes do próprio escopo). */
export function SectorsRoute() {
  return (
    <RequirePermission permission="teams:create">
      <SectorsPage />
    </RequirePermission>
  );
}

/** TL06 — escala e turnos (SA e AS). */
export function ShiftsRoute() {
  return (
    <RequirePermission permission="shifts:read">
      <ShiftsPage />
    </RequirePermission>
  );
}

/** TL07 — importação de escalas (SA e AS). */
export function RosterImportRoute() {
  return (
    <RequirePermission permission="rosters:import">
      <RosterImportPage />
    </RequirePermission>
  );
}

/** TL08 — pesquisas (SA e AS). */
export function SurveysRoute() {
  return (
    <RequirePermission permission="surveys:read">
      <SurveysPage />
    </RequirePermission>
  );
}

export function SurveyEditorRoute() {
  return (
    <RequirePermission permission="surveys:update">
      <SurveyEditorPage />
    </RequirePermission>
  );
}

export function SurveyPosterRoute() {
  return (
    <RequirePermission permission="surveys:read">
      <SurveyPosterPage />
    </RequirePermission>
  );
}

export { ChangePasswordPage, LoginPage, PainelPage };
