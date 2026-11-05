import ExcelJS from 'exceljs';

import { localDateOf, localTimeOf } from '../../utils/dates.js';

/**
 * Padronização dos arquivos exportados (RF66): cabeçalho congelado em negrito, células tipadas
 * (número, texto e data; nunca fórmulas), datas dd/mm/aaaa hh:mm no fuso do hospital e vazio
 * tratado (célula em branco; aba sem linhas recebe uma mensagem).
 */
export const DATE_TIME_FORMAT = 'dd/mm/yyyy hh:mm';
export const EMPTY_MESSAGE = 'Nenhum registro encontrado para os filtros aplicados.';
export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type CellValue = string | number | Date | null;

export interface Column {
  header: string;
  width: number;
  /** Formato numérico da coluna (datas e decimais). */
  numFmt?: string;
}

/**
 * Data e hora local como valor de data do Excel: o Excel não guarda fuso, então o horário de
 * America/Sao_Paulo é gravado como está na parede (RNF29).
 */
export function excelDateTime(instant: Date | null): Date | null {
  if (instant === null) return null;
  return new Date(`${localDateOf(instant)}T${localTimeOf(instant)}:00.000Z`);
}

/** Texto nunca começa como fórmula: o ExcelJS grava strings como texto (Seção 10). */
function cell(value: CellValue | boolean | undefined): CellValue {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  return value;
}

export function addTableSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: readonly Column[],
  rows: readonly (readonly (CellValue | boolean | undefined)[])[],
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map((column) => ({
    header: column.header,
    width: column.width,
    ...(column.numFmt === undefined ? {} : { style: { numFmt: column.numFmt } }),
  }));
  sheet.getRow(1).font = { bold: true };
  if (rows.length === 0) {
    sheet.addRow([EMPTY_MESSAGE]);
  } else {
    for (const row of rows) sheet.addRow(row.map(cell));
  }
  return sheet;
}

/** Aba de pares rótulo/valor (Filtros, Resumo). */
export function addKeyValueSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  rows: readonly (readonly [string, CellValue | boolean | undefined])[],
  headers: readonly [string, string] = ['Item', 'Valor'],
): ExcelJS.Worksheet {
  return addTableSheet(
    workbook,
    name,
    [
      { header: headers[0], width: 34 },
      { header: headers[1], width: 60 },
    ],
    rows.map(([label, value]) => [label, value]),
  );
}

export function newWorkbook(now: Date): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'FHDOD';
  workbook.created = now;
  return workbook;
}

export async function toBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
