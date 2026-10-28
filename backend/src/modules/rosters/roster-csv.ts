import { parse } from 'csv-parse/sync';

import type { ShiftPeriod } from '../../lib/prisma.js';
import { isValidLocalTime, parseBrazilianDate } from '../../utils/dates.js';
import { HttpError } from '../../utils/http-error.js';
import { CSV_PERIODS, computeShiftWindow, isDateInShiftWindow } from '../shifts/shift-rules.js';

/**
 * Leitura e validação do CSV de escala (Seção 4.3, RF22): UTF-8, separador ";", cabeçalho fixo,
 * datas DD/MM/AAAA, turno MANHA/TARDE/NOITE e horas HH:MM. Erros de arquivo interrompem a leitura
 * (400/413/415); os demais são registrados por linha e coluna, sem gravar turnos.
 */

export const ROSTER_HEADER = [
  'setor_codigo',
  'equipe_codigo',
  'data',
  'turno',
  'hora_inicio',
  'hora_fim',
] as const;

export type RosterColumn = (typeof ROSTER_HEADER)[number];

/** RN19: arquivo de até 1 MB e 2.000 linhas de dados. */
export const ROSTER_MAX_BYTES = 1_048_576;
export const ROSTER_MAX_ROWS = 2_000;

export type RosterErrorCode =
  | 'CSV_HEADER_INVALID'
  | 'FIELD_REQUIRED'
  | 'DATE_INVALID'
  | 'DATE_OUT_OF_RANGE'
  | 'TIME_INVALID'
  | 'DURATION_INVALID'
  | 'PERIOD_INVALID'
  | 'SECTOR_NOT_FOUND'
  | 'SECTOR_INACTIVE'
  | 'SECTOR_OUT_OF_SCOPE'
  | 'TEAM_NOT_FOUND'
  | 'TEAM_INACTIVE'
  | 'OVERLAP_IN_FILE'
  | 'OVERLAP_EXISTING';

export interface RosterError {
  /** Linha do arquivo (o cabeçalho é a linha 1). */
  line: number;
  column: RosterColumn | 'cabecalho';
  code: RosterErrorCode;
  message: string;
}

/** Linha de dados já separada em colunas, com o número da linha no arquivo. */
export interface RosterRow {
  line: number;
  values: Record<RosterColumn, string>;
}

export interface ParsedRoster {
  headerValid: boolean;
  headerLine: number;
  rows: RosterRow[];
}

/** Arquivos ZIP (.xlsx, .docx) começam com "PK\x03\x04"; não são texto CSV. */
function looksLikeZip(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.readUInt32BE(0) === 0x504b0304;
}

/** Tipo do arquivo: extensão .csv e conteúdo de texto (415 UNSUPPORTED_FILE_TYPE). */
export function assertCsvFile(fileName: string, buffer: Buffer): void {
  if (!/\.csv$/i.test(fileName) || looksLikeZip(buffer) || buffer.includes(0)) {
    throw new HttpError(
      415,
      'UNSUPPORTED_FILE_TYPE',
      'Envie um arquivo CSV (.csv) no modelo da escala.',
    );
  }
}

function fileError(code: 'EMPTY_FILE' | 'TOO_MANY_ROWS' | 'ENCODING_INVALID', message: string) {
  return new HttpError(400, code, message);
}

/** Decodifica UTF-8 estrito (com ou sem BOM); bytes inválidos → 400 ENCODING_INVALID. */
function decodeUtf8(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(buffer);
  } catch {
    throw fileError(
      'ENCODING_INVALID',
      'O arquivo precisa estar em UTF-8. Salve-o como "CSV UTF-8".',
    );
  }
}

interface CsvRecord {
  record: string[];
  info: { lines: number };
}

