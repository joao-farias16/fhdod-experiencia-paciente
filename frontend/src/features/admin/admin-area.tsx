import { Outlet } from 'react-router';

import { AuditPage } from '../audit/AuditPage';
import { AuthProvider } from '../auth/AuthProvider';
import { ChangePasswordPage } from '../auth/ChangePasswordPage';
import { RequireAuth, RequirePermission } from '../auth/guards';
import { LoginPage } from '../auth/LoginPage';
import { UsersPage } from '../users/UsersPage';
import { AdminLayout } from './AdminLayout';
import { PainelPage } from './PainelPage';

/**
 * Área administrativa (TL01, TL02, TL16 e TL17). Carregada sob demanda pelas rotas: o supabase-js e
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

export { ChangePasswordPage, LoginPage, PainelPage };
