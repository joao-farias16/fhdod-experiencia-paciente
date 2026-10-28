import { KeyRound, Pencil, Power, PowerOff, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useLocation } from 'react-router';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { SelectField, TextField } from '../../components/ui/Field';
import { EmptyState, ErrorState, Loading, Pagination } from '../../components/ui/States';
import { ApiError } from '../../lib/api-client';
import { formatDateTime } from '../../lib/format';
import { noticeOf } from '../../lib/route-state';
import { useMe } from '../auth/auth-context';
import { ROLE_LABELS, type UserRole } from '../auth/auth-types';
import { ConfirmDialog } from './ConfirmDialog';
import { TemporaryPasswordDialog } from './TemporaryPasswordDialog';
import { UserFormDialog } from './UserFormDialog';
import {
  type AdminUser,
  type UserInput,
  type UsersFilters,
  useCreateUser,
  useResetPassword,
  useSectors,
  useUpdateUser,
  useUsers,
} from './users-api';

const PAGE_SIZE = 20;
const INITIAL_FILTERS: UsersFilters = {
  search: '',
  role: '',
  isActive: '',
  sectorId: '',
  page: 1,
  pageSize: PAGE_SIZE,
};

type Pending =
  | { kind: 'create' }
  | { kind: 'edit'; user: AdminUser }
  | { kind: 'toggle'; user: AdminUser }
  | { kind: 'reset'; user: AdminUser }
  | null;

function scopeText(user: AdminUser): string {
  if (user.allSectors) return 'Todos os setores';
  if (user.sectors.length === 0) return 'Nenhum setor';
  return user.sectors
    .map((sector) => `${sector.name}${sector.isActive ? '' : ' (desativado)'}`)
    .join(', ');
}

function messageOf(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : 'Não foi possível concluir a ação. Tente novamente.';
}

