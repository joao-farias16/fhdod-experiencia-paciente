/**
 * Cenário dos testes da ET03 (T12–T17) com PostgreSQL real: o cenário mínimo da ET02 (hospital,
 * setores A e B, pesquisas, versões e uma resposta) mais um setor inativo C e um perfil de cada
 * tipo. Os dados são confirmados (COMMIT), pois a API usa a própria conexão do Prisma; cada
 * cenário usa um hospital exclusivo, e o banco de teste é local e descartável. Registros de
 * audit_logs não podem ser apagados (somente inserção), por isso nada é excluído ao final.
 */
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/lib/logger.js';
import { createPrismaClient, type PrismaClient } from '../../src/lib/prisma.js';
import type { AuthAdmin, TokenVerifier } from '../../src/modules/auth/auth.types.js';
import { type Clock, systemClock } from '../../src/utils/clock.js';
import type { FakeSupabase } from '../fake-supabase.js';
import { ALLOWED_ORIGIN } from '../helpers.js';
import { connect, createFixture, type Db } from './support.js';

export const TEST_AUDIT_IP_SECRET = 'segredo-de-teste-do-hmac-de-ip-com-32-caracteres';

type Role = 'superadmin' | 'sector_admin' | 'management' | 'ombudsman' | 'viewer';

interface ProfileSpec {
  role: Role;
  allSectors: boolean;
  sectors: ('A' | 'B' | 'C')[];
  mustChangePassword?: boolean;
  inactive?: boolean;
}

/** Perfis do cenário. "sa" é o superadministrador do cenário mínimo da ET02. */
const PROFILES = {
  sa2: { role: 'superadmin', allSectors: true, sectors: [] },
  as: { role: 'sector_admin', allSectors: false, sectors: ['A'] },
  ge: { role: 'management', allSectors: true, sectors: [] },
  geB: { role: 'management', allSectors: false, sectors: ['B'] },
  ou: { role: 'ombudsman', allSectors: true, sectors: [] },
  vi: { role: 'viewer', allSectors: false, sectors: ['A'] },
  asEmpty: { role: 'sector_admin', allSectors: false, sectors: [] },
  asInactiveSector: { role: 'sector_admin', allSectors: false, sectors: ['C'] },
  pending: { role: 'viewer', allSectors: true, sectors: [], mustChangePassword: true },
  disabled: { role: 'viewer', allSectors: true, sectors: [], inactive: true },
} as const satisfies Record<string, ProfileSpec>;

export type UserKey = 'sa' | keyof typeof PROFILES;

export interface ScenarioUser {
  profileId: string;
  authUserId: string;
  email: string;
  role: Role;
}

