/** Fuso de referência do hospital (Seção 2, RNF29). */
export const HOSPITAL_TIME_ZONE = 'America/Sao_Paulo';

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: HOSPITAL_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Formata um instante ISO 8601 UTC como dd/mm/aaaa hh:mm no fuso do hospital. */
export function formatDateTime(isoInstant: string): string {
  const date = new Date(isoInstant);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Instante inválido: ${isoInstant}`);
  }
  return dateTimeFormatter.format(date).replace(',', '');
}

const localDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: HOSPITAL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Data local (AAAA-MM-DD) de um instante no fuso do hospital; padrão: agora. */
export function localDateOf(instant: Date = new Date()): string {
  return localDateFormatter.format(instant);
}

/** Soma dias a uma data AAAA-MM-DD. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Quantidade de dias do intervalo inclusivo [from, to] (datas AAAA-MM-DD). */
export function daysInclusive(from: string, to: string): number {
  return (
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
  );
}

/** Converte AAAA-MM-DD em dd/mm/aaaa (RNF29). */
export function formatLocalDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) throw new RangeError(`Data inválida: ${date}`);
  return `${match[3] ?? ''}/${match[2] ?? ''}/${match[1] ?? ''}`;
}

/** Monta a query string ignorando valores vazios. */
export function toQueryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}