/** TL16 — Gestão de usuários (/admin/usuarios, SA): cadastro, edição, desativação e senha. */
export function UsersPage() {
  const me = useMe();
  const location = useLocation();
  const [filters, setFilters] = useState<UsersFilters>(INITIAL_FILTERS);
  const [pending, setPending] = useState<Pending>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(noticeOf(location.state) ?? null);
  const [temporary, setTemporary] = useState<{ password: string; userName: string } | null>(null);

  const users = useUsers(filters);
  const sectors = useSectors();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const resetPassword = useResetPassword();

  const filterForm = useForm<Omit<UsersFilters, 'page' | 'pageSize'>>({
    defaultValues: INITIAL_FILTERS,
  });
  const applyFilters = filterForm.handleSubmit((values) => {
    setFilters({ ...values, search: values.search.trim(), page: 1, pageSize: PAGE_SIZE });
  });

  const close = () => {
    setPending(null);
    setActionError(null);
  };

  const submitForm = async (input: UserInput) => {
    setSuccess(null);
    if (pending?.kind === 'edit') {
      await updateUser.mutateAsync({ id: pending.user.id, input });
      setSuccess(`Dados de ${input.fullName ?? pending.user.fullName} atualizados.`);
    } else {
      const result = await createUser.mutateAsync(input);
      setTemporary({ password: result.temporaryPassword, userName: result.user.fullName });
      setSuccess(`Usuário ${result.user.fullName} cadastrado.`);
    }
    setPending(null);
  };

  const confirmToggle = async (user: AdminUser) => {
    setActionError(null);
    try {
      await updateUser.mutateAsync({ id: user.id, input: { isActive: !user.isActive } });
      setSuccess(
        user.isActive
          ? `Usuário ${user.fullName} desativado.`
          : `Usuário ${user.fullName} reativado.`,
      );
      setPending(null);
    } catch (error) {
      setActionError(messageOf(error));
    }
  };

  const confirmReset = async (user: AdminUser) => {
    setActionError(null);
    try {
      const result = await resetPassword.mutateAsync(user.id);
      setPending(null);
      setTemporary({ password: result.temporaryPassword, userName: user.fullName });
      setSuccess(
        `Senha de ${user.fullName} redefinida. A troca será obrigatória no próximo acesso.`,
      );
    } catch (error) {
      setActionError(messageOf(error));
    }
  };

  const list = users.data?.data ?? [];
  const meta = users.data?.meta;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Gestão de usuários</h1>
          <p className="text-slate-700">
            Contas administrativas, perfis, escopo de setores e senhas temporárias.
          </p>
        </div>
        <Button
          onClick={() => {
            setSuccess(null);
            setPending({ kind: 'create' });
          }}
        >
          <UserPlus aria-hidden="true" className="size-5" />
          Novo usuário
        </Button>
      </div>

      {success === null ? null : <Alert tone="success">{success}</Alert>}

      <form
        role="search"
        aria-label="Filtros de usuários"
        noValidate
        onSubmit={(event) => void applyFilters(event)}
        className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5"
      >
        <TextField
          label="Buscar por nome ou e-mail"
          maxLength={120}
          {...filterForm.register('search')}
        />
        <SelectField label="Perfil" {...filterForm.register('role')}>
          <option value="">Todos</option>
          {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </SelectField>
        <SelectField label="Situação" {...filterForm.register('isActive')}>
          <option value="">Todas</option>
          <option value="true">Ativos</option>
          <option value="false">Desativados</option>
        </SelectField>
        <SelectField label="Setor" {...filterForm.register('sectorId')}>
          <option value="">Todos</option>
          {(sectors.data ?? []).map((sector) => (
            <option key={sector.id} value={sector.id}>
              {sector.name}
            </option>
          ))}
        </SelectField>
        <div className="flex items-end gap-2">
          <Button type="submit">Filtrar</Button>
          <Button
            variant="secondary"
            onClick={() => {
              filterForm.reset(INITIAL_FILTERS);
              setFilters(INITIAL_FILTERS);
            }}
          >
            Limpar
          </Button>
        </div>
      </form>

      <section aria-labelledby="lista-usuarios" className="space-y-4">
        <h2 id="lista-usuarios" className="sr-only">
          Lista de usuários
        </h2>
        {users.isPending ? (
          <Loading label="Carregando usuários…" />
        ) : users.isError ? (
          <ErrorState error={users.error} onRetry={() => void users.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState title="Nenhum usuário encontrado">
            <p>Ajuste os filtros ou cadastre um novo usuário.</p>
          </EmptyState>
        ) : (
          <div
            className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm"
            tabIndex={0}
            role="region"
            aria-label="Tabela de usuários"
          >
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-100 text-slate-800">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Nome
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Perfil
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Escopo
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Situação
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {list.map((user) => {
                  const isSelf = user.id === me.id;
                  return (
                    <tr key={user.id} className="align-top">
                      <td className="px-4 py-3">
                        <span className="block font-medium text-slate-900">
                          {user.fullName}
                          {isSelf ? ' (você)' : ''}
                        </span>
                        <span className="text-slate-700">{user.email}</span>
                      </td>
                      <td className="px-4 py-3">{ROLE_LABELS[user.role]}</td>
                      <td className="px-4 py-3">{scopeText(user)}</td>
                      <td className="px-4 py-3">
                        <span className="block font-medium">
                          {user.isActive ? 'Ativo' : 'Desativado'}
                        </span>
                        {user.deactivatedAt === null ? null : (
                          <span className="block text-slate-700">
                            desde {formatDateTime(user.deactivatedAt)}
                          </span>
                        )}
                        {user.mustChangePassword ? (
                          <span className="block text-slate-700">Troca de senha pendente</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="ghost"
                            aria-label={`Editar ${user.fullName}`}
                            onClick={() => {
                              setSuccess(null);
                              setPending({ kind: 'edit', user });
                            }}
                          >
                            <Pencil aria-hidden="true" className="size-4" />
                            Editar
                          </Button>
                          {isSelf ? null : (
                            <>
                              <Button
                                variant="ghost"
                                aria-label={`Redefinir senha de ${user.fullName}`}
                                disabled={!user.isActive}
                                title={
                                  user.isActive
                                    ? undefined
                                    : 'Reative o usuário antes de redefinir a senha.'
                                }
                                onClick={() => {
                                  setSuccess(null);
                                  setPending({ kind: 'reset', user });
                                }}
                              >
                                <KeyRound aria-hidden="true" className="size-4" />
                                Redefinir senha
                              </Button>
                              <Button
                                variant="ghost"
                                aria-label={`${user.isActive ? 'Desativar' : 'Reativar'} ${user.fullName}`}
                                onClick={() => {
                                  setSuccess(null);
                                  setPending({ kind: 'toggle', user });
                                }}
                              >
                                {user.isActive ? (
                                  <PowerOff aria-hidden="true" className="size-4" />
                                ) : (
                                  <Power aria-hidden="true" className="size-4" />
                                )}
                                {user.isActive ? 'Desativar' : 'Reativar'}
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {meta === undefined || list.length === 0 ? null : (
          <Pagination
            page={meta.page}
            pageSize={meta.pageSize}
            total={meta.total}
            onPageChange={(page) => {
              setFilters((current) => ({ ...current, page }));
            }}
          />
        )}
      </section>

      {pending?.kind === 'create' || pending?.kind === 'edit' ? (
        <UserFormDialog
          open
          user={pending.kind === 'edit' ? pending.user : undefined}
          isSelf={pending.kind === 'edit' && pending.user.id === me.id}
          onClose={close}
          onSubmit={submitForm}
        />
      ) : null}

      <ConfirmDialog
        open={pending?.kind === 'toggle'}
        title={
          pending?.kind === 'toggle' && pending.user.isActive
            ? 'Desativar usuário'
            : 'Reativar usuário'
        }
        confirmLabel={
          pending?.kind === 'toggle' && pending.user.isActive ? 'Desativar' : 'Reativar'
        }
        danger={pending?.kind === 'toggle' && pending.user.isActive}
        busy={updateUser.isPending}
        error={actionError}
        onClose={close}
        onConfirm={() => {
          if (pending?.kind === 'toggle') void confirmToggle(pending.user);
        }}
      >
        {pending?.kind === 'toggle'
          ? pending.user.isActive
            ? `${pending.user.fullName} perderá o acesso imediatamente, inclusive nas sessões abertas. O histórico é mantido.`
            : `${pending.user.fullName} poderá entrar novamente com a senha atual.`
          : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={pending?.kind === 'reset'}
        title="Redefinir senha"
        confirmLabel="Gerar senha temporária"
        busy={resetPassword.isPending}
        error={actionError}
        onClose={close}
        onConfirm={() => {
          if (pending?.kind === 'reset') void confirmReset(pending.user);
        }}
      >
        {pending?.kind === 'reset'
          ? `A senha atual de ${pending.user.fullName} deixará de funcionar e uma senha temporária será gerada.`
          : null}
      </ConfirmDialog>

      <TemporaryPasswordDialog
        password={temporary?.password ?? null}
        userName={temporary?.userName ?? ''}
        onClose={() => {
          setTemporary(null);
        }}
      />
    </div>
  );
}
