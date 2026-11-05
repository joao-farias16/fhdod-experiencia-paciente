/**
 * Verificações do modelo de dados com MySQL real (ET02, migrado na Etapa 3): estrutura (tabelas,
 * ENUM, tipos, chaves estrangeiras), privilégios do usuário da aplicação, CHECK, chaves únicas
 * (inclusive as "parciais" por coluna gerada e o índice funcional), gatilhos de imutabilidade,
 * coerência, anonimato e protocolo. Tudo roda em transações desfeitas ao final.
 */
import { randomUUID } from 'node:crypto';

import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  connect,
  constraintOf,
  count,
  createFixture,
  type Db,
  dt,
  expectDbError,
  HASH,
  inRollback,
  insertManifestation,
  insertResponse,
  PASSWORD_HASH,
  testDatabaseEnv,
} from '../support/db.js';

const TABLES = [
  'audit_logs',
  'auth_sessions',
  'hospitals',
  'journey_stages',
  'manifestation_contacts',
  'manifestation_notes',
  'manifestation_protocol_sequence',
  'manifestations',
  'profile_sectors',
  'profiles',
  'questions',
  'response_answers',
  'responses',
  'schema_migrations',
  'sectors',
  'shift_imports',
  'shifts',
  'survey_configs',
  'survey_version_questions',
  'survey_versions',
  'teams',
];

const CHECK = 'ER_CHECK_CONSTRAINT_VIOLATED';
const TRIGGER = 'ER_SIGNAL_EXCEPTION';
const UNIQUE = 'ER_DUP_ENTRY';
const FOREIGN_KEY = 'ER_NO_REFERENCED_ROW_2';

let db: Db;

beforeAll(async () => {
  db = await connect();
});

afterAll(async () => {
  await db.end();
});

describe('estrutura do banco MySQL', () => {
  it('possui as 18 tabelas da Tabela 17, as sessões, o contador do protocolo e o controle das migrations', async () => {
    const { rows } = await db.query<{ name: string }>(
      `SELECT table_name AS name FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name`,
    );
    expect(rows.map((row) => row.name)).toEqual(TABLES);
    const { rows: engines } = await db.query<{ engine: string; collation: string }>(
      `SELECT DISTINCT engine AS engine, table_collation AS collation FROM information_schema.tables
       WHERE table_schema = DATABASE()`,
    );
    expect(engines).toEqual([{ engine: 'InnoDB', collation: 'utf8mb4_0900_as_cs' }]);
  });

  it('define os domínios da Tabela 16 como ENUM, com os valores na ordem do PDF', async () => {
    const { rows } = await db.query<{ table_name: string; column_name: string; type: string }>(
      `SELECT table_name AS table_name, column_name AS column_name, column_type AS type FROM information_schema.columns
       WHERE table_schema = DATABASE() AND data_type = 'enum'`,
    );
    const typeOf = (table: string, column: string) =>
      rows.find((row) => row.table_name === table && row.column_name === column)?.type;
    expect(typeOf('questions', 'type')).toBe("enum('nps','scale_1_5')");
    expect(typeOf('responses', 'attribution_status')).toBe(
      "enum('attributed','not_qr_origin','no_shift','ambiguous')",
    );
    expect(typeOf('profiles', 'role')).toBe(
      "enum('superadmin','sector_admin','management','ombudsman','viewer')",
    );
    expect(typeOf('audit_logs', 'actor_role')).toBe(typeOf('profiles', 'role'));
    expect(typeOf('responses', 'origin')).toBe("enum('qr_code','link')");
    expect(typeOf('shifts', 'period')).toBe("enum('morning','afternoon','night')");
    expect(typeOf('responses', 'shift_period')).toBe(typeOf('shifts', 'period'));
    expect(typeOf('shifts', 'source')).toBe("enum('manual','import')");
    expect(typeOf('shift_imports', 'status')).toBe("enum('validated','rejected','committed')");
    expect(typeOf('manifestations', 'type')).toBe("enum('compliment','complaint','suggestion')");
    expect(typeOf('manifestations', 'status')).toBe(
      "enum('received','in_review','forwarded','resolved','archived')",
    );
    expect(typeOf('manifestations', 'priority')).toBe("enum('low','medium','high')");
    expect(typeOf('manifestation_notes', 'kind')).toBe(
      "enum('created','status_changed','priority_changed','actions_updated','note','contact_deleted')",
    );
  });

  it('usa UUID em CHAR(36) com DEFAULT (UUID()) e audit_logs.id como BIGINT autoincremento', async () => {
    const { rows } = await db.query<{
      table_name: string;
      column_type: string;
      column_default: string | null;
      extra: string;
    }>(
      `SELECT table_name AS table_name, column_type AS column_type, column_default AS column_default, extra AS extra FROM information_schema.columns
       WHERE table_schema = DATABASE() AND column_name = 'id'
         AND table_name NOT IN ('manifestation_protocol_sequence')`,
    );
    for (const row of rows) {
      if (row.table_name === 'audit_logs') {
        expect(row).toMatchObject({ column_type: 'bigint unsigned', extra: 'auto_increment' });
      } else {
        expect(row.column_type).toBe('char(36)');
        expect(row.column_default).toBe('uuid()');
      }
    }
    // profile_sectors e manifestation_contacts têm PK sem coluna id.
    expect(rows).toHaveLength(17);
  });

  it('armazena todos os instantes como DATETIME(3) (UTC)', async () => {
    const wrong = await count(
      db,
      `SELECT COUNT(*) FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND (column_name LIKE '%\\_at' OR column_name LIKE '%\\_at\\_%')
         AND NOT (data_type = 'datetime' AND datetime_precision = 3)`,
    );
    expect(wrong).toBe(0);
  });

  it('usa CASCADE somente nas dependências subordinadas e RESTRICT nas demais FKs', async () => {
    const { rows } = await db.query<{ name: string; delete_rule: string; update_rule: string }>(
      `SELECT constraint_name AS name, delete_rule AS delete_rule, update_rule AS update_rule
       FROM information_schema.referential_constraints
       WHERE constraint_schema = DATABASE() ORDER BY constraint_name`,
    );
    const cascade = rows.filter((row) => row.delete_rule === 'CASCADE').map((row) => row.name);
    expect(cascade.sort()).toEqual([
      'auth_sessions_profile_id_fkey',
      'manifestation_contacts_manifestation_id_fkey',
      'manifestation_notes_manifestation_id_fkey',
      'profile_sectors_profile_id_fkey',
      'response_answers_response_id_survey_version_id_fkey',
    ]);
    expect(
      rows
        .filter((row) => row.delete_rule !== 'CASCADE')
        .every((row) => row.delete_rule === 'RESTRICT'),
    ).toBe(true);
    expect(rows.every((row) => row.update_rule === 'RESTRICT')).toBe(true);
  });

  it('registra todas as migrations do repositório em schema_migrations', async () => {
    const { readMigrations } = await import('../../scripts/db/migrations.js');
    const { rows } = await db.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations ORDER BY version',
    );
    expect(rows).toEqual(
      readMigrations().map((file) => ({ version: file.version, checksum: file.checksum })),
    );
  });
});

