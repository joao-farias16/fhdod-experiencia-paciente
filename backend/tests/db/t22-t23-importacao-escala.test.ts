/**
 * T22 — Importação válida de escala e T23 — Rejeição de arquivos inválidos (RF22, RF23, RN19,
 * RN20), integração com PostgreSQL real.
 * T22: CSV válido de 60 linhas com turno noturno; confirmar duas vezes → validated; 60 turnos; 409.
 * T23: cabeçalho, data, hora, equipe, escopo, sobreposições, 1,2 MB e .xlsx inválidos → erro na
 * linha ou 413/415; nada gravado. Também: expiração em 30 minutos e revalidação na confirmação.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../src/lib/prisma.js';
import { FakeSupabase } from '../fake-supabase.js';
import { errorOf } from '../helpers.js';
import {
  type AuthScenario,
  buildAuthApp,
  createAuthScenario,
  openConnections,
} from './auth-support.js';
import {
  adjustableClock,
  type App,
  auditActionsOf,
  brDate,
  call,
  countRows,
  CSV_HEADER,
  dataOf,
  localDatePlus,
  rosterCsv,
  uploadRoster,
} from './et04-et06-support.js';
import type { Db } from './support.js';

let db: Db;
let prisma: PrismaClient;
let fake: FakeSupabase;
let scenario: AuthScenario;

interface RosterImport {
  id: string;
  status: 'validated' | 'rejected' | 'committed';
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  errors: { line: number; column: string; code: string; message: string }[];
  summary: { teamCode: string; shifts: number }[];
  expiresAt: string;
}

beforeAll(async () => {
  ({ db, prisma } = await openConnections());
  fake = new FakeSupabase();
  scenario = await createAuthScenario(db, fake);
});

afterAll(async () => {
  await prisma.$disconnect();
  await db.end();
});

const shiftsOfSector = (sectorId: string) =>
  countRows(db, 'SELECT 1 FROM shifts WHERE sector_id = $1', [sectorId]);
const shiftsOfImport = (importId: string) =>
  countRows(db, 'SELECT 1 FROM shifts WHERE import_id = $1', [importId]);

describe('T22 — importação válida de escala', () => {
  let app: App;
  beforeAll(() => {
    app = buildAuthApp(prisma, fake);
  });

  it('60 linhas com turno noturno: pré-valida sem gravar, confirma 60 turnos e recusa a 2ª confirmação', async () => {
    const lines: string[] = [];
    for (let day = 1; day <= 30; day += 1) {
      const date = brDate(localDatePlus(day));
      lines.push(`SETOR-A;A1;${date};MANHA;07:00;19:00`, `SETOR-A;A2;${date};NOITE;19:00;07:00`);
    }
    const before = await shiftsOfSector(scenario.fx.sectorA);

    const validated = await uploadRoster(app, scenario, 'as', rosterCsv(lines));
    expect(validated.status).toBe(201);
    const result = dataOf<RosterImport>(validated);
    expect(result).toMatchObject({
      status: 'validated',
      totalRows: 60,
      acceptedRows: 60,
      rejectedRows: 0,
      errors: [],
    });
    expect(result.summary.map((item) => [item.teamCode, item.shifts])).toEqual([
      ['A1', 30],
      ['A2', 30],
    ]);
    // RF22: a pré-validação não grava turnos.
    expect(await shiftsOfSector(scenario.fx.sectorA)).toBe(before);
    // RF23: somente a própria importação pode ser confirmada.
    expect(
      (await call(app, scenario, 'sa', 'post', `/admin/rosters/imports/${result.id}/confirm`))
        .status,
    ).toBe(404);

    const confirmed = await call(
      app,
      scenario,
      'as',
      'post',
      `/admin/rosters/imports/${result.id}/confirm`,
    );
    expect(confirmed.status).toBe(200);
    expect(dataOf<RosterImport>(confirmed).status).toBe('committed');
    expect(await shiftsOfImport(result.id)).toBe(60);
    expect(await shiftsOfSector(scenario.fx.sectorA)).toBe(before + 60);

    // Turno noturno: 19:00 local → 22:00Z e termina às 10:00Z do dia seguinte (RN20, RN25).
    const { rows } = await db.query<{
      starts_at: Date;
      ends_at: Date;
      period: string;
      source: string;
    }>(
      `SELECT starts_at, ends_at, period, source FROM shifts
       WHERE import_id = $1 AND team_id = $2 ORDER BY starts_at LIMIT 1`,
      [result.id, scenario.fx.teamA2],
    );
    expect(rows[0]).toMatchObject({ period: 'night', source: 'import' });
    expect(rows[0]?.starts_at.toISOString()).toBe(`${localDatePlus(1)}T22:00:00.000Z`);
    expect(rows[0]?.ends_at.toISOString()).toBe(`${localDatePlus(2)}T10:00:00.000Z`);

    const again = await call(
      app,
      scenario,
      'as',
      'post',
      `/admin/rosters/imports/${result.id}/confirm`,
    );
    expect([again.status, errorOf(again).code]).toEqual([409, 'IMPORT_ALREADY_COMMITTED']);
    expect(await shiftsOfImport(result.id)).toBe(60);
    expect(await auditActionsOf(db, result.id)).toEqual([
      'ROSTER_IMPORT_VALIDATED',
      'ROSTER_IMPORT_COMMITTED',
    ]);
  });
});

describe('T23 — rejeição de arquivos inválidos (nada gravado)', () => {
  let app: App;
  beforeAll(() => {
    app = buildAuthApp(prisma, fake);
  });

  it('erros por linha e coluna: data, hora, duração, turno, equipe, escopo, campo e sobreposições', async () => {
    const d = (days: number) => brDate(localDatePlus(days));
    // Turno já cadastrado da equipe A2 (OVERLAP_EXISTING) e equipe inativa A3.
    const existing = await call(app, scenario, 'sa', 'post', '/admin/shifts', {
      teamId: scenario.fx.teamA2,
      date: localDatePlus(50),
      period: 'morning',
      startTime: '10:00',
      endTime: '16:00',
    });
    expect(existing.status).toBe(201);
    const inactiveTeam = await call(app, scenario, 'sa', 'post', '/admin/teams', {
      sectorId: scenario.fx.sectorA,
      code: 'A3',
      name: 'Equipe A3',
    });
    await call(
      app,
      scenario,
      'sa',
      'patch',
      `/admin/teams/${dataOf<{ id: string }>(inactiveTeam).id}`,
      {
        isActive: false,
      },
    );
    const before = await shiftsOfSector(scenario.fx.sectorA);

    const file = rosterCsv([
      `SETOR-A;A1;${d(40)};MANHA;07:00;13:00`, // 2: válida
      'SETOR-A;A1;31/02/2027;MANHA;07:00;13:00', // 3: data inexistente
      `SETOR-A;A1;${d(200)};MANHA;07:00;13:00`, // 4: fora da janela
      `SETOR-A;A1;${d(41)};MANHA;25:00;13:00`, // 5: hora inválida
      `SETOR-A;A1;${d(42)};MANHA;08:00;08:30`, // 6: duração menor que 1 h
      `SETOR-A;A1;${d(43)};MADRUGADA;07:00;13:00`, // 7: turno inválido
      `SETOR-A;ZZ;${d(44)};MANHA;07:00;13:00`, // 8: equipe inexistente
      `SETOR-B;B1;${d(44)};MANHA;07:00;13:00`, // 9: setor fora do escopo do AS
      `SETOR-X;A1;${d(44)};MANHA;07:00;13:00`, // 10: setor inexistente
      `SETOR-A;;${d(45)};MANHA;07:00;13:00`, // 11: campo obrigatório
      `SETOR-A;A2;${d(46)};MANHA;07:00;13:00`, // 12: sobrepõe a linha 13
      `SETOR-A;A2;${d(46)};TARDE;12:00;18:00`, // 13: sobrepõe a linha 12
      `SETOR-A;A2;${d(50)};MANHA;07:00;13:00`, // 14: sobrepõe turno cadastrado
      `SETOR-A;A3;${d(47)};MANHA;07:00;13:00`, // 15: equipe inativa
    ]);
    const response = await uploadRoster(app, scenario, 'as', file);
    expect(response.status).toBe(201);
    const result = dataOf<RosterImport>(response);
    expect(result).toMatchObject({
      status: 'rejected',
      totalRows: 14,
      acceptedRows: 1,
      rejectedRows: 13,
    });
    expect(result.errors.map((error) => [error.line, error.column, error.code])).toEqual([
      [3, 'data', 'DATE_INVALID'],
      [4, 'data', 'DATE_OUT_OF_RANGE'],
      [5, 'hora_inicio', 'TIME_INVALID'],
      [6, 'hora_fim', 'DURATION_INVALID'],
      [7, 'turno', 'PERIOD_INVALID'],
      [8, 'equipe_codigo', 'TEAM_NOT_FOUND'],
      [9, 'setor_codigo', 'SECTOR_OUT_OF_SCOPE'],
      [10, 'setor_codigo', 'SECTOR_NOT_FOUND'],
      [11, 'equipe_codigo', 'FIELD_REQUIRED'],
      [12, 'hora_inicio', 'OVERLAP_IN_FILE'],
      [13, 'hora_inicio', 'OVERLAP_IN_FILE'],
      [14, 'hora_inicio', 'OVERLAP_EXISTING'],
      [15, 'equipe_codigo', 'TEAM_INACTIVE'],
    ]);
    expect(result.errors.every((error) => error.message.length > 0)).toBe(true);
    expect(await shiftsOfSector(scenario.fx.sectorA)).toBe(before);

    // Rejeitada não pode ser confirmada.
    const confirm = await call(
      app,
      scenario,
      'as',
      'post',
      `/admin/rosters/imports/${result.id}/confirm`,
    );
    expect([confirm.status, errorOf(confirm).code]).toEqual([409, 'IMPORT_REJECTED']);
    expect(await shiftsOfImport(result.id)).toBe(0);

    // Setor inativo (SA, escopo global) e cabeçalho inválido.
    const inactive = dataOf<RosterImport>(
      await uploadRoster(app, scenario, 'sa', rosterCsv([`SETOR-C;C1;${d(40)};MANHA;07:00;13:00`])),
    );
    expect(inactive.errors.map((error) => error.code)).toEqual(['SECTOR_INACTIVE']);
    const header = dataOf<RosterImport>(
      await uploadRoster(
        app,
        scenario,
        'sa',
        rosterCsv([`SETOR-A;A1;${d(40)};MANHA;07:00;13:00`], 'setor;equipe;data;turno;inicio;fim'),
      ),
    );
    expect(header).toMatchObject({ status: 'rejected', totalRows: 1, rejectedRows: 1 });
    expect(header.errors).toEqual([
      expect.objectContaining({ line: 1, column: 'cabecalho', code: 'CSV_HEADER_INVALID' }),
    ]);
  });

  it('erros de arquivo: 1,2 MB (413), .xlsx (415), vazio, codificação, linhas demais, sem arquivo', async () => {
    const importsBefore = await countRows(
      db,
      'SELECT 1 FROM shift_imports WHERE uploaded_by = $1',
      [scenario.users.sa2.profileId],
    );
    const big = Buffer.alloc(1.2 * 1024 * 1024, 'SETOR-A;A1;01/01/2027;MANHA;07:00;13:00\n');
    const tooLarge = await uploadRoster(app, scenario, 'sa2', big);
    expect([tooLarge.status, errorOf(tooLarge).code]).toEqual([413, 'FILE_TOO_LARGE']);

    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
    const xlsx = await uploadRoster(app, scenario, 'sa2', zip, 'escala.xlsx');
    expect([xlsx.status, errorOf(xlsx).code]).toEqual([415, 'UNSUPPORTED_FILE_TYPE']);
    expect((await uploadRoster(app, scenario, 'sa2', zip, 'disfarcado.csv')).status).toBe(415);

    const empty = await uploadRoster(app, scenario, 'sa2', Buffer.from(`${CSV_HEADER}\n`));
    expect([empty.status, errorOf(empty).code]).toEqual([400, 'EMPTY_FILE']);

    const latin1 = Buffer.from(
      `${CSV_HEADER}\nSETOR-A;A1;01/01/2027;MANHÃ;07:00;13:00\n`,
      'latin1',
    );
    const encoding = await uploadRoster(app, scenario, 'sa2', latin1);
    expect([encoding.status, errorOf(encoding).code]).toEqual([400, 'ENCODING_INVALID']);

    const rows = Array.from({ length: 2001 }, () => 'SETOR-A;A1;01/01/2027;MANHA;07:00;13:00');
    const tooMany = await uploadRoster(app, scenario, 'sa2', rosterCsv(rows));
    expect([tooMany.status, errorOf(tooMany).code]).toEqual([400, 'TOO_MANY_ROWS']);

    const missing = await call(app, scenario, 'sa2', 'post', '/admin/rosters/import', {});
    expect(missing.status).toBe(400);

    // Nenhum desses arquivos gerou registro de importação.
    expect(
      await countRows(db, 'SELECT 1 FROM shift_imports WHERE uploaded_by = $1', [
        scenario.users.sa2.profileId,
      ]),
    ).toBe(importsBefore);
  });

  it('GE, OU e VI não importam escalas (403)', async () => {
    for (const key of ['ge', 'ou', 'vi'] as const) {
      const response = await uploadRoster(app, scenario, key, rosterCsv([]));
      expect([response.status, errorOf(response).code]).toEqual([403, 'FORBIDDEN']);
    }
  });
});

describe('T22/T23 — confirmação: 30 minutos e revalidação (RN19)', () => {
  const clock = adjustableClock();
  let app: App;
  beforeAll(() => {
    app = buildAuthApp(prisma, fake, clock);
  });

  const validate = async (line: string) =>
    dataOf<RosterImport>(await uploadRoster(app, scenario, 'sa', rosterCsv([line])));

  it('confirmação após 30 minutos → 409 IMPORT_EXPIRED, sem turnos', async () => {
    clock.set(new Date());
    const result = await validate(`SETOR-A;A1;${brDate(localDatePlus(60))};MANHA;07:00;13:00`);
    expect(result.status).toBe('validated');
    clock.set(new Date(Date.parse(result.expiresAt) + 60_000));
    const expired = await call(
      app,
      scenario,
      'sa',
      'post',
      `/admin/rosters/imports/${result.id}/confirm`,
    );
    expect([expired.status, errorOf(expired).code]).toEqual([409, 'IMPORT_EXPIRED']);
    expect(await shiftsOfImport(result.id)).toBe(0);
    clock.set(new Date());
  });

  it('equipe desativada ou sobreposição surgida depois da pré-validação → 422/409, nada gravado', async () => {
    const team = dataOf<{ id: string }>(
      await call(app, scenario, 'sa', 'post', '/admin/teams', {
        sectorId: scenario.fx.sectorA,
        code: 'A4',
        name: 'Equipe A4',
      }),
    );
    const first = await validate(`SETOR-A;A4;${brDate(localDatePlus(61))};MANHA;07:00;13:00`);
    await call(app, scenario, 'sa', 'patch', `/admin/teams/${team.id}`, { isActive: false });
    const inactive = await call(
      app,
      scenario,
      'sa',
      'post',
      `/admin/rosters/imports/${first.id}/confirm`,
    );
    expect([inactive.status, errorOf(inactive).code]).toEqual([422, 'TEAM_INACTIVE']);
    expect(await shiftsOfImport(first.id)).toBe(0);

    const second = await validate(`SETOR-A;A2;${brDate(localDatePlus(62))};MANHA;07:00;13:00`);
    await call(app, scenario, 'sa', 'post', '/admin/shifts', {
      teamId: scenario.fx.teamA2,
      date: localDatePlus(62),
      period: 'morning',
      startTime: '10:00',
      endTime: '16:00',
    });
    const overlap = await call(
      app,
      scenario,
      'sa',
      'post',
      `/admin/rosters/imports/${second.id}/confirm`,
    );
    expect([overlap.status, errorOf(overlap).code]).toEqual([409, 'SHIFT_OVERLAP']);
    expect(await shiftsOfImport(second.id)).toBe(0);
    // A importação continua "validated": a confirmação falhou inteira (tudo ou nada).
    const { rows } = await db.query<{ status: string }>(
      'SELECT status FROM shift_imports WHERE id = $1',
      [second.id],
    );
    expect(rows[0]?.status).toBe('validated');
  });
});
