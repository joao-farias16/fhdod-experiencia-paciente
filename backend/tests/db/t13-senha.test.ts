/**
 * T13 — Troca e redefinição de senha (RF03, RF04, RN28), integração com PostgreSQL real.
 * Procedimento da Seção 12: endpoint com troca pendente → 403; E05 com senha fraca → 400 e
 * válida → 204; E09 → flag e auditoria sem senha; a senha anterior deixa de autenticar.
 */
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../src/lib/prisma.js';
import { isPasswordCompliant } from '../../src/modules/auth/password-policy.js';
import { FakeSupabase } from '../fake-supabase.js';
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

async function mustChange(profileId: string): Promise<boolean> {
  const { rows } = await db.query<{ must_change_password: boolean }>(
    'SELECT must_change_password FROM profiles WHERE id = $1',
    [profileId],
  );
  return rows[0]?.must_change_password ?? false;
}

beforeAll(async () => {
  ({ db, prisma } = await openConnections());
});

beforeEach(async () => {
  // Cenário e aplicação novos por teste: o limite de E05 (5 a cada 15 min) fica isolado.
  fake = new FakeSupabase();
  scenario = await createAuthScenario(db, fake);
  app = buildAuthApp(prisma, fake);
});

afterAll(async () => {
  await prisma.$disconnect();
  await db.end();
});

describe('T13 — troca obrigatória pendente (RF04)', () => {
  it.each([
    ['E06', 'get', '/api/v1/admin/users'],
    ['E10', 'get', '/api/v1/admin/sectors'],
    ['E41', 'get', '/api/v1/admin/audit-logs'],
    ['E07', 'post', '/api/v1/admin/users'],
  ] as const)(
    '%s responde 403 PASSWORD_CHANGE_REQUIRED antes da permissão e sem efeito',
    async (_id, method, path) => {
      const before = await db.query('SELECT count(*) FROM profiles');
      const response = await request(app)
        [method](path)
        .set('Authorization', scenario.bearer('pending'))
        .send(
          method === 'post'
            ? {
                fullName: 'Nome Fictício',
                email: 'x@example.com',
                role: 'viewer',
                allSectors: true,
              }
            : undefined,
        );

      expect(response.status).toBe(403);
      expect(errorOf(response).code).toBe('PASSWORD_CHANGE_REQUIRED');
      const after = await db.query('SELECT count(*) FROM profiles');
      expect(after.rows).toEqual(before.rows);
    },
  );

  it('E04 continua acessível e informa mustChangePassword: true', async () => {
    const response = await request(app)
      .get('/api/v1/me')
      .set('Authorization', scenario.bearer('pending'));

    expect(response.status).toBe(200);
    expect(
      (response.body as { data: { mustChangePassword: boolean } }).data.mustChangePassword,
    ).toBe(true);
  });
});

