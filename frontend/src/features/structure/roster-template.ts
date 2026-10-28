import { addDays, localDateOf } from '../../lib/format';

export const ROSTER_HEADER = 'setor_codigo;equipe_codigo;data;turno;hora_inicio;hora_fim';

/** Modelo do CSV (Seção 4.3) com duas linhas fictícias de exemplo, inclusive um turno noturno. */
export function rosterTemplate(today = localDateOf()): string {
  const [year, month, day] = addDays(today, 1).split('-');
  const date = `${day ?? ''}/${month ?? ''}/${year ?? ''}`;
  return `${ROSTER_HEADER}\nPA;EQUIPE-A;${date};MANHA;07:00;19:00\nPA;EQUIPE-B;${date};NOITE;19:00;07:00\n`;
}