export async function createAuthScenario(db: Db, fake: FakeSupabase) {
  const fx = await createFixture(db);
  const suffix = Math.random().toString(36).slice(2, 8);

  const { rows: sectorRows } = await db.query<{ id: string }>(
    `INSERT INTO sectors (hospital_id, code, name, is_active, deactivated_at)
     VALUES ($1, 'SETOR-C', 'Setor C inativo', false, now()) RETURNING id`,
    [fx.hospitalId],
  );
  const sectorC = sectorRows[0]?.id ?? '';
  const sectorIdOf = { A: fx.sectorA, B: fx.sectorB, C: sectorC };

  const { rows: saRows } = await db.query<{ auth_user_id: string; email: string }>(
    'SELECT auth_user_id, email FROM profiles WHERE id = $1',
    [fx.adminId],
  );
  const saRow = saRows[0];
  if (saRow === undefined) throw new Error('SA do cenário não encontrado.');
  const users = {
    sa: {
      profileId: fx.adminId,
      authUserId: saRow.auth_user_id,
      email: saRow.email,
      role: 'superadmin',
    },
  } as Record<UserKey, ScenarioUser>;
  fake.register(saRow.auth_user_id, saRow.email);

  for (const [key, spec] of Object.entries(PROFILES) as [keyof typeof PROFILES, ProfileSpec][]) {
    const email = `${key.toLowerCase()}.${suffix}@example.com`;
    const { rows } = await db.query<{ id: string; auth_user_id: string }>(
      `INSERT INTO profiles (hospital_id, auth_user_id, full_name, email, role, all_sectors,
         must_change_password, is_active, deactivated_at, created_by)
       VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, auth_user_id`,
      [
        fx.hospitalId,
        `Usuário Fictício ${key}`,
        email,
        spec.role,
        spec.allSectors,
        spec.mustChangePassword ?? false,
        spec.inactive !== true,
        spec.inactive === true ? new Date() : null,
        fx.adminId,
      ],
    );
    const row = rows[0];
    if (row === undefined) throw new Error(`Perfil ${key} não criado.`);
    for (const sector of spec.sectors) {
      await db.query('INSERT INTO profile_sectors (profile_id, sector_id) VALUES ($1, $2)', [
        row.id,
        sectorIdOf[sector],
      ]);
    }
    fake.register(row.auth_user_id, email);
    users[key] = { profileId: row.id, authUserId: row.auth_user_id, email, role: spec.role };
  }

  // Conta que existe no Supabase Auth, mas sem perfil na aplicação.
  const orphanAuthUserId = crypto.randomUUID();
  fake.register(orphanAuthUserId, `sem-perfil.${suffix}@example.com`);

  return {
    fx,
    sectorC,
    users,
    orphanAuthUserId,
    /** Cabeçalho Authorization com um token válido do usuário. */
    bearer: (key: UserKey) => `Bearer ${fake.token(users[key].authUserId)}`,
  };
}

export type AuthScenario = Awaited<ReturnType<typeof createAuthScenario>>;

export function buildAuthApp(
  prisma: PrismaClient,
  auth: { verifier: TokenVerifier; admin: AuthAdmin },
  clock: Clock = systemClock,
) {
  return createApp({
    env: { CORS_ORIGIN: [ALLOWED_ORIGIN], TRUST_PROXY: 0, AUDIT_IP_SECRET: TEST_AUDIT_IP_SECRET },
    logger: createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' }),
    prisma,
    auth: { verifier: auth.verifier, admin: auth.admin },
    clock,
  });
}

/** Conexões dos testes: `db` (pg, verificações diretas) e `prisma` (usado pela API). */
export async function openConnections(): Promise<{ db: Db; prisma: PrismaClient }> {
  const db = await connect();
  const prisma = createPrismaClient(process.env.TEST_DATABASE_URL ?? '');
  return { db, prisma };
}

export interface AuditRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_profile_id: string | null;
  actor_role: string | null;
  details: Record<string, unknown>;
  request_id: string | null;
  ip_hash: string | null;
}

/** Registros de auditoria de uma entidade (opcionalmente de uma ação). */
export async function auditRowsFor(db: Db, entityId: string, action?: string): Promise<AuditRow[]> {
  const { rows } = await db.query<AuditRow>(
    `SELECT id::text, action, entity_type, entity_id, actor_profile_id, actor_role::text,
            details, request_id::text, ip_hash
     FROM audit_logs WHERE entity_id = $1 AND ($2::text IS NULL OR action = $2) ORDER BY id`,
    [entityId, action ?? null],
  );
  return rows;
}

/** Negativas de autorização registradas para um autor. */
export async function deniedRowsOf(db: Db, actorProfileId: string): Promise<AuditRow[]> {
  const { rows } = await db.query<AuditRow>(
    `SELECT id::text, action, entity_type, entity_id, actor_profile_id, actor_role::text,
            details, request_id::text, ip_hash
     FROM audit_logs WHERE actor_profile_id = $1 AND action = 'AUTHORIZATION_DENIED' ORDER BY id`,
    [actorProfileId],
  );
  return rows;
}