describe('T13 — E05 POST /api/v1/me/password', () => {
  it.each([
    ['curta (9 caracteres)', 'Abcdefg12'],
    ['sem números', 'SomenteLetras'],
    ['sem letras', '12345678901'],
    ['longa (73 caracteres)', `A1${'b'.repeat(71)}`],
    ['vazia', ''],
  ])('senha fraca %s → 400 VALIDATION_ERROR sem gravar nada', async (_case, newPassword) => {
    const response = await request(app)
      .post('/api/v1/me/password')
      .set('Authorization', scenario.bearer('pending'))
      .send({ newPassword });

    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('VALIDATION_ERROR');
    expect(errorOf(response).details[0]?.field).toBe('newPassword');
    if (newPassword !== '') expect(response.text).not.toContain(newPassword);
    expect(await mustChange(scenario.users.pending.profileId)).toBe(true);
    expect(
      await auditRowsFor(db, scenario.users.pending.profileId, 'PASSWORD_CHANGED'),
    ).toHaveLength(0);
    expect(fake.calls.filter((call) => call.operation === 'updatePassword')).toHaveLength(0);
  });

  it('rejeita campos desconhecidos e corpo ausente (Zod estrito)', async () => {
    const extra = await request(app)
      .post('/api/v1/me/password')
      .set('Authorization', scenario.bearer('pending'))
      .send({ newPassword: 'SenhaValida123', currentPassword: 'x' });
    expect(extra.status).toBe(400);
    expect(errorOf(extra).details).toContainEqual({
      field: 'currentPassword',
      message: 'Campo não permitido.',
    });

    const empty = await request(app)
      .post('/api/v1/me/password')
      .set('Authorization', scenario.bearer('pending'));
    expect(empty.status).toBe(400);
  });

  it('senha válida → 204; atualiza o Supabase, libera o acesso e audita sem a senha', async () => {
    const newPassword = 'NovaSenhaSegura2026'; // gitleaks:allow — senha fictícia de teste
    const response = await request(app)
      .post('/api/v1/me/password')
      .set('Authorization', scenario.bearer('pending'))
      .send({ newPassword });

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(await mustChange(scenario.users.pending.profileId)).toBe(false);
    expect(fake.users.get(scenario.users.pending.authUserId)?.password).toBe(newPassword);

    const audit = await auditRowsFor(db, scenario.users.pending.profileId, 'PASSWORD_CHANGED');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor_profile_id: scenario.users.pending.profileId,
      actor_role: 'viewer',
      details: { mandatory: true },
    });
    expect(JSON.stringify(audit)).not.toContain(newPassword);

    // Na requisição seguinte, a rota antes bloqueada (E10, permitida ao VI) responde 200.
    const next = await request(app)
      .get('/api/v1/admin/sectors')
      .set('Authorization', scenario.bearer('pending'));
    expect(next.status).toBe(200);
  });

  it('troca voluntária é permitida (mandatory: false)', async () => {
    const response = await request(app)
      .post('/api/v1/me/password')
      .set('Authorization', scenario.bearer('ge'))
      .send({ newPassword: 'TrocaVoluntaria99' });

    expect(response.status).toBe(204);
    const audit = await auditRowsFor(db, scenario.users.ge.profileId, 'PASSWORD_CHANGED');
    expect(audit.map((row) => row.details)).toEqual([{ mandatory: false }]);
  });

  it('falha no Supabase Auth desfaz a transação (flag e auditoria preservadas) → 503', async () => {
    fake.failNext('updatePassword');
    const response = await request(app)
      .post('/api/v1/me/password')
      .set('Authorization', scenario.bearer('pending'))
      .send({ newPassword: 'NovaSenhaSegura2026' }); // gitleaks:allow — senha fictícia de teste

    expect(response.status).toBe(503);
    expect(await mustChange(scenario.users.pending.profileId)).toBe(true);
    expect(
      await auditRowsFor(db, scenario.users.pending.profileId, 'PASSWORD_CHANGED'),
    ).toHaveLength(0);
  });

  it('limita E05 a 5 tentativas a cada 15 minutos por perfil (429 com Retry-After)', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(app)
        .post('/api/v1/me/password')
        .set('Authorization', scenario.bearer('ge'))
        .send({ newPassword: 'curta' });
      expect(response.status).toBe(400);
    }
    const blocked = await request(app)
      .post('/api/v1/me/password')
      .set('Authorization', scenario.bearer('ge'))
      .send({ newPassword: 'curta' });
    expect(blocked.status).toBe(429);
    expect(errorOf(blocked).code).toBe('RATE_LIMITED');
    expect(blocked.headers['retry-after']).toBeDefined();

    // O limite é por perfil: outro usuário não é afetado.
    const other = await request(app)
      .post('/api/v1/me/password')
      .set('Authorization', scenario.bearer('ou'))
      .send({ newPassword: 'curta' });
    expect(other.status).toBe(400);
  });
});

