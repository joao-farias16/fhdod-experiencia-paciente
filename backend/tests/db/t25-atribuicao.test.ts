/**
 * T25 — Atribuição a turno e equipe (RF18, RF24, RN07, RN08), integração com PostgreSQL real pelo
 * endpoint público E02. Procedimento da Seção 12: origem link; QR sem turno; QR ambíguo; QR com
 * turno único; equipe inativa → not_qr_origin, no_shift, ambiguous, attributed, no_shift. A
 * resposta é sempre registrada, e atribuições anteriores permanecem (RF18, RF21).
 *
 * Cenário da ET02: setor A com o turno da equipe A1 de 10:00 a 16:00 UTC em 01/09/2026 e a
 * pesquisa A com a versão vigente v2 (publicada em 15/08/2026).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../src/lib/prisma.js';
import { FakeSupabase } from '../fake-supabase.js';
import {
  type AuthScenario,
  buildAuthApp,
  createAuthScenario,
  openConnections,
} from './auth-support.js';
import { adjustableClock, type App, call, dataOf, submitResponse } from './et04-et06-support.js';
import type { Db } from './support.js';

let db: Db;
let prisma: PrismaClient;
let scenario: AuthScenario;
let app: App;
const clock = adjustableClock(new Date('2026-09-01T12:00:00Z'));

beforeAll(async () => {
  ({ db, prisma } = await openConnections());
  const fake = new FakeSupabase();
  scenario = await createAuthScenario(db, fake);
  app = buildAuthApp(prisma, fake, clock);
});

afterAll(async () => {
  await prisma.$disconnect();
  await db.end();
});

interface Stored {
  attribution_status: string;
  shift_id: string | null;
  team_id: string | null;
  shift_period: string | null;
  submitted_at: Date;
}

async function respond(
  origin: 'qr_code' | 'link',
  at: string,
): Promise<{ id: string; row: Stored }> {
  clock.set(at);
  const response = await submitResponse(app, {
    surveyVersionId: scenario.fx.versionA2,
    origin,
    npsScore: 8,
    answers: [],
  });
  expect(response.status).toBe(201);
  const { responseId } = dataOf<{ responseId: string }>(response);
  const { rows } = await db.query<Stored>(
    `SELECT attribution_status, shift_id, team_id, shift_period, submitted_at
     FROM responses WHERE id = $1`,
    [responseId],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('resposta não gravada');
  return { id: responseId, row };
}

describe('T25 — atribuição a turno e equipe pelo E02', () => {
  it('link, QR com turno único, sem turno, ambíguo, turno cancelado e equipe inativa', async () => {
    const T = '2026-09-01T12:00:00.000Z';

    const viaLink = await respond('link', T);
    expect(viaLink.row).toMatchObject({ attribution_status: 'not_qr_origin', team_id: null });

    const single = await respond('qr_code', T);
    expect(single.row).toMatchObject({
      attribution_status: 'attributed',
      shift_id: scenario.fx.shiftA1,
      team_id: scenario.fx.teamA1,
      shift_period: 'morning',
    });
    // O instante usado é o do envio, gravado em UTC.
    expect(single.row.submitted_at.toISOString()).toBe(T);

    const noShift = await respond('qr_code', '2026-09-01T20:00:00.000Z');
    expect(noShift.row).toMatchObject({ attribution_status: 'no_shift', shift_id: null });

    // Segundo turno do setor no mesmo instante (equipe A2, 08:00–12:00 local = 11:00–15:00 UTC).
    const second = await call(app, scenario, 'sa', 'post', '/admin/shifts', {
      teamId: scenario.fx.teamA2,
      date: '2026-09-01',
      period: 'morning',
      startTime: '08:00',
      endTime: '12:00',
    });
    expect(second.status).toBe(201);
    const ambiguous = await respond('qr_code', T);
    expect(ambiguous.row).toMatchObject({ attribution_status: 'ambiguous', team_id: null });

    // RF21: o turno cancelado é ignorado em novas atribuições.
    await call(app, scenario, 'sa', 'patch', `/admin/shifts/${dataOf<{ id: string }>(second).id}`, {
      cancelled: true,
      reason: 'Equipe remanejada',
    });
    const afterCancel = await respond('qr_code', T);
    expect(afterCancel.row).toMatchObject({
      attribution_status: 'attributed',
      team_id: scenario.fx.teamA1,
    });

    // RF18: equipe inativa não recebe novas atribuições; a resposta é registrada mesmo assim.
    await call(app, scenario, 'sa', 'patch', `/admin/teams/${scenario.fx.teamA1}`, {
      isActive: false,
    });
    const inactiveTeam = await respond('qr_code', T);
    expect(inactiveTeam.row).toMatchObject({ attribution_status: 'no_shift', team_id: null });

    // Atribuições anteriores permanecem; nunca há vínculo com profissional individual.
    const { rows } = await db.query<{
      id: string;
      attribution_status: string;
      team_id: string | null;
    }>('SELECT id, attribution_status, team_id FROM responses WHERE id = ANY($1)', [
      [single.id, afterCancel.id],
    ]);
    expect(rows.every((row) => row.attribution_status === 'attributed')).toBe(true);
    expect(rows.every((row) => row.team_id === scenario.fx.teamA1)).toBe(true);
    const columns = await db.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'responses'",
    );
    expect(columns.rows.map((row) => row.column_name)).not.toContain('profile_id');
  });
});