describe('privilégios do usuário da aplicação (database/seguranca/usuarios.sql)', () => {
  it('com SELECT/INSERT/UPDATE/DELETE, não consegue TRUNCATE nem DROP (audit_logs fica preservada)', async (context) => {
    const env = testDatabaseEnv();
    const user = 'fhdod_app_teste';
    const password = `Teste-${randomUUID()}`;
    try {
      await db.query(`DROP USER IF EXISTS '${user}'@'%'`);
      await db.query(`CREATE USER '${user}'@'%' IDENTIFIED BY ?`, [password]);
      await db.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${env.DB_NAME}\`.* TO '${user}'@'%'`,
      );
    } catch (error) {
      context.skip(`Sem permissão para criar usuários neste servidor (${String(error)}).`);
      return;
    }
    const app = await mysql.createConnection({
      host: env.DB_HOST,
      port: env.DB_PORT,
      user,
      password,
      database: env.DB_NAME,
    });
    try {
      await app.query('START TRANSACTION');
      await app.query(
        "INSERT INTO audit_logs (action, entity_type) VALUES ('SECTOR_CREATED', 'sector')",
      );
      await app.query('ROLLBACK');
      for (const statement of ['TRUNCATE audit_logs', 'DROP TABLE audit_logs']) {
        await expect(app.query(statement)).rejects.toMatchObject({
          code: 'ER_TABLEACCESS_DENIED_ERROR',
        });
      }
    } finally {
      await app.end();
      await db.query(`DROP USER IF EXISTS '${user}'@'%'`);
    }
  });
});

