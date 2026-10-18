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
