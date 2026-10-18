/**
 * T16 — Bloqueio de conta desativada (RF09, RN11, RN24), integração com PostgreSQL real.
 * Procedimento da Seção 12: desativar usuário com token válido → 403 ACCOUNT_DISABLED; desativar a
 * si ou o último SA → 422. Também: histórico mantido, reativação e compensação no Supabase Auth.
 */
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../src/lib/prisma.js';
import { DEFAULT_PASSWORD, FakeSupabase } from '../fake-supabase.js';
import { errorOf } from '../helpers.js';
import {
  type AuthScenario,
  auditRowsFor,
  buildAuthApp,
  createAuthScenario,
  openConnections,
} from './auth-support.js';
import type { Db } from './support.js';

let db: Db;
let prisma: PrismaClient;
let fake: FakeSupabase;
let scenario: AuthScenario;
let app: ReturnType<typeof buildAuthApp>;

beforeAll(async () => {
  ({ db, prisma } = await openConnections());
});

beforeEach(async () => {
  fake = new FakeSupabase();
  scenario = await createAuthScenario(db, fake);
  app = buildAuthApp(prisma, fake);
});

afterAll(async () => {
  await prisma.$disconnect();
  await db.end();
});

const setActive = (id: string, isActive: boolean, actor: 'sa' | 'sa2' = 'sa') =>
  request(app)
    .patch(`/api/v1/admin/users/${id}`)
    .set('Authorization', scenario.bearer(actor))
    .send({ isActive });

async function profileRow(id: string) {
  const { rows } = await db.query<{
    is_active: boolean;
    deactivated_at: Date | null;
    deactivated_by: string | null;
    full_name: string;
    email: string;
  }>(
    'SELECT is_active, deactivated_at, deactivated_by, full_name, email FROM profiles WHERE id = $1',
    [id],
  );
  return rows[0];
}

describe('T16 — desativação com token ainda válido', () => {
  it('a requisição seguinte do usuário recebe 403 ACCOUNT_DISABLED', async () => {
    const target = scenario.users.ge;
    const token = scenario.bearer('ge');
    expect((await request(app).get('/api/v1/me').set('Authorization', token)).status).toBe(200);

    const response = await setActive(target.profileId, false);
    expect(response.status).toBe(200);
    expect(
      (response.body as { data: { isActive: boolean; deactivatedAt: string } }).data,
    ).toMatchObject({
      isActive: false,
      deactivatedAt: expect.any(String) as string,
    });

    for (const path of ['/api/v1/me', '/api/v1/admin/sectors']) {
      const next = await request(app).get(path).set('Authorization', token);
      expect(next.status).toBe(403);
      expect(errorOf(next).code).toBe('ACCOUNT_DISABLED');
    }
    // Bloqueio também no Supabase Auth (ban_duration): sem login nem renovação.
    expect(fake.users.get(target.authUserId)?.banned).toBe(true);
    expect(fake.signIn(target.email, DEFAULT_PASSWORD)).toBeNull();
  });

  it('mesmo sem o bloqueio no Supabase, o perfil inativo é recusado a cada requisição', async () => {
    const target = scenario.users.ou;
    await setActive(target.profileId, false).expect(200);
    fake.setBannedState(target.authUserId, false); // simula bloqueio ainda não propagado

    const next = await request(app).get('/api/v1/me').set('Authorization', scenario.bearer('ou'));
    expect(next.status).toBe(403);
    expect(errorOf(next).code).toBe('ACCOUNT_DISABLED');
  });

  it('o histórico permanece: perfil, vínculos, autoria e auditoria (sem exclusão física)', async () => {
    const target = scenario.users.as;
    await setActive(target.profileId, false).expect(200);

    const row = await profileRow(target.profileId);
    expect(row).toMatchObject({
      is_active: false,
      deactivated_by: scenario.users.sa.profileId,
      email: target.email,
    });
    expect(row?.deactivated_at).toBeInstanceOf(Date);
    const links = await db.query('SELECT 1 FROM profile_sectors WHERE profile_id = $1', [
      target.profileId,
    ]);
    expect(links.rowCount).toBe(1);
    const audit = await auditRowsFor(db, target.profileId, 'USER_DEACTIVATED');
    expect(audit).toHaveLength(1);
    expect(audit[0]?.details).toEqual({ changedFields: ['isActive'] });

    // Aparece na lista de usuários filtrada por inativos.
    const list = await request(app)
      .get('/api/v1/admin/users?isActive=false')
      .set('Authorization', scenario.bearer('sa'));
    expect((list.body as { data: { id: string }[] }).data.map((u) => u.id)).toContain(
      target.profileId,
    );
  });
});

