import { Pencil, Plus, Power, PowerOff } from 'lucide-react';
import { useState } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { SelectField } from '../../components/ui/Field';
import { EmptyState, ErrorState, Loading } from '../../components/ui/States';
import { ApiError } from '../../lib/api-client';
import { useMe } from '../auth/auth-context';
import { can } from '../auth/auth-types';
import { ConfirmDialog } from '../users/ConfirmDialog';
import { useSectors } from '../users/users-api';
import {
  type AdminSector,
  type Team,
  useCreateSector,
  useCreateTeam,
  useTeams,
  useUpdateSector,
  useUpdateTeam,
} from './structure-api';
import { SectorFormDialog, TeamFormDialog } from './StructureDialogs';

type Pending =
  | { kind: 'sector'; sector?: AdminSector }
  | { kind: 'toggle-sector'; sector: AdminSector }
  | { kind: 'team'; team?: Team }
  | { kind: 'toggle-team'; team: Team }
  | null;

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-sm font-medium ${active ? 'border-green-700 text-green-800' : 'border-slate-500 text-slate-700'}`}
    >
      {active ? 'Ativo' : 'Desativado'}
    </span>
  );
}

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Não foi possível concluir a ação.';
}

/**
 * TL05 — Cadastro de setores e equipes (/admin/setores; RF12–RF18). O SA cadastra e altera
 * setores; SA e AS cadastram e alteram equipes dos setores do próprio escopo. Desativações são
 * lógicas e o histórico permanece (RN11).
 */
export function SectorsPage() {
  const me = useMe();
  const canManageSectors = can(me, 'sectors:create');
  const sectors = useSectors();
  const [selectedId, setSelectedId] = useState<string>('');
  const sectorList = sectors.data ?? [];
  const selected = sectorList.find((sector) => sector.id === selectedId) ?? sectorList[0];
  const teams = useTeams(selected?.id);
  const [pending, setPending] = useState<Pending>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const createSector = useCreateSector();
  const updateSector = useUpdateSector();
  const createTeam = useCreateTeam();
  const updateTeam = useUpdateTeam();

  const close = () => {
    setPending(null);
    setActionError(null);
  };

  const toggleSector = async (sector: AdminSector) => {
    try {
      await updateSector.mutateAsync({ id: sector.id, input: { isActive: !sector.isActive } });
      setSuccess(`Setor ${sector.name} ${sector.isActive ? 'desativado' : 'reativado'}.`);
      close();
    } catch (error) {
      setActionError(messageOf(error));
    }
  };

  const toggleTeam = async (team: Team) => {
    try {
      await updateTeam.mutateAsync({ id: team.id, input: { isActive: !team.isActive } });
      setSuccess(`Equipe ${team.name} ${team.isActive ? 'desativada' : 'reativada'}.`);
      close();
    } catch (error) {
      setActionError(messageOf(error));
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Setores e equipes</h1>
          <p className="text-slate-700">
            Estrutura usada nas pesquisas, nas escalas e na atribuição das avaliações.
          </p>
        </div>
        {canManageSectors ? (
          <Button
            onClick={() => {
              setSuccess(null);
              setPending({ kind: 'sector' });
            }}
          >
            <Plus aria-hidden="true" className="size-5" />
            Novo setor
          </Button>
        ) : null}
      </div>

      {success === null ? null : <Alert tone="success">{success}</Alert>}

      <section aria-labelledby="lista-setores" className="space-y-3">
        <h2 id="lista-setores" className="text-lg font-semibold">
          Setores
        </h2>
        {sectors.isPending ? (
          <Loading label="Carregando setores…" />
        ) : sectors.isError ? (
          <ErrorState error={sectors.error} onRetry={() => void sectors.refetch()} />
        ) : sectorList.length === 0 ? (
          <EmptyState title="Nenhum setor no seu escopo">
            {canManageSectors ? <p>Cadastre o primeiro setor.</p> : null}
          </EmptyState>
        ) : (
          <div
            className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm"
            tabIndex={0}
            role="region"
            aria-label="Tabela de setores"
          >
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-slate-100 text-slate-800">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Código
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Nome
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Equipes ativas
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Pesquisas ativas
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
                {sectorList.map((sector) => (
                  <tr key={sector.id} className={sector.id === selected?.id ? 'bg-brand-50' : ''}>
                    <td className="px-4 py-3 font-mono">{sector.code}</td>
                    <td className="px-4 py-3">
                      <span className="block font-medium">{sector.name}</span>
                      {sector.description === null ? null : (
                        <span className="text-slate-700">{sector.description}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{sector.activeTeams}</td>
                    <td className="px-4 py-3">{sector.activeSurveys}</td>
                    <td className="px-4 py-3">
                      <StatusBadge active={sector.isActive} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="ghost"
                          aria-pressed={sector.id === selected?.id}
                          onClick={() => {
                            setSelectedId(sector.id);
                          }}
                        >
                          Ver equipes
                        </Button>
                        {canManageSectors ? (
                          <>
                            <Button
                              variant="ghost"
                              aria-label={`Editar ${sector.name}`}
                              onClick={() => {
                                setSuccess(null);
                                setPending({ kind: 'sector', sector });
                              }}
                            >
                              <Pencil aria-hidden="true" className="size-4" />
                              Editar
                            </Button>
                            <Button
                              variant="ghost"
                              aria-label={`${sector.isActive ? 'Desativar' : 'Reativar'} ${sector.name}`}
                              onClick={() => {
                                setSuccess(null);
                                setPending({ kind: 'toggle-sector', sector });
                              }}
                            >
                              {sector.isActive ? (
                                <PowerOff aria-hidden="true" className="size-4" />
                              ) : (
                                <Power aria-hidden="true" className="size-4" />
                              )}
                              {sector.isActive ? 'Desativar' : 'Reativar'}
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected === undefined ? null : (
        <section aria-labelledby="lista-equipes" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="w-full max-w-sm">
              <SelectField
                label="Equipes do setor"
                value={selected.id}
                onChange={(event) => {
                  setSelectedId(event.target.value);
                }}
              >
                {sectorList.map((sector) => (
                  <option key={sector.id} value={sector.id}>
                    {sector.name}
                    {sector.isActive ? '' : ' (desativado)'}
                  </option>
                ))}
              </SelectField>
            </div>
            <h2 id="lista-equipes" className="sr-only">
              Equipes de {selected.name}
            </h2>
            {can(me, 'teams:create') ? (
              <Button
                disabled={!selected.isActive}
                title={selected.isActive ? undefined : 'Reative o setor para cadastrar equipes.'}
                onClick={() => {
                  setSuccess(null);
                  setPending({ kind: 'team' });
                }}
              >
                <Plus aria-hidden="true" className="size-5" />
                Nova equipe
              </Button>
            ) : null}
          </div>
          {teams.isPending ? (
            <Loading label="Carregando equipes…" />
          ) : teams.isError ? (
            <ErrorState error={teams.error} onRetry={() => void teams.refetch()} />
          ) : teams.data.length === 0 ? (
            <EmptyState title="Nenhuma equipe neste setor">
              <p>Cadastre as equipes para montar a escala.</p>
            </EmptyState>
          ) : (
            <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white shadow-sm">
              {teams.data.map((team) => (
                <li key={team.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="font-mono text-sm">{team.code}</span>
                  <span className="font-medium">{team.name}</span>
                  <StatusBadge active={team.isActive} />
                  {can(me, 'teams:update') ? (
                    <div className="ml-auto flex flex-wrap gap-2">
                      <Button
                        variant="ghost"
                        aria-label={`Editar ${team.name}`}
                        onClick={() => {
                          setSuccess(null);
                          setPending({ kind: 'team', team });
                        }}
                      >
                        <Pencil aria-hidden="true" className="size-4" />
                        Editar
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label={`${team.isActive ? 'Desativar' : 'Reativar'} ${team.name}`}
                        onClick={() => {
                          setSuccess(null);
                          setPending({ kind: 'toggle-team', team });
                        }}
                      >
                        {team.isActive ? 'Desativar' : 'Reativar'}
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {pending?.kind === 'sector' ? (
        <SectorFormDialog
          sector={pending.sector}
          onClose={close}
          onSubmit={async (values) => {
            if (pending.sector === undefined) {
              const created = await createSector.mutateAsync(values);
              setSelectedId(created.id);
              setSuccess(`Setor ${created.name} cadastrado.`);
            } else {
              await updateSector.mutateAsync({
                id: pending.sector.id,
                input: { name: values.name, description: values.description },
              });
              setSuccess(`Setor ${values.name} atualizado.`);
            }
            close();
          }}
        />
      ) : null}

      {pending?.kind === 'team' && selected !== undefined ? (
        <TeamFormDialog
          sectorName={selected.name}
          team={pending.team}
          onClose={close}
          onSubmit={async (values) => {
            if (pending.team === undefined) {
              await createTeam.mutateAsync({ sectorId: selected.id, ...values });
              setSuccess(`Equipe ${values.name} cadastrada.`);
            } else {
              await updateTeam.mutateAsync({ id: pending.team.id, input: { name: values.name } });
              setSuccess(`Equipe ${values.name} atualizada.`);
            }
            close();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={pending?.kind === 'toggle-sector'}
        title={
          pending?.kind === 'toggle-sector' && pending.sector.isActive
            ? 'Desativar setor'
            : 'Reativar setor'
        }
        confirmLabel={
          pending?.kind === 'toggle-sector' && pending.sector.isActive ? 'Desativar' : 'Reativar'
        }
        danger={pending?.kind === 'toggle-sector' && pending.sector.isActive}
        busy={updateSector.isPending}
        error={actionError}
        onClose={close}
        onConfirm={() => {
          if (pending?.kind === 'toggle-sector') void toggleSector(pending.sector);
        }}
      >
        {pending?.kind === 'toggle-sector'
          ? pending.sector.isActive
            ? `As pesquisas de ${pending.sector.name} deixam de receber respostas e não será possível cadastrar turnos ou importar escalas. O histórico é mantido.`
            : `${pending.sector.name} volta a receber respostas, turnos e importações.`
          : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={pending?.kind === 'toggle-team'}
        title={
          pending?.kind === 'toggle-team' && pending.team.isActive
            ? 'Desativar equipe'
            : 'Reativar equipe'
        }
        confirmLabel={
          pending?.kind === 'toggle-team' && pending.team.isActive ? 'Desativar' : 'Reativar'
        }
        danger={pending?.kind === 'toggle-team' && pending.team.isActive}
        busy={updateTeam.isPending}
        error={actionError}
        onClose={close}
        onConfirm={() => {
          if (pending?.kind === 'toggle-team') void toggleTeam(pending.team);
        }}
      >
        {pending?.kind === 'toggle-team'
          ? pending.team.isActive
            ? `${pending.team.name} não receberá novos turnos nem novas atribuições. As atribuições anteriores são mantidas.`
            : `${pending.team.name} volta a receber turnos e atribuições.`
          : null}
      </ConfirmDialog>
    </div>
  );
}
