import type { ShiftPeriod } from '../../lib/prisma.js';
import { addDays, localDateOf, localDateTimeToInstant, minutesOfDay } from '../../utils/dates.js';

/**
 * Regras de turno comuns ao cadastro manual (RF19) e à importação de escala (RF22, RF23):
 * horas locais convertidas para UTC (RN25), fim menor ou igual ao início indica o dia seguinte e
 * duração de 1 a 24 horas (RN20). As mesmas regras existem no banco (CHECK e EXCLUDE).
 */

export const SHIFT_PERIODS = ['morning', 'afternoon', 'night'] as const satisfies ShiftPeriod[];

/** Turno no CSV (MANHA, TARDE, NOITE) → período do banco. */
export const CSV_PERIODS: Readonly<Record<string, ShiftPeriod>> = {
  MANHA: 'morning',
  TARDE: 'afternoon',
  NOITE: 'night',
};

/** Janela de datas aceitas: de 30 dias antes a 180 dias depois de hoje (Seção 4.3). */
export const SHIFT_DATE_PAST_DAYS = 30;
export const SHIFT_DATE_FUTURE_DAYS = 180;

export const SHIFT_MIN_MINUTES = 60;
export const SHIFT_MAX_MINUTES = 24 * 60;

export function shiftDateWindow(now: Date): { min: string; max: string } {
  const today = localDateOf(now);
  return {
    min: addDays(today, -SHIFT_DATE_PAST_DAYS),
    max: addDays(today, SHIFT_DATE_FUTURE_DAYS),
  };
}

export function isDateInShiftWindow(date: string, now: Date): boolean {
  const { min, max } = shiftDateWindow(now);
  return date >= min && date <= max;
}

export type ShiftWindow = { ok: true; startsAt: Date; endsAt: Date } | { ok: false };

/**
 * Converte data e horas locais em instantes UTC. `hora_fim <= hora_inicio` termina no dia
 * seguinte (19:00–07:00); duração fora de 1 a 24 horas é inválida (RN20).
 */
export function computeShiftWindow(date: string, startTime: string, endTime: string): ShiftWindow {
  const startsAt = localDateTimeToInstant(date, startTime);
  const endDate = minutesOfDay(endTime) <= minutesOfDay(startTime) ? addDays(date, 1) : date;
  const endsAt = localDateTimeToInstant(endDate, endTime);
  const minutes = (endsAt.getTime() - startsAt.getTime()) / 60_000;
  if (minutes < SHIFT_MIN_MINUTES || minutes > SHIFT_MAX_MINUTES) return { ok: false };
  return { ok: true, startsAt, endsAt };
}

/** Intervalos semiabertos [início, fim) se sobrepõem (mesma regra do EXCLUDE do banco). */
export function overlaps(
  a: { startsAt: Date; endsAt: Date },
  b: { startsAt: Date; endsAt: Date },
): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}
