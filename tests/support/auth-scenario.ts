/**
 * Cenário dos testes da ET03 em diante (T12–T37) com MySQL real: o cenário mínimo da ET02
 * (hospital, setores A e B, pesquisas, versões e uma resposta) mais um setor inativo C e um perfil
 * de cada tipo, todos com a senha DEFAULT_PASSWORD (hash bcrypt real) e uma sessão já aberta
 * (token Bearer emitido pelo serviço de autenticação). Os dados são confirmados (COMMIT), pois a
 * API usa o próprio pool; cada cenário usa um hospital exclusivo e o banco de testes é recriado a
 * cada execução da suíte.
 */
import { randomUUID } from 'node:crypto';

import { createApp } from '../../src/app.js';
import type { Database } from '../../src/lib/database.js';
import { createLogger } from '../../src/lib/logger.js';
import { createSession } from '../../src/modules/auth/auth.service.js';
import type { SessionTokens } from '../../src/modules/auth/auth.types.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { type Clock, systemClock } from '../../src/utils/dates.js';
import { ALLOWED_ORIGIN, TEST_AUTH_CONFIG } from './app.js';
import { connect, createFixture, createTestDatabase, type Db } from './db.js';

export const TEST_AUDIT_IP_SECRET = 'segredo-de-teste-do-hmac-de-ip-com-32-caracteres';

/** Senha fictícia de todas as contas do cenário. */
export const DEFAULT_PASSWORD = 'SenhaInicial123'; // gitleaks:allow — senha fictícia de teste

let defaultHash: Promise<string> | undefined;
export function defaultPasswordHash(): Promise<string> {
  defaultHash ??= hashPassword(DEFAULT_PASSWORD, TEST_AUTH_CONFIG.bcryptRounds);
  return defaultHash;
}

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
  email: string;
  role: Role;
}

export async function createAuthScenario(db: Db, database: Database) {
  const fx = await createFixture(db);
  const suffix = Math.random().toString(36).slice(2, 8);
  const passwordHash = await defaultPasswordHash();

  const sectorC = randomUUID();
  await db.query(
    `INSERT INTO sectors (id, hospital_id, code, name, is_active, deactivated_at)
     VALUES (?, ?, 'SETOR-C', 'Setor C inativo', false, UTC_TIMESTAMP(3))`,
    [sectorC, fx.hospitalId],
  );
  const sectorIdOf = { A: fx.sectorA, B: fx.sectorB, C: sectorC };

  await db.query('UPDATE profiles SET password_hash = ? WHERE id = ?', [passwordHash, fx.adminId]);
  const { rows: saRows } = await db.query<{ email: string }>(
    'SELECT email FROM profiles WHERE id = ?',
    [fx.adminId],
  );
  const saEmail = saRows[0]?.email;
  if (saEmail === undefined) throw new Error('SA do cenário não encontrado.');
  const users = {
    sa: { profileId: fx.adminId, email: saEmail, role: 'superadmin' },
  } as Record<UserKey, ScenarioUser>;

  for (const [key, spec] of Object.entries(PROFILES) as [keyof typeof PROFILES, ProfileSpec][]) {
    const email = `${key.toLowerCase()}.${suffix}@example.com`;
    const id = randomUUID();
    await db.query(
      `INSERT INTO profiles (id, hospital_id, full_name, email, password_hash, role, all_sectors,
         must_change_password, is_active, deactivated_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        fx.hospitalId,
        `Usuário Fictício ${key}`,
        email,
        passwordHash,
        spec.role,
        spec.allSectors,
        spec.mustChangePassword ?? false,
        spec.inactive !== true,
        spec.inactive === true ? new Date() : null,
        fx.adminId,
      ],
    );
    for (const sector of spec.sectors) {
      await db.query('INSERT INTO profile_sectors (profile_id, sector_id) VALUES (?, ?)', [
        id,
        sectorIdOf[sector],
      ]);
    }
    users[key] = { profileId: id, email, role: spec.role };
  }

  // Uma sessão aberta por usuário (como se cada um tivesse feito login).
  const tokens = new Map<UserKey, SessionTokens>();
  const login = async (key: UserKey): Promise<SessionTokens> => {
    const session = await createSession(
      database,
      TEST_AUTH_CONFIG,
      users[key].profileId,
      new Date(),
    );
    tokens.set(key, session.tokens);
    return session.tokens;
  };
  for (const key of Object.keys(users) as UserKey[]) await login(key);

  return {
    fx,
    sectorC,
    users,
    /** Abre uma nova sessão do usuário (novo login) e passa a usá-la em `bearer`. */
    login,
    /** Tokens da sessão atual do usuário. */
    tokensOf: (key: UserKey): SessionTokens => {
      const current = tokens.get(key);
      if (current === undefined) throw new Error(`Usuário ${key} sem sessão.`);
      return current;
    },
    /** Cabeçalho Authorization com o token de acesso da sessão atual do usuário. */
    bearer: (key: UserKey) => `Bearer ${tokens.get(key)?.accessToken ?? ''}`,
  };
}

export type AuthScenario = Awaited<ReturnType<typeof createAuthScenario>>;

export function buildAuthApp(database: Database, clock: Clock = systemClock) {
  return createApp({
    env: { CORS_ORIGIN: [ALLOWED_ORIGIN], TRUST_PROXY: 0, AUDIT_IP_SECRET: TEST_AUDIT_IP_SECRET },
    logger: createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' }),
    db: database,
    auth: TEST_AUTH_CONFIG,
    clock,
  });
}

/** Conexões dos testes: `db` (verificações diretas) e `database` (pool usado pela API). */
export async function openConnections(): Promise<{ db: Db; database: Database }> {
  return { db: await connect(), database: createTestDatabase() };
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
    `SELECT CAST(id AS CHAR) AS id, action, entity_type, entity_id, actor_profile_id, actor_role,
            details, request_id, ip_hash
     FROM audit_logs WHERE entity_id = ? AND (? IS NULL OR action = ?) ORDER BY audit_logs.id`,
    [entityId, action ?? null, action ?? null],
  );
  return rows;
}

/** Negativas de autorização registradas para um autor. */
export async function deniedRowsOf(db: Db, actorProfileId: string): Promise<AuditRow[]> {
  const { rows } = await db.query<AuditRow>(
    `SELECT CAST(id AS CHAR) AS id, action, entity_type, entity_id, actor_profile_id, actor_role,
            details, request_id, ip_hash
     FROM audit_logs WHERE actor_profile_id = ? AND action = 'AUTHORIZATION_DENIED' ORDER BY audit_logs.id`,
    [actorProfileId],
  );
  return rows;
}
