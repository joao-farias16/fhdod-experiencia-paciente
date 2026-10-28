import { CalendarPlus, Upload } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { SelectField, TextField } from '../../components/ui/Field';
import { EmptyState, ErrorState, Loading } from '../../components/ui/States';
import { addDays, daysInclusive, formatLocalDate, localDateOf } from '../../lib/format';
import { useMe } from '../auth/auth-context';
import { can } from '../auth/auth-types';
import { useSectors } from '../users/users-api';
import {
  PERIOD_LABELS,
  type Shift,
  type ShiftInput,
  type ShiftPeriod,
  type ShiftsFilters,
  useCancelShift,
  useCreateShift,
  useShifts,
  useTeams,
} from './structure-api';
import { applyApiError, type Failure } from './form-errors';

/** RF20: intervalo de até 62 dias. */
const MAX_RANGE_DAYS = 62;

function ShiftFormDialog({
  sectorId,
  onClose,
  onCreated,
}: {
  sectorId: string;
  onClose: () => void;
  onCreated: (shift: Shift) => void;
}) {
  const teams = useTeams(sectorId);
  const createShift = useCreateShift();
  const [failure, setFailure] = useState<Failure | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ShiftInput>({
    defaultValues: {
      teamId: '',
      date: localDateOf(),
      period: 'morning',
      startTime: '07:00',
      endTime: '13:00',
    },
  });
  const submit = handleSubmit(async (values) => {
    setFailure(null);
    try {
      onCreated(await createShift.mutateAsync(values));
    } catch (error) {
      setFailure(
        applyApiError(error, ['teamId', 'date', 'period', 'startTime', 'endTime'], setError),
      );
    }
  });
  const activeTeams = (teams.data ?? []).filter((team) => team.isActive);

  return (
    <Dialog
      open
      title="Novo turno"
      description="Horas no horário de Brasília. Fim menor ou igual ao início termina no dia seguinte."
      onClose={onClose}
    >
      <form noValidate onSubmit={(event) => void submit(event)} className="space-y-4">
        {failure === null ? null : (
          <Alert tone="error" requestId={failure.requestId}>
            {failure.text}
          </Alert>
        )}
        <SelectField
          label="Equipe"
          error={errors.teamId?.message}
          {...register('teamId', { required: 'Escolha a equipe.' })}
        >
          <option value="">Selecione…</option>
          {activeTeams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name} ({team.code})
            </option>
          ))}
        </SelectField>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Data"
            type="date"
            error={errors.date?.message}
            {...register('date', { required: 'Informe a data.' })}
          />
          <SelectField label="Período" error={errors.period?.message} {...register('period')}>
            {(Object.keys(PERIOD_LABELS) as ShiftPeriod[]).map((period) => (
              <option key={period} value={period}>
                {PERIOD_LABELS[period]}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Início"
            type="time"
            error={errors.startTime?.message}
            {...register('startTime', { required: 'Informe a hora de início.' })}
          />
          <TextField
            label="Fim"
            type="time"
            error={errors.endTime?.message}
            {...register('endTime', { required: 'Informe a hora de fim.' })}
          />
        </div>
        <div className="flex flex-wrap justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Salvando…' : 'Cadastrar turno'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function CancelShiftDialog({
  shift,
  onClose,
  onCancelled,
}: {
  shift: Shift;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const cancel = useCancelShift();
  const [failure, setFailure] = useState<Failure | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<{ reason: string }>({ defaultValues: { reason: '' } });
  const submit = handleSubmit(async ({ reason }) => {
    setFailure(null);
    try {
      await cancel.mutateAsync({ id: shift.id, reason: reason.trim() });
      onCancelled();
    } catch (error) {
      setFailure(applyApiError(error, ['reason'], setError));
    }
  });
  return (
    <Dialog
      open
      title="Cancelar turno"
      description={`${shift.team.name}, ${formatLocalDate(shift.date)}, ${shift.startTime}–${shift.endTime}. O cancelamento não pode ser desfeito; avaliações já atribuídas permanecem.`}
      onClose={onClose}
    >
      <form noValidate onSubmit={(event) => void submit(event)} className="space-y-4">
        {failure === null ? null : (
          <Alert tone="error" requestId={failure.requestId}>
            {failure.text}
          </Alert>
        )}
        <TextField
          label="Motivo do cancelamento"
          maxLength={300}
          error={errors.reason?.message}
          {...register('reason', {
            validate: (value) =>
              (value.trim().length >= 5 && value.trim().length <= 300) ||
              'Descreva o motivo com 5 a 300 caracteres.',
          })}
        />
        <div className="flex flex-wrap justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} data-autofocus>
            Voltar
          </Button>
          <Button type="submit" variant="danger" disabled={isSubmitting}>
            {isSubmitting ? 'Aguarde…' : 'Cancelar turno'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * TL06 — Escala e turnos (/admin/turnos; RF19–RF21): escala por dia com filtro de equipe, cadastro
 * manual e cancelamento com motivo. Horários sempre no fuso do hospital (RN25).
 */
export function ShiftsPage() {
  const me = useMe();
  const sectors = useSectors();
  const today = localDateOf();
  const [filters, setFilters] = useState<ShiftsFilters>({
    sectorId: '',
    from: today,
    to: addDays(today, 6),
    teamId: '',
    includeCancelled: false,
  });
  const sectorList = sectors.data ?? [];
  const sectorId = filters.sectorId === '' ? (sectorList[0]?.id ?? '') : filters.sectorId;
  const sector = sectorList.find((item) => item.id === sectorId);
  const rangeValid =
    filters.from !== '' &&
    filters.to !== '' &&
    filters.from <= filters.to &&
    daysInclusive(filters.from, filters.to) <= MAX_RANGE_DAYS;
  const shifts = useShifts({ ...filters, sectorId: rangeValid ? sectorId : '' });
  const teams = useTeams(sectorId === '' ? undefined : sectorId);
  const [dialog, setDialog] = useState<
    { kind: 'create' } | { kind: 'cancel'; shift: Shift } | null
  >(null);
  const [success, setSuccess] = useState<string | null>(null);

  const byDate = new Map<string, Shift[]>();
  for (const shift of shifts.data ?? [])
    byDate.set(shift.date, [...(byDate.get(shift.date) ?? []), shift]);
  const set = (patch: Partial<ShiftsFilters>) => {
    setFilters((current) => ({ ...current, sectorId, ...patch }));
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Escala e turnos</h1>
          <p className="text-slate-700">Turnos por dia, no horário de Brasília.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {can(me, 'rosters:import') ? (
            <Link
              to="/admin/escalas/importar"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-neutral-border bg-white px-4 font-medium hover:bg-slate-100"
            >
              <Upload aria-hidden="true" className="size-5" />
              Importar escala
            </Link>
          ) : null}
          {can(me, 'shifts:create') ? (
            <Button
              disabled={sector?.isActive !== true}
              onClick={() => {
                setSuccess(null);
                setDialog({ kind: 'create' });
              }}
            >
              <CalendarPlus aria-hidden="true" className="size-5" />
              Novo turno
            </Button>
          ) : null}
        </div>
      </div>

      {success === null ? null : <Alert tone="success">{success}</Alert>}

      <form
        role="search"
        aria-label="Filtros da escala"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
        }}
        className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5"
      >
        <SelectField
          label="Setor"
          value={sectorId}
          onChange={(event) => {
            set({ sectorId: event.target.value, teamId: '' });
          }}
        >
          {sectorList.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
              {item.isActive ? '' : ' (desativado)'}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Equipe"
          value={filters.teamId}
          onChange={(event) => {
            set({ teamId: event.target.value });
          }}
        >
          <option value="">Todas</option>
          {(teams.data ?? []).map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </SelectField>
        <TextField
          label="De"
          type="date"
          value={filters.from}
          onChange={(event) => {
            set({ from: event.target.value });
          }}
        />
        <TextField
          label="Até"
          type="date"
          value={filters.to}
          error={
            rangeValid ? undefined : `Escolha um intervalo válido de até ${MAX_RANGE_DAYS} dias.`
          }
          onChange={(event) => {
            set({ to: event.target.value });
          }}
        />
        <label className="flex min-h-11 items-center gap-3 self-end">
          <input
            type="checkbox"
            className="size-5"
            checked={filters.includeCancelled}
            onChange={(event) => {
              set({ includeCancelled: event.target.checked });
            }}
          />
          Mostrar cancelados
        </label>
      </form>

      <section aria-labelledby="escala-titulo" className="space-y-4">
        <h2 id="escala-titulo" className="sr-only">
          Escala do setor
        </h2>
        {sectors.isPending || (rangeValid && sectorId !== '' && shifts.isPending) ? (
          <Loading label="Carregando a escala…" />
        ) : sectors.isError ? (
          <ErrorState error={sectors.error} onRetry={() => void sectors.refetch()} />
        ) : shifts.isError ? (
          <ErrorState error={shifts.error} onRetry={() => void shifts.refetch()} />
        ) : byDate.size === 0 ? (
          <EmptyState title="Nenhum turno no período">
            <p>Cadastre um turno ou importe a escala do setor.</p>
          </EmptyState>
        ) : (
          [...byDate.entries()].map(([date, items]) => (
            <div key={date} className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <h3 className="border-b border-slate-200 px-4 py-2 font-semibold">
                {formatLocalDate(date)}
              </h3>
              <ul className="divide-y divide-slate-200">
                {items.map((shift) => (
                  <li key={shift.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <span className="font-mono">
                      {shift.startTime}–{shift.endTime}
                      {shift.endsNextDay ? ' (dia seguinte)' : ''}
                    </span>
                    <span className="font-medium">{shift.team.name}</span>
                    <span className="text-slate-700">{PERIOD_LABELS[shift.period]}</span>
                    <span className="text-sm text-slate-700">
                      {shift.source === 'import' ? 'Importado' : 'Manual'}
                    </span>
                    {shift.cancelledAt === null ? null : (
                      <span className="text-sm font-medium text-danger-700">
                        Cancelado: {shift.cancelReason}
                      </span>
                    )}
                    {shift.cancelledAt === null && can(me, 'shifts:cancel') ? (
                      <Button
                        variant="ghost"
                        className="ml-auto"
                        aria-label={`Cancelar turno de ${shift.team.name} em ${formatLocalDate(shift.date)} às ${shift.startTime}`}
                        onClick={() => {
                          setSuccess(null);
                          setDialog({ kind: 'cancel', shift });
                        }}
                      >
                        Cancelar
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      {dialog?.kind === 'create' && sectorId !== '' ? (
        <ShiftFormDialog
          sectorId={sectorId}
          onClose={() => {
            setDialog(null);
          }}
          onCreated={(shift) => {
            setDialog(null);
            setSuccess(
              `Turno de ${shift.team.name} em ${formatLocalDate(shift.date)} (${shift.startTime}–${shift.endTime}) cadastrado.`,
            );
          }}
        />
      ) : null}
      {dialog?.kind === 'cancel' ? (
        <CancelShiftDialog
          shift={dialog.shift}
          onClose={() => {
            setDialog(null);
          }}
          onCancelled={() => {
            setDialog(null);
            setSuccess('Turno cancelado.');
          }}
        />
      ) : null}
    </div>
  );
}
