/**
 * Apoio aos testes das ET04–ET06 com PostgreSQL real: relógio ajustável, chamadas autenticadas,
 * montagem do CSV de escala e envio de respostas públicas. Usa o cenário da ET03 (auth-support).
 */
import request from 'supertest';

import type { Clock } from '../../src/utils/clock.js';
import { addDays, localDateOf } from '../../src/utils/dates.js';
import type { AuthScenario, buildAuthApp, UserKey } from './auth-support.js';
import type { Db } from './support.js';

export type App = ReturnType<typeof buildAuthApp>;

/** Relógio que os testes posicionam (RN19: expiração; RN26: 24 h; RF24: instante do envio). */
export function adjustableClock(start = new Date()): Clock & { set(date: Date | string): void } {
  let current = new Date(start);
  return {
    now: () => new Date(current),
    set: (date) => {
      current = new Date(date);
    },
  };
}

type Method = 'get' | 'post' | 'patch' | 'delete';

/** Requisição autenticada com o token fictício do usuário do cenário. */
export function call(
  app: App,
  scenario: AuthScenario,
  key: UserKey,
  method: Method,
  path: string,
  body?: object,
): request.Test {
  const test = request(app)[method](`/api/v1${path}`).set('Authorization', scenario.bearer(key));
  return body === undefined ? test : test.send(body);
}

/** Conteúdo de { data } com o tipo esperado pelo teste. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- leitura tipada do envelope
export function dataOf<T>(response: { body: unknown }): T {
  return (response.body as { data: T }).data;
}

/** Data local (AAAA-MM-DD) a `days` dias de hoje, no fuso do hospital. */
export function localDatePlus(days: number, now = new Date()): string {
  return addDays(localDateOf(now), days);
}

/** AAAA-MM-DD → DD/MM/AAAA (formato do CSV). */
export function brDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day ?? ''}/${month ?? ''}/${year ?? ''}`;
}

export const CSV_HEADER = 'setor_codigo;equipe_codigo;data;turno;hora_inicio;hora_fim';

/** CSV de escala (UTF-8, separador ";") a partir de linhas já separadas por ";". */
export function rosterCsv(lines: readonly string[], header = CSV_HEADER): Buffer {
  return Buffer.from([header, ...lines].join('\n') + '\n', 'utf8');
}

export function uploadRoster(
  app: App,
  scenario: AuthScenario,
  key: UserKey,
  content: Buffer,
  fileName = 'escala.csv',
): request.Test {
  return request(app)
    .post('/api/v1/admin/rosters/import')
    .set('Authorization', scenario.bearer(key))
    .attach('file', content, { filename: fileName, contentType: 'text/csv' });
}

/** E02 — envio público com Idempotency-Key (nova chave por padrão). */
export function submitResponse(
  app: App,
  body: object,
  idempotencyKey: string = crypto.randomUUID(),
): request.Test {
  return request(app)
    .post('/api/v1/public/responses')
    .set('Idempotency-Key', idempotencyKey)
    .send(body);
}

export async function countRows(db: Db, sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM (${sql}) t`,
    params,
  );
  return rows[0]?.n ?? 0;
}

/** Ações de auditoria registradas para uma entidade, em ordem. */
export async function auditActionsOf(db: Db, entityId: string): Promise<string[]> {
  const { rows } = await db.query<{ action: string }>(
    'SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY id',
    [entityId],
  );
  return rows.map((row) => row.action);
}