describe('auditoria somente de inserção (RF10)', () => {
  it('aceita INSERT e rejeita UPDATE e DELETE em audit_logs; IP só como HMAC', async () => {
    await inRollback(db, async () => {
      await db.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, details)
         VALUES ('SECTOR_CREATED', 'sector', 'abc', '{"campos": ["name"]}')`,
      );
      const { rows } = await db.query<{ id: number }>('SELECT LAST_INSERT_ID() AS id');
      const id = rows[0]?.id;
      expect(id).toBeGreaterThan(0);
      await expectDbError(db, "UPDATE audit_logs SET action = 'X' WHERE id = ?", [id], {
        code: TRIGGER,
        constraint: 'audit_logs_insert_only',
      });
      await expectDbError(db, 'DELETE FROM audit_logs WHERE id = ?', [id], {
        code: TRIGGER,
        constraint: 'audit_logs_insert_only',
      });
      await expectDbError(
        db,
        "INSERT INTO audit_logs (action, entity_type, ip_hash) VALUES ('X', 'y', '127.0.0.1')",
        [],
        { code: CHECK, constraint: 'audit_logs_ip_hash_format' },
      );
      await expectDbError(
        db,
        "INSERT INTO audit_logs (action, entity_type, details) VALUES ('X', 'y', '[1]')",
        [],
        { code: CHECK, constraint: 'audit_logs_details_object' },
      );
      expect(await count(db, 'SELECT COUNT(*) FROM audit_logs WHERE id = ?', [id])).toBe(1);
    });
  });
});

describe('imutabilidade de perguntas, versões e respostas', () => {
  it('bloqueia texto, tipo e etapa de pergunta publicada, mas permite desativá-la', async () => {
    await inRollback(db, async () => {
      const fx = await createFixture(db);
      await expectDbError(
        db,
        "UPDATE questions SET text = 'Novo texto?' WHERE id = ?",
        [fx.specificA],
        {
          code: TRIGGER,
          constraint: 'questions_locked_after_publication',
        },
      );
      await expectDbError(
        db,
        'UPDATE questions SET journey_stage_id = NULL WHERE id = ?',
        [fx.specificA],
        {
          code: TRIGGER,
          constraint: 'questions_locked_after_publication',
        },
      );
      await db.query('UPDATE questions SET is_active = false WHERE id = ?', [fx.specificA]);
      await expectDbError(db, 'UPDATE questions SET is_active = false WHERE id = ?', [fx.npsA], {
        code: CHECK,
        constraint: 'questions_nps_always_active',
      });
    });
  });

  it('impede alterar ou excluir perguntas de versão e versões publicadas', async () => {
    await inRollback(db, async () => {
      const fx = await createFixture(db);
      await expectDbError(
        db,
        "UPDATE survey_version_questions SET text = 'x' WHERE id = ?",
        [fx.svqA1Specific],
        {
          code: TRIGGER,
          constraint: 'svq_immutable',
        },
      );
      await expectDbError(
        db,
        'DELETE FROM survey_version_questions WHERE id = ?',
        [fx.svqA1Specific],
        {
          code: TRIGGER,
          constraint: 'svq_immutable',
        },
      );
      await expectDbError(
        db,
        "UPDATE survey_versions SET title = 'Outro' WHERE id = ?",
        [fx.versionA1],
        {
          code: TRIGGER,
          constraint: 'survey_versions_immutable',
        },
      );
      await expectDbError(db, 'DELETE FROM survey_versions WHERE id = ?', [fx.versionA1], {
        code: TRIGGER,
        constraint: 'survey_versions_no_delete',
      });
      // superseded_at é preenchido uma única vez.
      await db.query(
        "UPDATE survey_versions SET superseded_at = '2026-08-20 00:00:00' WHERE id = ?",
        [fx.versionA1],
      );
      await expectDbError(
        db,
        "UPDATE survey_versions SET superseded_at = '2026-08-21 00:00:00' WHERE id = ?",
        [fx.versionA1],
        {
          code: TRIGGER,
          constraint: 'survey_versions_immutable',
        },
      );
    });
  });

  it('exige que a pergunta da versão seja da mesma pesquisa e do mesmo tipo', async () => {
    await inRollback(db, async () => {
      const fx = await createFixture(db);
      const { rows } = await db.query<{ id: string }>(
        "SELECT id FROM questions WHERE survey_config_id = ? AND type = 'scale_1_5'",
        [fx.surveyB],
      );
      await expectDbError(
        db,
        `INSERT INTO survey_version_questions (survey_version_id, question_id, type, text, journey_stage_id,
           journey_stage_name, journey_stage_position, position, is_required)
         VALUES (?, ?, 'scale_1_5', 'x', ?, 'Recepção', 1, 9, false)`,
        [fx.versionA2, rows[0]?.id, fx.stageId],
        { code: TRIGGER, constraint: 'svq_question_same_survey' },
      );
    });
  });

  it('impede alterar respostas e notas; permite registrar o uso do token uma única vez', async () => {
    await inRollback(db, async () => {
      const fx = await createFixture(db);
      await expectDbError(db, 'UPDATE responses SET nps_score = 10 WHERE id = ?', [fx.responseA1], {
        code: TRIGGER,
        constraint: 'responses_immutable',
      });
      await expectDbError(
        db,
        'UPDATE responses SET sector_id = ? WHERE id = ?',
        [fx.sectorB, fx.responseA1],
        {
          code: TRIGGER,
          constraint: 'responses_immutable',
        },
      );
      await db.query(
        "UPDATE responses SET manifestation_token_used_at = '2026-09-01 12:05:00' WHERE id = ?",
        [fx.responseA1],
      );
      await expectDbError(
        db,
        "UPDATE responses SET manifestation_token_used_at = '2026-09-01 12:06:00' WHERE id = ?",
        [fx.responseA1],
        { code: TRIGGER, constraint: 'responses_immutable' },
      );
      await db.query(
        `INSERT INTO response_answers (response_id, survey_version_id, survey_version_question_id, question_type, score)
         VALUES (?, ?, ?, 'scale_1_5', 2)`,
        [fx.responseA1, fx.versionA1, fx.svqA1Specific],
      );
      await expectDbError(
        db,
        'UPDATE response_answers SET score = 5 WHERE response_id = ?',
        [fx.responseA1],
        {
          code: TRIGGER,
          constraint: 'response_answers_immutable',
        },
      );
    });
  });
});

describe('pesquisas: versão vigente e bloqueios após publicação (RN27)', () => {
  it('exige versão vigente da própria pesquisa e bloqueia slug e setor publicados', async () => {
    await inRollback(db, async () => {
      const fx = await createFixture(db);
      await expectDbError(
        db,
        'UPDATE survey_configs SET current_version_id = ? WHERE id = ?',
        [fx.versionB1, fx.surveyA],
        {
          code: TRIGGER,
          constraint: 'survey_configs_current_version_same_survey',
        },
      );
      await expectDbError(
        db,
        "UPDATE survey_configs SET slug = 'novo-slug' WHERE id = ?",
        [fx.surveyA],
        {
          code: TRIGGER,
          constraint: 'survey_configs_locked_after_publication',
        },
      );
      await expectDbError(
        db,
        'UPDATE survey_configs SET sector_id = ? WHERE id = ?',
        [fx.sectorB, fx.surveyA],
        {
          code: TRIGGER,
          constraint: 'survey_configs_locked_after_publication',
        },
      );
      await db.query("UPDATE survey_configs SET title = 'Título editável' WHERE id = ?", [
        fx.surveyA,
      ]);
      await expectDbError(
        db,
        `INSERT INTO survey_configs (sector_id, title, slug, thank_you_message, created_by)
         VALUES (?, 'Pesquisa', 'Slug Invalido', 'Obrigado.', ?)`,
        [fx.sectorB, fx.adminId],
        { code: CHECK, constraint: 'survey_configs_slug_kebab_case' },
      );
    });
  });

  it('aceita uma única pergunta geral (nps) por pesquisa e por versão (coluna gerada única)', async () => {
    await inRollback(db, async () => {
      const fx = await createFixture(db);
      await expectDbError(
        db,
        "INSERT INTO questions (survey_config_id, type, text, is_required, position) VALUES (?, 'nps', 'Outra geral?', true, 5)",
        [fx.surveyA],
        { code: UNIQUE, constraint: 'questions_one_nps_per_survey_key' },
      );
      // Várias perguntas específicas são aceitas (a coluna gerada fica NULL para elas).
      await db.query(
        "INSERT INTO questions (survey_config_id, journey_stage_id, type, text, is_required, position) VALUES (?, ?, 'scale_1_5', 'Mais uma?', false, 6)",
        [fx.surveyA, fx.stageId],
      );
      await db.query(
        "INSERT INTO questions (survey_config_id, journey_stage_id, type, text, is_required, position) VALUES (?, ?, 'scale_1_5', 'E outra?', false, 7)",
        [fx.surveyA, fx.stageId],
      );
      await expectDbError(
        db,
        `INSERT INTO survey_version_questions (survey_version_id, question_id, type, text, position, is_required)
         VALUES (?, ?, 'nps', 'Geral duplicada', 7, true)`,
        [fx.versionA1, fx.npsA],
        { code: UNIQUE },
      );
    });
  });
});

describe('regras de domínio por CHECK', () => {
  const PROFILE = `INSERT INTO profiles (hospital_id, full_name, email, password_hash, role, all_sectors`;
  const RESPONSE = `INSERT INTO responses (survey_version_id, sector_id, origin, nps_score, low_score, submitted_at, attribution_status, idempotency_key, request_hash, manifestation_token_expires_at)`;
  const IMPORT = `INSERT INTO shift_imports (uploaded_by, file_name, file_sha256, status, total_rows, accepted_rows, rejected_rows, expires_at)`;
  const SHIFT = `INSERT INTO shifts (sector_id, team_id, period, starts_at, ends_at, source, created_by`;
  const cases: [
    string,
    string,
    (fx: Awaited<ReturnType<typeof createFixture>>) => unknown[],
    string,
  ][] = [
    [
      'código de setor fora do padrão',
      "INSERT INTO sectors (hospital_id, code, name) VALUES (?, 'pa minusculo', 'Setor X')",
      (fx) => [fx.hospitalId],
      'sectors_code_format',
    ],
    [
      'superadministrador sem escopo global',
      `${PROFILE}) VALUES (?, 'X', 'x1@example.com', ?, 'superadmin', false)`,
      (fx) => [fx.hospitalId, PASSWORD_HASH],
      'profiles_scope_by_role',
    ],
    [
      'administrador de setor com escopo global',
      `${PROFILE}) VALUES (?, 'X', 'x2@example.com', ?, 'sector_admin', true)`,
      (fx) => [fx.hospitalId, PASSWORD_HASH],
      'profiles_scope_by_role',
    ],
    [
      'e-mail com maiúsculas',
      `${PROFILE}) VALUES (?, 'X', 'Maiuscula@example.com', ?, 'viewer', true)`,
      (fx) => [fx.hospitalId, PASSWORD_HASH],
      'profiles_email_lowercase',
    ],
    [
      'e-mail sem domínio',
      `${PROFILE}) VALUES (?, 'X', 'sem-dominio@exemplo', ?, 'viewer', true)`,
      (fx) => [fx.hospitalId, PASSWORD_HASH],
      'profiles_email_format',
    ],
    [
      'senha em texto puro no lugar do hash bcrypt',
      `${PROFILE}) VALUES (?, 'X', 'x4@example.com', 'SenhaEmTextoPuro123', 'viewer', true)`,
      (fx) => [fx.hospitalId],
      'profiles_password_hash_bcrypt',
    ],
    [
      'perfil inativo sem data de desativação',
      `${PROFILE}, is_active) VALUES (?, 'X', 'x3@example.com', ?, 'viewer', true, false)`,
      (fx) => [fx.hospitalId, PASSWORD_HASH],
      'profiles_active_coherence',
    ],
    [
      'turno com menos de 1 hora',
      `${SHIFT}) VALUES (?, ?, 'night', '2026-09-05 10:00:00', '2026-09-05 10:30:00', 'manual', ?)`,
      (fx) => [fx.sectorA, fx.teamA2, fx.adminId],
      'shifts_duration_1_to_24h',
    ],
    [
      'turno com mais de 24 horas',
      `${SHIFT}) VALUES (?, ?, 'night', '2026-09-05 10:00:00', '2026-09-06 10:01:00', 'manual', ?)`,
      (fx) => [fx.sectorA, fx.teamA2, fx.adminId],
      'shifts_duration_1_to_24h',
    ],
    [
      'turno importado sem importação',
      `${SHIFT}) VALUES (?, ?, 'night', '2026-09-05 10:00:00', '2026-09-05 16:00:00', 'import', ?)`,
      (fx) => [fx.sectorA, fx.teamA2, fx.adminId],
      'shifts_source_import_coherence',
    ],
    [
      'turno cancelado sem motivo',
      `${SHIFT}, cancelled_at, cancelled_by) VALUES (?, ?, 'night', '2026-09-05 10:00:00', '2026-09-05 16:00:00', 'manual', ?, UTC_TIMESTAMP(3), ?)`,
      (fx) => [fx.sectorA, fx.teamA2, fx.adminId, fx.adminId],
      'shifts_cancellation_coherence',
    ],
    [
      'importação com totais incoerentes',
      `${IMPORT} VALUES (?, 'escala.csv', REPEAT('b', 64), 'validated', 10, 9, 0, UTC_TIMESTAMP(3) + INTERVAL 30 MINUTE)`,
      (fx) => [fx.adminId],
      'shift_imports_row_totals',
    ],
    [
      'importação acima de 2.000 linhas',
      `${IMPORT} VALUES (?, 'escala.csv', REPEAT('b', 64), 'validated', 2001, 2001, 0, UTC_TIMESTAMP(3) + INTERVAL 30 MINUTE)`,
      (fx) => [fx.adminId],
      'shift_imports_row_totals',
    ],
    [
      'importação confirmada sem data de confirmação',
      `${IMPORT} VALUES (?, 'escala.csv', REPEAT('b', 64), 'committed', 10, 10, 0, UTC_TIMESTAMP(3) + INTERVAL 30 MINUTE)`,
      (fx) => [fx.adminId],
      'shift_imports_status_coherence',
    ],
    [
      'importação com validade acima de 30 minutos',
      `${IMPORT} VALUES (?, 'escala.csv', REPEAT('b', 64), 'validated', 10, 10, 0, UTC_TIMESTAMP(3) + INTERVAL 31 MINUTE)`,
      (fx) => [fx.adminId],
      'shift_imports_expiration_window',
    ],
    [
      'NPS fora de 0–10',
      `${RESPONSE} VALUES (?, ?, 'link', 11, false, '2026-09-01 12:00:00', 'not_qr_origin', UUID(), REPEAT('a', 64), '2026-09-01 13:00:00')`,
      (fx) => [fx.versionA1, fx.sectorA],
      'responses_nps_score_range',
    ],
    [
      'NPS baixo sem low_score',
      `${RESPONSE} VALUES (?, ?, 'link', 5, false, '2026-09-01 12:00:00', 'not_qr_origin', UUID(), REPEAT('a', 64), '2026-09-01 13:00:00')`,
      (fx) => [fx.versionA1, fx.sectorA],
      'responses_low_score_coherence',
    ],
    [
      'origem link com status de QR',
      `${RESPONSE} VALUES (?, ?, 'link', 9, false, '2026-09-01 12:00:00', 'no_shift', UUID(), REPEAT('a', 64), '2026-09-01 13:00:00')`,
      (fx) => [fx.versionA1, fx.sectorA],
      'responses_origin_attribution',
    ],
    [
      'atribuída sem turno',
      `${RESPONSE} VALUES (?, ?, 'qr_code', 9, false, '2026-09-01 12:00:00', 'attributed', UUID(), REPEAT('a', 64), '2026-09-01 13:00:00')`,
      (fx) => [fx.versionA1, fx.sectorA],
      'responses_attribution_fields',
    ],
    [
      'token de manifestação com validade acima de 60 minutos',
      `${RESPONSE} VALUES (?, ?, 'link', 9, false, '2026-09-01 12:00:00', 'not_qr_origin', UUID(), REPEAT('a', 64), '2026-09-01 13:01:00')`,
      (fx) => [fx.versionA1, fx.sectorA],
      'responses_manifestation_token_window',
    ],
    [
      'nota específica fora de 1–5',
      "INSERT INTO response_answers (response_id, survey_version_id, survey_version_question_id, question_type, score) VALUES (?, ?, ?, 'scale_1_5', 6)",
      (fx) => [fx.responseA1, fx.versionA1, fx.svqA1Specific],
      'response_answers_score_range',
    ],
    [
      'nota específica registrada para a pergunta geral',
      "INSERT INTO response_answers (response_id, survey_version_id, survey_version_question_id, question_type, score) VALUES (?, ?, ?, 'nps', 3)",
      (fx) => [fx.responseA1, fx.versionA1, fx.svqA1Nps],
      'response_answers_specific_only',
    ],
  ];

  it.each(cases)('rejeita %s', async (_label, sql, params, constraint) => {
    await inRollback(db, async () => {
      const fx = await createFixture(db);
      await expectDbError(db, sql, params(fx), { code: CHECK, constraint });
    });
  });

  it('rejeita nome de setor repetido sem distinguir maiúsculas, mas distingue acentos (índice funcional)', async () => {
    await inRollback(db, async () => {
      const fx = await createFixture(db);
      await expectDbError(
        db,
        "INSERT INTO sectors (hospital_id, code, name) VALUES (?, 'OUTRO', 'SETOR A')",
        [fx.hospitalId],
        { code: UNIQUE, constraint: 'sectors_hospital_id_lower_name_key' },
      );
      await db.query(
        "INSERT INTO sectors (hospital_id, code, name) VALUES (?, 'ACENTO', 'Setor Á')",
        [fx.hospitalId],
      );
    });
  });

  it('impede turnos sobrepostos da mesma equipe (antes EXCLUDE), aceitando turno encostado', async () => {
    await inRollback(db, async () => {
      const fx = await createFixture(db);
      // Turno A1 da fixture: 10:00–16:00 UTC. Começar às 16:00 encosta, não sobrepõe.
      await db.query(
        `${SHIFT}) VALUES (?, ?, 'afternoon', '2026-09-01 16:00:00', '2026-09-01 22:00:00', 'manual', ?)`,
        [fx.sectorA, fx.teamA1, fx.adminId],
      );
      await expectDbError(
        db,
        `${SHIFT}) VALUES (?, ?, 'afternoon', '2026-09-01 15:00:00', '2026-09-01 18:00:00', 'manual', ?)`,
        [fx.sectorA, fx.teamA1, fx.adminId],
        { code: TRIGGER, constraint: 'shifts_no_overlap_per_team' },
      );
      // Outra equipe no mesmo horário é permitida; turno cancelado não conta.
      await db.query(
        `${SHIFT}) VALUES (?, ?, 'morning', '2026-09-01 10:00:00', '2026-09-01 16:00:00', 'manual', ?)`,
        [fx.sectorA, fx.teamA2, fx.adminId],
      );
      await db.query(
        "UPDATE shifts SET cancelled_at = UTC_TIMESTAMP(3), cancelled_by = ?, cancel_reason = 'Cancelado no teste' WHERE id = ?",
        [fx.adminId, fx.shiftA1],
      );
      await db.query(
        `${SHIFT}) VALUES (?, ?, 'morning', '2026-09-01 11:00:00', '2026-09-01 15:00:00', 'manual', ?)`,
        [fx.sectorA, fx.teamA1, fx.adminId],
      );
      // Reativar (descancelar) o turno antigo sobreporia: recusado.
      await expectDbError(
        db,
        'UPDATE shifts SET cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL WHERE id = ?',
        [fx.shiftA1],
        { code: TRIGGER, constraint: 'shifts_no_overlap_per_team' },
      );
    });
  });
});

describe('coerência da atribuição a turno (RN07)', () => {
  const insertAttributed = (
    fx: Awaited<ReturnType<typeof createFixture>>,
    teamId: string,
    submittedAt: string,
    period = 'morning',
  ) => {
    const at = new Date(submittedAt);
    return db.query(
      `INSERT INTO responses (survey_version_id, sector_id, origin, nps_score, low_score, submitted_at,
         attribution_status, shift_id, team_id, shift_period, idempotency_key, request_hash, manifestation_token_expires_at)
       VALUES (?, ?, 'qr_code', 9, false, ?, 'attributed', ?, ?, ?, UUID(), ?, ?)`,
      [
        fx.versionA1,
        fx.sectorA,
        dt(at),
        fx.shiftA1,
        teamId,
        period,
        HASH,
        dt(new Date(at.getTime() + 3_600_000)),
      ],
    );
  };

  const rejectsWith = async (
    operation: () => Promise<unknown>,
    code: string,
    constraint?: string,
  ) => {
    await db.query('SAVEPOINT s');
    const error = await operation().then(
      () => undefined,
      (caught: unknown) => caught as { code: string; sqlMessage: string; message: string },
    );
    await db.query('ROLLBACK TO SAVEPOINT s');
    expect(error?.code).toBe(code);
    if (constraint !== undefined && error !== undefined)
      expect(constraintOf(error)).toBe(constraint);
  };

  it('aceita resposta atribuída coerente e rejeita equipe, período, horário ou turno cancelado incoerentes', async () => {
    await inRollback(db, async () => {
      const fx = await createFixture(db);
      await insertAttributed(fx, fx.teamA1, '2026-09-01T12:00:00Z');

      const attempts: [string, string, string][] = [
        [fx.teamA2, '2026-09-01T12:00:00Z', 'morning'], // outra equipe do setor
        [fx.teamA1, '2026-09-01T12:00:00Z', 'night'], // período diferente do turno
        [fx.teamA1, '2026-09-01T16:00:00Z', 'morning'], // fora do intervalo [início, fim)
      ];
      for (const [teamId, submittedAt, period] of attempts) {
        await rejectsWith(
          () => insertAttributed(fx, teamId, submittedAt, period),
          TRIGGER,
          'responses_shift_coherence',
        );
      }

      await db.query(
        "UPDATE shifts SET cancelled_at = UTC_TIMESTAMP(3), cancelled_by = ?, cancel_reason = 'Cancelado no teste' WHERE id = ?",
        [fx.adminId, fx.shiftA1],
      );
      await rejectsWith(
        () => insertAttributed(fx, fx.teamA1, '2026-09-01T12:30:00Z'),
        TRIGGER,
        'responses_shift_coherence',
      );

      // Equipe de outro setor: barrada pela FK composta (team_id, sector_id) ou pelo gatilho.
      await db.query('SAVEPOINT s');
      const error = await insertAttributed(fx, fx.teamB1, '2026-09-01T12:00:00Z').then(
        () => undefined,
        (caught: unknown) => caught as { code: string },
      );
      await db.query('ROLLBACK TO SAVEPOINT s');
      expect([TRIGGER, FOREIGN_KEY]).toContain(error?.code);
    });
  });

  it('rejeita resposta anterior à publicação da versão', async () => {
    await inRollback(db, async () => {
      const fx = await createFixture(db);
      await rejectsWith(
        () =>
          insertResponse(db, {
            versionId: fx.versionA2,
            sectorId: fx.sectorA,
            submittedAt: '2026-08-10T12:00:00Z',
          }),
        TRIGGER,
        'responses_after_version_publication',
      );
    });
  });
});

describe('manifestações, contatos e linha do tempo', () => {
  it('gera protocolo FHD-AAAA-NNNNNN sequencial com o ano local (America/Sao_Paulo)', async () => {
    await inRollback(db, async () => {
      const fx = await createFixture(db);
      const id = await insertManifestation(db, { responseId: fx.responseA1, sectorId: fx.sectorA });
      const other = await insertResponse(db, { versionId: fx.versionA1, sectorId: fx.sectorA });
      const second = randomUUID();
      // 01/01/2027 02:00 UTC = 31/12/2026 23:00 no fuso do hospital → ano 2026.
      await db.query(
        `INSERT INTO manifestations (id, response_id, sector_id, type, description, is_anonymous,
           triggered_by_low_score, received_at, idempotency_key, request_hash)
         VALUES (?, ?, ?, 'suggestion', 'Sugestão fictícia com mais de dez caracteres.', true, false,
           '2027-01-01 02:00:00', UUID(), ?)`,
        [second, other, fx.sectorA, HASH],
      );
      const { rows } = await db.query<{ id: string; protocol: string }>(
        'SELECT id, protocol FROM manifestations WHERE id IN (?, ?)',
        [id, second],
      );
      const first = rows.find((row) => row.id === id)?.protocol ?? '';
      const next = rows.find((row) => row.id === second)?.protocol ?? '';
      expect(first).toMatch(/^FHD-2026-\d{6}$/);
      expect(next).toMatch(/^FHD-2026-\d{6}$/);
      expect(Number(next.slice(-6))).toBe(Number(first.slice(-6)) + 1);
    });
  });

  it('valida contato: telefone ou e-mail, formatos e nome; nunca em manifestação anônima', async () => {
    await inRollback(db, async () => {
      const fx = await createFixture(db);
      const id = await insertManifestation(db, {
        responseId: fx.responseA1,
        sectorId: fx.sectorA,
        anonymous: false,
      });
      const insert =
        "INSERT INTO manifestation_contacts (manifestation_id, full_name, phone, email, consent_given_at, purpose_text_version) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3), 'v1')";
      await expectDbError(db, insert, [id, 'Contato Fictício 001', null, null], {
        code: CHECK,
        constraint: 'manifestation_contacts_phone_or_email',
      });
      await expectDbError(db, insert, [id, 'Contato Fictício 001', '519000001', null], {
        code: CHECK,
        constraint: 'manifestation_contacts_phone_format',
      });
      await expectDbError(db, insert, [id, 'Contato Fictício 001', null, 'sem-arroba'], {
        code: CHECK,
        constraint: 'manifestation_contacts_email_format',
      });
      await expectDbError(db, insert, [id, '   ', '51900000001', null], {
        code: CHECK,
        constraint: 'manifestation_contacts_full_name_not_blank',
      });
      await db.query(insert, [
        id,
        'Contato Fictício 001',
        null,
        'contato.ficticio.001@example.com',
      ]);

      const other = await insertResponse(db, { versionId: fx.versionA1, sectorId: fx.sectorA });
      const anonymous = await insertManifestation(db, { responseId: other, sectorId: fx.sectorA });
      await expectDbError(db, insert, [anonymous, 'Contato Fictício 002', '51900000002', null], {
        code: TRIGGER,
        constraint: 'manifestation_contacts_not_anonymous',
      });
    });
  });

  it('impede tornar anônima ou alterar o texto de manifestação registrada', async () => {
    await inRollback(db, async () => {
      const fx = await createFixture(db);
      const id = await insertManifestation(db, {
        responseId: fx.responseA1,
        sectorId: fx.sectorA,
        anonymous: false,
      });
      await expectDbError(db, 'UPDATE manifestations SET is_anonymous = true WHERE id = ?', [id], {
        code: TRIGGER,
        constraint: 'manifestations_registration_immutable',
      });
      await expectDbError(
        db,
        "UPDATE manifestations SET description = 'Texto trocado depois' WHERE id = ?",
        [id],
        {
          code: TRIGGER,
          constraint: 'manifestations_registration_immutable',
        },
      );
      await db.query(
        "UPDATE manifestations SET status = 'in_review', priority = 'high' WHERE id = ?",
        [id],
      );
    });
  });

  it('exige providências (10+ caracteres) e data ao concluir; texto de 10 a 2.000 caracteres', async () => {
    await inRollback(db, async () => {
      const fx = await createFixture(db);
      const id = await insertManifestation(db, { responseId: fx.responseA1, sectorId: fx.sectorA });
      await expectDbError(
        db,
        "UPDATE manifestations SET status = 'resolved', resolved_at = UTC_TIMESTAMP(3) WHERE id = ?",
        [id],
        {
          code: CHECK,
          constraint: 'manifestations_resolution_coherence',
        },
      );
      await expectDbError(
        db,
        "UPDATE manifestations SET status = 'resolved', resolved_at = UTC_TIMESTAMP(3), actions_taken = 'curto' WHERE id = ?",
        [id],
        { code: CHECK, constraint: 'manifestations_resolution_coherence' },
      );
      await db.query(
        "UPDATE manifestations SET status = 'resolved', resolved_at = UTC_TIMESTAMP(3), actions_taken = 'Equipe orientada e retorno feito.' WHERE id = ?",
        [id],
      );
      const other = await insertResponse(db, { versionId: fx.versionA1, sectorId: fx.sectorA });
      await expectDbError(
        db,
        `INSERT INTO manifestations (response_id, sector_id, type, description, is_anonymous, triggered_by_low_score, idempotency_key, request_hash)
         VALUES (?, ?, 'complaint', 'curta', true, false, UUID(), ?)`,
        [other, fx.sectorA, HASH],
        { code: CHECK, constraint: 'manifestations_description_length' },
      );
    });
  });

  it('aceita uma manifestação por resposta e exige o mesmo setor da resposta', async () => {
    await inRollback(db, async () => {
      const fx = await createFixture(db);
      await insertManifestation(db, { responseId: fx.responseA1, sectorId: fx.sectorA });
      await expectDbError(
        db,
        `INSERT INTO manifestations (response_id, sector_id, type, description, is_anonymous, triggered_by_low_score, idempotency_key, request_hash)
         VALUES (?, ?, 'complaint', 'Descrição fictícia com mais de dez caracteres.', true, false, UUID(), ?)`,
        [fx.responseA1, fx.sectorA, HASH],
        { code: UNIQUE, constraint: 'manifestations_response_id_key' },
      );
      const other = await insertResponse(db, { versionId: fx.versionA1, sectorId: fx.sectorA });
      await expectDbError(
        db,
        `INSERT INTO manifestations (response_id, sector_id, type, description, is_anonymous, triggered_by_low_score, idempotency_key, request_hash)
         VALUES (?, ?, 'complaint', 'Descrição fictícia com mais de dez caracteres.', true, false, UUID(), ?)`,
        [other, fx.sectorB, HASH],
        { code: FOREIGN_KEY, constraint: 'manifestations_response_id_sector_id_fkey' },
      );
    });
  });

  it('valida eventos da linha do tempo e impede alterar ou excluir notas diretamente', async () => {
    await inRollback(db, async () => {
      const fx = await createFixture(db);
      const id = await insertManifestation(db, { responseId: fx.responseA1, sectorId: fx.sectorA });
      const insertNote =
        'INSERT INTO manifestation_notes (id, manifestation_id, author_id, kind, content, from_value, to_value) VALUES (?, ?, ?, ?, ?, ?, ?)';
      await db.query(insertNote, [randomUUID(), id, null, 'created', null, null, 'received']);
      const noteId = randomUUID();
      await db.query(insertNote, [
        noteId,
        id,
        fx.adminId,
        'note',
        'Nota interna de teste.',
        null,
        null,
      ]);
      await expectDbError(
        db,
        insertNote,
        [randomUUID(), id, fx.adminId, 'status_changed', null, 'received', null],
        {
          code: CHECK,
          constraint: 'manifestation_notes_kind_rules',
        },
      );
      await expectDbError(
        db,
        insertNote,
        [randomUUID(), id, null, 'note', 'Sem autor', null, null],
        {
          code: CHECK,
          constraint: 'manifestation_notes_kind_rules',
        },
      );
      await expectDbError(
        db,
        insertNote,
        [randomUUID(), id, fx.adminId, 'contact_deleted', null, null, 'motivo-livre'],
        {
          code: CHECK,
          constraint: 'manifestation_notes_kind_rules',
        },
      );
      await expectDbError(
        db,
        "UPDATE manifestation_notes SET content = 'editada' WHERE id = ?",
        [noteId],
        {
          code: TRIGGER,
          constraint: 'manifestation_notes_no_update',
        },
      );
      await expectDbError(db, 'DELETE FROM manifestation_notes WHERE id = ?', [noteId], {
        code: TRIGGER,
        constraint: 'manifestation_notes_no_direct_delete',
      });

      // Manutenção (retenção, Seção 10): excluir a manifestação remove as notas em cascata.
      await db.query('DELETE FROM manifestations WHERE id = ?', [id]);
      expect(
        await count(db, 'SELECT COUNT(*) FROM manifestation_notes WHERE manifestation_id = ?', [
          id,
        ]),
      ).toBe(0);
    });
  });
});
