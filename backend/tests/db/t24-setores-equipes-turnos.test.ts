/**
 * T24 — Setores, equipes e turnos (RF12–RF21, E10–E19 e E16), integração com PostgreSQL real.
 * Procedimento da Seção 12: criar, editar, desativar e reativar setores e equipes; turnos manuais,
 * noturno, sobreposto e cancelado → critérios de RF12 a RF21. Cada cenário percorre o fluxo
 * completo e confere o banco e a auditoria (RN11, RN16).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../src/lib/prisma.js';
import { FakeSupabase } from '../fake-supabase.js';
import { errorOf } from '../helpers.js';
import {
  type AuthScenario,
  buildAuthApp,
  createAuthScenario,
  deniedRowsOf,
  openConnections,
} from './auth-support.js';
import {
  type App,
  auditActionsOf,
  call,
  countRows,
  dataOf,
  localDatePlus,
} from './et04-et06-support.js';
import type { Db } from './support.js';

let db: Db;
let prisma: PrismaClient;
let scenario: AuthScenario;
let app: App;

beforeAll(async () => {
  ({ db, prisma } = await openConnections());
  const fake = new FakeSupabase();
  scenario = await createAuthScenario(db, fake);
  app = buildAuthApp(prisma, fake);
});

afterAll(async () => {
  await prisma.$disconnect();
  await db.end();
});

interface Sector {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  deactivatedAt: string | null;
  activeTeams: number;
}
interface Team {
  id: string;
  sectorId: string;
  code: string;
  name: string;
  isActive: boolean;
}
interface Shift {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  endsNextDay: boolean;
  startsAt: string;
  endsAt: string;
  period: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  team: { id: string };
}

describe('T24 — setores (RF12–RF15; E10–E12)', () => {
  let sector: Sector;

  it('SA cadastra, edita, desativa e reativa; duplicidades, código inválido e code no PATCH', async () => {
    const created = await call(app, scenario, 'sa', 'post', '/admin/sectors', {
      code: 'CENTRO-CIR',
      name: 'Centro Cirúrgico',
      description: 'Setor fictício de teste',
    });
    expect(created.status).toBe(201);
    sector = dataOf<Sector>(created);
    expect(sector).toMatchObject({ code: 'CENTRO-CIR', isActive: true, activeTeams: 0 });

    // RF12: código e nome únicos (nome sem distinguir maiúsculas) → 409; código inválido → 400.
    const sameCode = await call(app, scenario, 'sa', 'post', '/admin/sectors', {
      code: 'CENTRO-CIR',
      name: 'Outro nome',
    });
    expect([sameCode.status, errorOf(sameCode).code]).toEqual([409, 'CONFLICT']);
    const sameName = await call(app, scenario, 'sa', 'post', '/admin/sectors', {
      code: 'OUTRO',
      name: 'centro cirúrgico',
    });
    expect(sameName.status).toBe(409);
    for (const code of ['c', 'centro', 'CÓDIGO', 'A'.repeat(21)]) {
      const invalid = await call(app, scenario, 'sa', 'post', '/admin/sectors', {
        code,
        name: `Nome ${code}`,
      });
      expect(invalid.status).toBe(400);
      expect(errorOf(invalid).details[0]?.field).toBe('code');
    }

    // RF14: nome e descrição editáveis; código imutável (code no corpo → 400).
    const renamed = await call(app, scenario, 'sa', 'patch', `/admin/sectors/${sector.id}`, {
      name: 'Centro Cirúrgico Geral',
      description: '',
    });
    expect(renamed.status).toBe(200);
    expect(dataOf<Sector>(renamed)).toMatchObject({
      name: 'Centro Cirúrgico Geral',
      description: null,
    });
    const withCode = await call(app, scenario, 'sa', 'patch', `/admin/sectors/${sector.id}`, {
      code: 'NOVO',
    });
    expect(withCode.status).toBe(400);
    expect(errorOf(withCode).details).toContainEqual({
      field: 'code',
      message: 'Campo não permitido.',
    });

    // RF15: desativação lógica e reativação; histórico continua visível na lista.
    const off = await call(app, scenario, 'sa', 'patch', `/admin/sectors/${sector.id}`, {
      isActive: false,
    });
    expect(dataOf<Sector>(off)).toMatchObject({
      isActive: false,
      deactivatedAt: expect.any(String) as string,
    });
    const list = dataOf<Sector[]>(await call(app, scenario, 'sa', 'get', '/admin/sectors'));
    expect(list.find((item) => item.id === sector.id)?.isActive).toBe(false);
    const on = await call(app, scenario, 'sa', 'patch', `/admin/sectors/${sector.id}`, {
      isActive: true,
    });
    expect(dataOf<Sector>(on)).toMatchObject({ isActive: true, deactivatedAt: null });

    // Um registro de auditoria por operação (RN16).
    expect(await auditActionsOf(db, sector.id)).toEqual([
      'SECTOR_CREATED',
      'SECTOR_UPDATED',
      'SECTOR_DEACTIVATED',
      'SECTOR_REACTIVATED',
    ]);
  });

  it('somente o SA cadastra e altera setores (Tabela 13); recurso de outro hospital → 404', async () => {
    for (const key of ['as', 'ge', 'ou', 'vi'] as const) {
      const before = (await deniedRowsOf(db, scenario.users[key].profileId)).length;
      const post = await call(app, scenario, key, 'post', '/admin/sectors', {
        code: 'NEGADO',
        name: 'Negado',
      });
      expect([post.status, errorOf(post).code]).toEqual([403, 'FORBIDDEN']);
      expect(await deniedRowsOf(db, scenario.users[key].profileId)).toHaveLength(before + 1);
    }
    const missing = await call(
      app,
      scenario,
      'sa',
      'patch',
      `/admin/sectors/${crypto.randomUUID()}`,
      {
        name: 'Inexistente',
      },
    );
    expect(missing.status).toBe(404);
    expect(await countRows(db, "SELECT 1 FROM sectors WHERE code = 'NEGADO'")).toBe(0);
  });
});

describe('T24 — equipes (RF16–RF18; E13–E15) e etapas (E16)', () => {
  it('AS cadastra e edita equipes do próprio setor; fora do escopo → 403/404; lista restrita', async () => {
    const created = await call(app, scenario, 'as', 'post', '/admin/teams', {
      sectorId: scenario.fx.sectorA,
      code: 'EQUIPE-NOITE',
      name: 'Equipe da noite',
    });
    expect(created.status).toBe(201);
    const team = dataOf<Team>(created);

    const duplicate = await call(app, scenario, 'as', 'post', '/admin/teams', {
      sectorId: scenario.fx.sectorA,
      code: 'EQUIPE-NOITE',
      name: 'Repetida',
    });
    expect(duplicate.status).toBe(409);

    // RF16: setor fora do escopo → 403 SECTOR_OUT_OF_SCOPE (auditado); setor inativo → 422.
    const outside = await call(app, scenario, 'as', 'post', '/admin/teams', {
      sectorId: scenario.fx.sectorB,
      code: 'INVASORA',
      name: 'Fora do escopo',
    });
    expect([outside.status, errorOf(outside).code]).toEqual([403, 'SECTOR_OUT_OF_SCOPE']);
    const inactive = await call(app, scenario, 'sa', 'post', '/admin/teams', {
      sectorId: scenario.sectorC,
      code: 'INATIVA',
      name: 'Setor inativo',
    });
    expect([inactive.status, errorOf(inactive).code]).toEqual([422, 'SECTOR_INACTIVE']);

    // RF17: lista restrita ao escopo; filtro de outro setor → 403; código imutável.
    const asList = dataOf<Team[]>(await call(app, scenario, 'as', 'get', '/admin/teams'));
    expect(new Set(asList.map((item) => item.sectorId))).toEqual(new Set([scenario.fx.sectorA]));
    const filtered = await call(
      app,
      scenario,
      'as',
      'get',
      `/admin/teams?sectorId=${scenario.fx.sectorB}`,
    );
    expect(filtered.status).toBe(403);
    const viList = await call(app, scenario, 'vi', 'get', '/admin/teams');
    expect(viList.status).toBe(200);

    const renamed = await call(app, scenario, 'as', 'patch', `/admin/teams/${team.id}`, {
      name: 'Equipe noturna',
    });
    expect(dataOf<Team>(renamed).name).toBe('Equipe noturna');
    expect(
      (await call(app, scenario, 'as', 'patch', `/admin/teams/${team.id}`, { code: 'X1' })).status,
    ).toBe(400);
    expect(
      (
        await call(app, scenario, 'as', 'patch', `/admin/teams/${scenario.fx.teamB1}`, {
          name: 'Outra',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(app, scenario, 'ge', 'post', '/admin/teams', {
          sectorId: scenario.fx.sectorA,
          code: 'GE',
          name: 'Gestão',
        })
      ).status,
    ).toBe(403);

    const off = await call(app, scenario, 'as', 'patch', `/admin/teams/${team.id}`, {
      isActive: false,
    });
    expect(dataOf<Team>(off).isActive).toBe(false);
    expect(await auditActionsOf(db, team.id)).toEqual([
      'TEAM_CREATED',
      'TEAM_UPDATED',
      'TEAM_DEACTIVATED',
    ]);
  });

  it('E16 — etapas ordenadas para SA e AS; demais perfis → 403', async () => {
    const stages = await call(app, scenario, 'as', 'get', '/admin/journey-stages');
    expect(stages.status).toBe(200);
    expect(dataOf<{ code: string; position: number }[]>(stages)).toEqual([
      expect.objectContaining({ code: 'RECEPCAO', position: 1 }),
    ]);
    expect((await call(app, scenario, 'ge', 'get', '/admin/journey-stages')).status).toBe(403);
  });
});

describe('T24 — turnos manuais, noturno, sobreposto e cancelado (RF19–RF21; E17–E19)', () => {
  let team: Team;
  const date = localDatePlus(10);

  beforeAll(async () => {
    team = dataOf<Team>(
      await call(app, scenario, 'sa', 'post', '/admin/teams', {
        sectorId: scenario.fx.sectorA,
        code: 'PLANTAO',
        name: 'Equipe de plantão',
      }),
    );
  });

  it('turno 19:00–07:00 termina no dia seguinte, em UTC; sobreposição → 409 SHIFT_OVERLAP', async () => {
    const night = await call(app, scenario, 'as', 'post', '/admin/shifts', {
      teamId: team.id,
      date,
      period: 'night',
      startTime: '19:00',
      endTime: '07:00',
    });
    expect(night.status).toBe(201);
    const shift = dataOf<Shift>(night);
    // America/Sao_Paulo = UTC−3: 19:00 local → 22:00Z; 07:00 do dia seguinte → 10:00Z.
    expect(shift.startsAt).toBe(`${date}T22:00:00.000Z`);
    expect(shift.endsAt).toBe(`${localDatePlus(11)}T10:00:00.000Z`);
    expect(shift).toMatchObject({ date, startTime: '19:00', endTime: '07:00', endsNextDay: true });

    const overlap = await call(app, scenario, 'as', 'post', '/admin/shifts', {
      teamId: team.id,
      date: localDatePlus(11),
      period: 'morning',
      startTime: '06:00',
      endTime: '12:00',
    });
    expect([overlap.status, errorOf(overlap).code]).toEqual([409, 'SHIFT_OVERLAP']);
    // Outra equipe no mesmo horário é permitida (a regra é por equipe).
    const otherTeam = await call(app, scenario, 'as', 'post', '/admin/shifts', {
      teamId: scenario.fx.teamA2,
      date: localDatePlus(11),
      period: 'morning',
      startTime: '06:00',
      endTime: '12:00',
    });
    expect(otherTeam.status).toBe(201);
    // Encostar no fim do turno anterior (07:00) não é sobreposição: intervalo [início, fim).
    const adjacent = await call(app, scenario, 'as', 'post', '/admin/shifts', {
      teamId: team.id,
      date: localDatePlus(11),
      period: 'morning',
      startTime: '07:00',
      endTime: '13:00',
    });
    expect(adjacent.status).toBe(201);
  });

  it('validações: duração, janela de datas, equipe e setor inativos, escopo', async () => {
    const base = { teamId: team.id, period: 'morning', startTime: '08:00' };
    const short = await call(app, scenario, 'as', 'post', '/admin/shifts', {
      ...base,
      date: localDatePlus(20),
      endTime: '08:30',
    });
    expect([short.status, errorOf(short).details[0]?.field]).toEqual([400, 'endTime']);
    const far = await call(app, scenario, 'as', 'post', '/admin/shifts', {
      ...base,
      date: localDatePlus(181),
      endTime: '12:00',
    });
    expect([far.status, errorOf(far).code]).toEqual([422, 'DATE_OUT_OF_RANGE']);
    const past = await call(app, scenario, 'as', 'post', '/admin/shifts', {
      ...base,
      date: localDatePlus(-31),
      endTime: '12:00',
    });
    expect(past.status).toBe(422);
    const outside = await call(app, scenario, 'as', 'post', '/admin/shifts', {
      ...base,
      teamId: scenario.fx.teamB1,
      date: localDatePlus(20),
      endTime: '12:00',
    });
    expect(outside.status).toBe(404);

    // RF18: equipe inativa → 422 TEAM_INACTIVE.
    const idle = dataOf<Team>(
      await call(app, scenario, 'sa', 'post', '/admin/teams', {
        sectorId: scenario.fx.sectorA,
        code: 'INATIVA',
        name: 'Equipe inativa',
      }),
    );
    await call(app, scenario, 'sa', 'patch', `/admin/teams/${idle.id}`, { isActive: false });
    const teamOff = await call(app, scenario, 'sa', 'post', '/admin/shifts', {
      ...base,
      teamId: idle.id,
      date: localDatePlus(20),
      endTime: '12:00',
    });
    expect([teamOff.status, errorOf(teamOff).code]).toEqual([422, 'TEAM_INACTIVE']);

    // RF15: setor inativo → 422 SECTOR_INACTIVE (a equipe continua ativa).
    const sector = dataOf<Sector>(
      await call(app, scenario, 'sa', 'post', '/admin/sectors', {
        code: 'TEMP',
        name: 'Temporário',
      }),
    );
    const tempTeam = dataOf<Team>(
      await call(app, scenario, 'sa', 'post', '/admin/teams', {
        sectorId: sector.id,
        code: 'T1',
        name: 'T1',
      }),
    );
    await call(app, scenario, 'sa', 'patch', `/admin/sectors/${sector.id}`, { isActive: false });
    const sectorOff = await call(app, scenario, 'sa', 'post', '/admin/shifts', {
      ...base,
      teamId: tempTeam.id,
      date: localDatePlus(20),
      endTime: '12:00',
    });
    expect([sectorOff.status, errorOf(sectorOff).code]).toEqual([422, 'SECTOR_INACTIVE']);
    expect(
      await countRows(db, 'SELECT 1 FROM shifts WHERE team_id = ANY($1)', [[idle.id, tempTeam.id]]),
    ).toBe(0);
  });

  it('E17 — escala por setor, equipe e até 62 dias, no fuso local; cancelamento com motivo', async () => {
    const from = localDatePlus(10);
    const to = localDatePlus(11);
    const list = await call(
      app,
      scenario,
      'as',
      'get',
      `/admin/shifts?sectorId=${scenario.fx.sectorA}&from=${from}&to=${to}&teamId=${team.id}`,
    );
    expect(list.status).toBe(200);
    const shifts = dataOf<Shift[]>(list);
    expect(shifts.map((item) => `${item.date} ${item.startTime}-${item.endTime}`)).toEqual([
      `${from} 19:00-07:00`,
      `${to} 07:00-13:00`,
    ]);

    const tooLong = await call(
      app,
      scenario,
      'as',
      'get',
      `/admin/shifts?sectorId=${scenario.fx.sectorA}&from=${from}&to=${localDatePlus(72)}`,
    );
    expect(tooLong.status).toBe(400);
    const otherSector = await call(
      app,
      scenario,
      'as',
      'get',
      `/admin/shifts?sectorId=${scenario.fx.sectorB}&from=${from}&to=${to}`,
    );
    expect([otherSector.status, errorOf(otherSector).code]).toEqual([403, 'SECTOR_OUT_OF_SCOPE']);

    // RF21: cancelamento irreversível com motivo; segundo cancelamento → 409.
    const target = shifts[1];
    if (target === undefined) throw new Error('turno ausente');
    const noReason = await call(app, scenario, 'as', 'patch', `/admin/shifts/${target.id}`, {
      cancelled: true,
      reason: 'curt',
    });
    expect(noReason.status).toBe(400);
    const cancelled = await call(app, scenario, 'as', 'patch', `/admin/shifts/${target.id}`, {
      cancelled: true,
      reason: 'Escala refeita pela coordenação',
    });
    expect(cancelled.status).toBe(200);
    expect(dataOf<Shift>(cancelled)).toMatchObject({
      cancelledAt: expect.any(String) as string,
      cancelReason: 'Escala refeita pela coordenação',
    });
    const again = await call(app, scenario, 'as', 'patch', `/admin/shifts/${target.id}`, {
      cancelled: true,
      reason: 'Outra tentativa',
    });
    expect([again.status, errorOf(again).code]).toEqual([409, 'SHIFT_ALREADY_CANCELLED']);

    // O cancelado sai da escala padrão, aparece com includeCancelled e libera o horário.
    const query = `/admin/shifts?sectorId=${scenario.fx.sectorA}&from=${from}&to=${to}&teamId=${team.id}`;
    expect(dataOf<Shift[]>(await call(app, scenario, 'as', 'get', query))).toHaveLength(1);
    expect(
      dataOf<Shift[]>(await call(app, scenario, 'as', 'get', `${query}&includeCancelled=true`)),
    ).toHaveLength(2);
    const replacement = await call(app, scenario, 'as', 'post', '/admin/shifts', {
      teamId: team.id,
      date: to,
      period: 'morning',
      startTime: '08:00',
      endTime: '14:00',
    });
    expect(replacement.status).toBe(201);
    // RN11: o turno cancelado continua no banco.
    expect(await countRows(db, 'SELECT 1 FROM shifts WHERE id = $1', [target.id])).toBe(1);
    expect(await auditActionsOf(db, target.id)).toEqual(['SHIFT_CREATED', 'SHIFT_CANCELLED']);
  });

  it('turnos e escalas: GE, OU e VI → 403 (Tabela 13)', async () => {
    for (const key of ['ge', 'ou', 'vi'] as const) {
      const response = await call(
        app,
        scenario,
        key,
        'get',
        `/admin/shifts?sectorId=${scenario.fx.sectorA}&from=${date}&to=${date}`,
      );
      expect(response.status).toBe(403);
    }
  });
});