/** Separa o CSV em linhas e colunas e confere cabeçalho, arquivo vazio e limite de linhas. */
export function parseRosterCsv(buffer: Buffer): ParsedRoster {
  const text = decodeUtf8(buffer);
  let records: CsvRecord[];
  try {
    records = parse(text, {
      delimiter: ';',
      bom: true,
      trim: true,
      skip_empty_lines: true,
      relax_column_count: true,
      info: true,
    }) as unknown as CsvRecord[];
  } catch {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Não foi possível ler o CSV.', [
      { field: 'file', message: 'Confira as aspas e o separador ";" do arquivo.' },
    ]);
  }
  const [header, ...data] = records;
  if (header === undefined || data.length === 0) {
    throw fileError('EMPTY_FILE', 'O arquivo não tem linhas de turnos abaixo do cabeçalho.');
  }
  if (data.length > ROSTER_MAX_ROWS) {
    throw fileError(
      'TOO_MANY_ROWS',
      `O arquivo tem ${data.length} linhas de turnos; o limite é ${ROSTER_MAX_ROWS}.`,
    );
  }
  const headerValid =
    header.record.length === ROSTER_HEADER.length &&
    header.record.every((value, index) => value.toLowerCase() === ROSTER_HEADER[index]);
  return {
    headerValid,
    headerLine: header.info.lines,
    rows: data.map(({ record, info }) => ({
      line: info.lines,
      values: Object.fromEntries(
        ROSTER_HEADER.map((column, index) => [column, record[index] ?? '']),
      ) as Record<RosterColumn, string>,
    })),
  };
}

/** Linha válida pronta para virar turno (staged_rows de shift_imports). */
export interface StagedShift {
  line: number;
  sectorId: string;
  teamId: string;
  period: ShiftPeriod;
  startsAt: string;
  endsAt: string;
}

export interface RosterReference {
  /** Setores do hospital por código. */
  sectors: ReadonlyMap<string, { id: string; isActive: boolean; inScope: boolean }>;
  /** Equipes por "<sectorId>:<código>". */
  teams: ReadonlyMap<string, { id: string; isActive: boolean }>;
}

const MESSAGES: Record<RosterErrorCode, string> = {
  CSV_HEADER_INVALID: `Use o cabeçalho ${ROSTER_HEADER.join(';')}.`,
  FIELD_REQUIRED: 'Preencha esta coluna.',
  DATE_INVALID: 'Use uma data válida no formato DD/MM/AAAA.',
  DATE_OUT_OF_RANGE: 'A data deve estar entre 30 dias antes e 180 dias depois de hoje.',
  TIME_INVALID: 'Use uma hora válida no formato HH:MM.',
  DURATION_INVALID: 'O turno deve durar de 1 a 24 horas.',
  PERIOD_INVALID: 'Use MANHA, TARDE ou NOITE.',
  SECTOR_NOT_FOUND: 'Setor não encontrado.',
  SECTOR_INACTIVE: 'O setor está desativado.',
  SECTOR_OUT_OF_SCOPE: 'O setor está fora do seu escopo de acesso.',
  TEAM_NOT_FOUND: 'Equipe não encontrada neste setor.',
  TEAM_INACTIVE: 'A equipe está desativada.',
  OVERLAP_IN_FILE: 'Sobrepõe outro turno da mesma equipe neste arquivo.',
  OVERLAP_EXISTING: 'Sobrepõe um turno já cadastrado da mesma equipe.',
};

export function rosterError(
  line: number,
  column: RosterError['column'],
  code: RosterErrorCode,
  message = MESSAGES[code],
): RosterError {
  return { line, column, code, message };
}

/**
 * Valida cada linha de forma independente (setor, equipe, data, turno, horas e duração) e devolve
 * os erros e as linhas aceitas. As sobreposições são verificadas depois, com todas as linhas.
 */