describe('T13 — E09 POST /api/v1/admin/users/:id/reset-password (RF03)', () => {
  it('gera senha temporária de 16 caracteres, marca a troca e audita sem a senha', async () => {
    const target = scenario.users.ou;
    const oldPassword = fake.users.get(target.authUserId)?.password ?? '';
    expect(fake.signIn(target.email, oldPassword)).not.toBeNull();

    const response = await request(app)
      .post(`/api/v1/admin/users/${target.profileId}/reset-password`)
      .set('Authorization', scenario.bearer('sa'));

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const { temporaryPassword } = (response.body as { data: { temporaryPassword: string } }).data;
    expect(temporaryPassword).toHaveLength(16);
    expect(isPasswordCompliant(temporaryPassword)).toBe(true);

    expect(await mustChange(target.profileId)).toBe(true);
    // A senha anterior deixa de autenticar; a temporária autentica.
    expect(fake.signIn(target.email, oldPassword)).toBeNull();
    expect(fake.signIn(target.email, temporaryPassword)).not.toBeNull();

    const audit = await auditRowsFor(db, target.profileId, 'USER_PASSWORD_RESET');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor_profile_id: scenario.users.sa.profileId,
      details: { changeRequired: true },
    });
    const allAudit = await auditRowsFor(db, target.profileId);
    expect(JSON.stringify(allAudit)).not.toContain(temporaryPassword);
  });

  it('cada redefinição gera uma senha diferente (CSPRNG)', async () => {
    const passwords = new Set<string>();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await request(app)
        .post(`/api/v1/admin/users/${scenario.users.vi.profileId}/reset-password`)
        .set('Authorization', scenario.bearer('sa'));
      passwords.add(
        (response.body as { data: { temporaryPassword: string } }).data.temporaryPassword,
      );
    }
    expect(passwords.size).toBe(3);
  });

  it('fluxo completo: usuário entra com a temporária, só E04/E05 respondem, troca e volta a usar', async () => {
    const target = scenario.users.as;
    const reset = await request(app)
      .post(`/api/v1/admin/users/${target.profileId}/reset-password`)
      .set('Authorization', scenario.bearer('sa'));
    const { temporaryPassword } = (reset.body as { data: { temporaryPassword: string } }).data;

    // Espera virar o segundo, pois o iat do token tem precisão de segundos.
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const token = fake.signIn(target.email, temporaryPassword);
    expect(token).not.toBeNull();
    const auth = `Bearer ${token ?? ''}`;

    expect(
      (await request(app).get('/api/v1/admin/sectors').set('Authorization', auth)).status,
    ).toBe(403);
    expect((await request(app).get('/api/v1/me').set('Authorization', auth)).status).toBe(200);
    const change = await request(app)
      .post('/api/v1/me/password')
      .set('Authorization', auth)
      .send({ newPassword: 'MinhaSenhaNova321' }); // gitleaks:allow — senha fictícia de teste
    expect(change.status).toBe(204);
    expect(
      (await request(app).get('/api/v1/admin/sectors').set('Authorization', auth)).status,
    ).toBe(200);
  });

  it('sessão anterior à redefinição não consegue concluir a troca obrigatória (401)', async () => {
    const target = scenario.users.geB;
    const oldSession = scenario.bearer('geB');
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await request(app)
      .post(`/api/v1/admin/users/${target.profileId}/reset-password`)
      .set('Authorization', scenario.bearer('sa'))
      .expect(200);

    const response = await request(app)
      .post('/api/v1/me/password')
      .set('Authorization', oldSession)
      .send({ newPassword: 'TentativaIndevida1' });

    expect(response.status).toBe(401);
    expect(await mustChange(target.profileId)).toBe(true);
  });

  it('redefinir a própria senha → 422 SELF_MODIFICATION_FORBIDDEN', async () => {
    const response = await request(app)
      .post(`/api/v1/admin/users/${scenario.users.sa.profileId}/reset-password`)
      .set('Authorization', scenario.bearer('sa'));

    expect(response.status).toBe(422);
    expect(errorOf(response).code).toBe('SELF_MODIFICATION_FORBIDDEN');
    expect(await auditRowsFor(db, scenario.users.sa.profileId, 'USER_PASSWORD_RESET')).toHaveLength(
      0,
    );
  });

  it('usuário inativo → 422 USER_INACTIVE; inexistente → 404; id inválido → 400', async () => {
    const inactive = await request(app)
      .post(`/api/v1/admin/users/${scenario.users.disabled.profileId}/reset-password`)
      .set('Authorization', scenario.bearer('sa'));
    expect(inactive.status).toBe(422);
    expect(errorOf(inactive).code).toBe('USER_INACTIVE');

    const missing = await request(app)
      .post(`/api/v1/admin/users/${crypto.randomUUID()}/reset-password`)
      .set('Authorization', scenario.bearer('sa'));
    expect(missing.status).toBe(404);

    const invalid = await request(app)
      .post('/api/v1/admin/users/nao-e-uuid/reset-password')
      .set('Authorization', scenario.bearer('sa'));
    expect(invalid.status).toBe(400);
  });

  it('falha no Supabase Auth: nada é marcado nem auditado (503)', async () => {
    fake.failNext('updatePassword');
    const response = await request(app)
      .post(`/api/v1/admin/users/${scenario.users.ou.profileId}/reset-password`)
      .set('Authorization', scenario.bearer('sa'));

    expect(response.status).toBe(503);
    expect(response.text).not.toMatch(/temporaryPassword/);
    expect(await mustChange(scenario.users.ou.profileId)).toBe(false);
    expect(await auditRowsFor(db, scenario.users.ou.profileId, 'USER_PASSWORD_RESET')).toHaveLength(
      0,
    );
  });
});
