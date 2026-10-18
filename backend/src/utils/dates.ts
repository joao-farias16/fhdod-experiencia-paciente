/** Fuso de referência do hospital (Seção 2, RN25). */
export const HOSPITAL_TIME_ZONE = 'America/Sao_Paulo';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** Data local AAAA-MM-DD válida (rejeita 2026-02-30). */
export function isValidLocalDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (match === null) return false;
  const [, year, month, day] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function partsOf(value: string): [number, number, number] {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return [year, month, day];
}

/** Soma dias a uma data local AAAA-MM-DD. */
export function addDays(value: string, days: number): string {
  const [year, month, day] = partsOf(value);
  return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Quantidade de dias do intervalo inclusivo [from, to]. */
export function daysInclusive(from: string, to: string): number {
  const [fy, fm, fd] = partsOf(from);
  const [ty, tm, td] = partsOf(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS) + 1;
}

/** Data local (AAAA-MM-DD) de um instante no fuso informado. */
export function localDateOf(instant: Date, timeZone = HOSPITAL_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Diferença (ms) entre o horário local do fuso e o UTC no instante dado. */
function offsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const local = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return local - Math.floor(instant / 1000) * 1000;
}

/** Instante UTC do início (00:00) da data local no fuso (RN25: instantes armazenados em UTC). */
export function startOfLocalDay(value: string, timeZone = HOSPITAL_TIME_ZONE): Date {
  const [year, month, day] = partsOf(value);
  const guess = Date.UTC(year, month - 1, day);
  let instant = guess - offsetMs(guess, timeZone);
  // Reajuste para fusos com horário de verão (o deslocamento pode mudar no próprio dia).
  instant = guess - offsetMs(instant, timeZone);
  return new Date(instant);
}
