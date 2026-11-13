import { type Queryable, toNumber } from '../../lib/database.js';
import { sql } from '../../lib/sql.js';
import {
  type ResolvedFilters,
  responseConditions,
  RESPONSES_FROM,
} from '../dashboard/dashboard.filters.js';

/**
 * Consultas da TV Wall (E42). Leem somente responses, sectors e survey_versions (Tabela 24:
 * TV Wall → responses, sectors): nenhuma consulta toca manifestações, contatos, turnos, equipes,
 * perfis ou auditoria (RN09).
 */

/**
 * Hospitais candidatos à TV Wall: o informado em TV_WALL_HOSPITAL_SHORT_NAME ou, sem
 * configuração, os cadastrados (Seção 2: há um único hospital). LIMIT 2 distingue um de vários.
 */
export async function findTvWallHospitalIds(
  db: Queryable,
  shortName: string | undefined,
): Promise<string[]> {
  const rows = await db.query<{ id: string }>(
    shortName === undefined
      ? sql`SELECT id FROM hospitals ORDER BY id LIMIT 2`
      : sql`SELECT id FROM hospitals WHERE short_name = ${shortName} LIMIT 2`,
  );
  return rows.map((row) => row.id);
}

/** Contagens do RN03 (promotores 9–10, passivos 7–8, detratores 0–6). */
export interface NpsCounts {
  total: number;
  promoters: number;
  passives: number;
  detractors: number;
}

const COUNT_COLUMNS = sql`
  COUNT(*) AS total,
  COUNT(CASE WHEN r.nps_score >= 9 THEN 1 END) AS promoters,
  COUNT(CASE WHEN r.nps_score IN (7, 8) THEN 1 END) AS passives,
  COUNT(CASE WHEN r.nps_score <= 6 THEN 1 END) AS detractors`;

function countsOf(row: Record<string, unknown> | undefined): NpsCounts {
  return {
    total: toNumber(row?.total ?? 0),
    promoters: toNumber(row?.promoters ?? 0),
    passives: toNumber(row?.passives ?? 0),
    detractors: toNumber(row?.detractors ?? 0),
  };
}

/** Totais do hospital no período (todas as respostas persistidas, RN14). */
export async function countHospitalResponses(
  db: Queryable,
  filters: ResolvedFilters,
): Promise<NpsCounts> {
  const rows = await db.query(sql`
    SELECT ${COUNT_COLUMNS}
    FROM ${RESPONSES_FROM}
    WHERE s.hospital_id = ${filters.hospitalId} AND ${responseConditions(filters)}`);
  return countsOf(rows[0]);
}

/**
 * Agregação por setor com HAVING COUNT(*) >= mínimo (Seção 8): setores com menos respostas nem
 * saem do banco (RF71). Devolve só o nome e as contagens.
 */
export async function countSectorResponses(
  db: Queryable,
  filters: ResolvedFilters,
  minimum: number,
): Promise<(NpsCounts & { name: string })[]> {
  const rows = await db.query<Record<string, unknown> & { name: string }>(sql`
    SELECT s.name, ${COUNT_COLUMNS}
    FROM ${RESPONSES_FROM}
    WHERE s.hospital_id = ${filters.hospitalId} AND ${responseConditions(filters)}
    GROUP BY s.id
    HAVING COUNT(*) >= ${minimum}`);
  return rows.map((row) => ({ name: row.name, ...countsOf(row) }));
}