export function validateRosterRows(
  rows: readonly RosterRow[],
  reference: RosterReference,
  now: Date,
): { errors: RosterError[]; staged: StagedShift[] } {
  const errors: RosterError[] = [];
  const staged: StagedShift[] = [];

  for (const { line, values } of rows) {
    const rowErrors: RosterError[] = [];
    const add = (column: RosterColumn, code: RosterErrorCode) => {
      rowErrors.push(rosterError(line, column, code));
    };
    for (const column of ROSTER_HEADER) {
      if (values[column] === '') add(column, 'FIELD_REQUIRED');
    }

    let sectorId: string | undefined;
    const sector = reference.sectors.get(values.setor_codigo);
    if (values.setor_codigo !== '') {
      if (sector === undefined) add('setor_codigo', 'SECTOR_NOT_FOUND');
      else if (!sector.inScope) add('setor_codigo', 'SECTOR_OUT_OF_SCOPE');
      else if (!sector.isActive) add('setor_codigo', 'SECTOR_INACTIVE');
      else sectorId = sector.id;
    }

    let teamId: string | undefined;
    if (sectorId !== undefined && values.equipe_codigo !== '') {
      const team = reference.teams.get(`${sectorId}:${values.equipe_codigo}`);
      if (team === undefined) add('equipe_codigo', 'TEAM_NOT_FOUND');
      else if (!team.isActive) add('equipe_codigo', 'TEAM_INACTIVE');
      else teamId = team.id;
    }

    let date: string | undefined;
    if (values.data !== '') {
      date = parseBrazilianDate(values.data);
      if (date === undefined) add('data', 'DATE_INVALID');
      else if (!isDateInShiftWindow(date, now)) {
        add('data', 'DATE_OUT_OF_RANGE');
        date = undefined;
      }
    }

    const period = CSV_PERIODS[values.turno.toUpperCase()];
    if (values.turno !== '' && period === undefined) add('turno', 'PERIOD_INVALID');

    const timesValid = (['hora_inicio', 'hora_fim'] as const).every((column) => {
      if (values[column] === '') return false;
      if (isValidLocalTime(values[column])) return true;
      add(column, 'TIME_INVALID');
      return false;
    });

    let window: ReturnType<typeof computeShiftWindow> | undefined;
    if (date !== undefined && timesValid) {
      window = computeShiftWindow(date, values.hora_inicio, values.hora_fim);
      if (!window.ok) add('hora_fim', 'DURATION_INVALID');
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
    } else if (
      sectorId !== undefined &&
      teamId !== undefined &&
      period !== undefined &&
      window?.ok === true
    ) {
      staged.push({
        line,
        sectorId,
        teamId,
        period,
        startsAt: window.startsAt.toISOString(),
        endsAt: window.endsAt.toISOString(),
      });
    }
  }
  return { errors, staged };
}

/** RN20: turnos da mesma equipe no próprio arquivo não podem se sobrepor (OVERLAP_IN_FILE). */
export function findOverlapsInFile(staged: readonly StagedShift[]): RosterError[] {
  const errors: RosterError[] = [];
  const byTeam = new Map<string, StagedShift[]>();
  for (const row of staged) byTeam.set(row.teamId, [...(byTeam.get(row.teamId) ?? []), row]);
  for (const rows of byTeam.values()) {
    const sorted = [...rows].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    for (let i = 0; i < sorted.length; i += 1) {
      const current = sorted[i];
      if (current === undefined) continue;
      for (let j = i + 1; j < sorted.length; j += 1) {
        const next = sorted[j];
        if (next === undefined || next.startsAt >= current.endsAt) break;
        errors.push(
          rosterError(
            next.line,
            'hora_inicio',
            'OVERLAP_IN_FILE',
            `Sobrepõe o turno da linha ${current.line} da mesma equipe.`,
          ),
          rosterError(
            current.line,
            'hora_inicio',
            'OVERLAP_IN_FILE',
            `Sobrepõe o turno da linha ${next.line} da mesma equipe.`,
          ),
        );
      }
    }
  }
  return errors;
}