describe('T16 — regras de desativação (RN24)', () => {
  it('desativar a própria conta → 422 SELF_MODIFICATION_FORBIDDEN (havendo outro SA)', async () => {
    const response = await setActive(scenario.users.sa.profileId, false);
    expect(response.status).toBe(422);
    expect(errorOf(response).code).toBe('SELF_MODIFICATION_FORBIDDEN');
    expect((await profileRow(scenario.users.sa.profileId))?.is_active).toBe(true);
  });

  it('desativar o último SA ativo → 422 LAST_SUPERADMIN', async () => {
    // Deixa "sa" como único SA ativo do hospital.
    await setActive(scenario.users.sa2.profileId, false).expect(200);

    const response = await setActive(scenario.users.sa.profileId, false);
    expect(response.status).toBe(422);
    expect(errorOf(response).code).toBe('LAST_SUPERADMIN');
    expect((await profileRow(scenario.users.sa.profileId))?.is_active).toBe(true);
    expect(await auditRowsFor(db, scenario.users.sa.profileId, 'USER_DEACTIVATED')).toHaveLength(0);
  });

  it('rebaixar o último SA ativo também é recusado (422 LAST_SUPERADMIN)', async () => {
    await setActive(scenario.users.sa2.profileId, false).expect(200);
    const response = await request(app)
      .patch(`/api/v1/admin/users/${scenario.users.sa.profileId}`)
      .set('Authorization', scenario.bearer('sa'))
      .send({ role: 'management' });
    expect(response.status).toBe(422);
    expect(errorOf(response).code).toBe('LAST_SUPERADMIN');
  });

  it('dois SA desativando um ao outro ao mesmo tempo: sempre resta um SA ativo', async () => {
    const [first, second] = await Promise.all([
      setActive(scenario.users.sa2.profileId, false, 'sa'),
      setActive(scenario.users.sa.profileId, false, 'sa2'),
    ]);
    const statuses = [first.status, second.status];
    expect(statuses).toContain(200);
    const { rows } = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM profiles WHERE hospital_id = $1 AND role = 'superadmin' AND is_active",
      [scenario.fx.hospitalId],
    );
    expect(rows[0]?.n).toBe(1);
  });
});

describe('T16 — reativação e consistência com o Supabase Auth', () => {
  it('reativação libera o acesso na requisição seguinte e remove o bloqueio', async () => {
    const target = scenario.users.vi;
    await setActive(target.profileId, false).expect(200);
    expect(
      (await request(app).get('/api/v1/me').set('Authorization', scenario.bearer('vi'))).status,
    ).toBe(403);

    const response = await setActive(target.profileId, true);
    expect(response.status).toBe(200);
    expect(await profileRow(target.profileId)).toMatchObject({
      is_active: true,
      deactivated_at: null,
      deactivated_by: null,
    });
    expect(fake.users.get(target.authUserId)?.banned).toBe(false);
    expect(
      (await request(app).get('/api/v1/me').set('Authorization', scenario.bearer('vi'))).status,
    ).toBe(200);

    const actions = (await auditRowsFor(db, target.profileId)).map((row) => row.action);
    expect(actions).toEqual(['USER_DEACTIVATED', 'USER_REACTIVATED']);
  });

  it('falha ao bloquear no Supabase Auth desfaz a desativação (503, nada gravado)', async () => {
    const target = scenario.users.ge;
    fake.failNext('setBanned');

    const response = await setActive(target.profileId, false);

    expect(response.status).toBe(503);
    expect((await profileRow(target.profileId))?.is_active).toBe(true);
    expect(await auditRowsFor(db, target.profileId)).toHaveLength(0);
    expect(
      (await request(app).get('/api/v1/me').set('Authorization', scenario.bearer('ge'))).status,
    ).toBe(200);
  });

  it('repetir a desativação de quem já está inativo não gera novo registro', async () => {
    const response = await setActive(scenario.users.disabled.profileId, false);
    expect(response.status).toBe(200);
    expect(await auditRowsFor(db, scenario.users.disabled.profileId)).toHaveLength(0);
    expect(fake.calls.filter((call) => call.operation === 'setBanned')).toHaveLength(0);
  });

  it('o e-mail é imutável (campo desconhecido no PATCH → 400)', async () => {
    const response = await request(app)
      .patch(`/api/v1/admin/users/${scenario.users.vi.profileId}`)
      .set('Authorization', scenario.bearer('sa'))
      .send({ email: 'novo@example.com' });
    expect(response.status).toBe(400);
    expect(errorOf(response).details).toContainEqual({
      field: 'email',
      message: 'Campo não permitido.',
    });
    expect((await profileRow(scenario.users.vi.profileId))?.email).toBe(scenario.users.vi.email);
  });
});
