/**
 * Verificações adicionais da ET02 com PostgreSQL real: estrutura (18 tabelas e enums), RLS e
 * privilégios, CHECK, UNIQUE parciais, gatilhos de imutabilidade, coerência e anonimato.
 * Tudo roda em transações desfeitas ao final.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  connect,
  count,
  createFixture,
  type Db,
  expectDbError,
  HASH,
  inRollback,
  insertManifestation,
  insertResponse,
} from './support.js';

const TABLES = [
  'audit_logs',
  'hospitals',
  'journey_stages',
  'manifestation_contacts',
  'manifestation_notes',
  'manifestations',
  'profile_sectors',
  'profiles',
  'questions',
  'response_answers',
  'responses',
  'sectors',
  'shift_imports',
  'shifts',
  'survey_configs',
  'survey_version_questions',
  'survey_versions',
  'teams',
];

let db: Db;

beforeAll(async () => {
  db = await connect();
});

afterAll(async () => {
  await db.end();
});

describe('estrutura do esquema public', () => {
  it('possui exatamente as 18 tabelas da Tabela 17 (além do controle do Prisma)', async () => {
    const { rows } = await db.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename",
    );
    expect(rows.map((row) => row.tablename)).toEqual(TABLES);
  });

  it('define os 11 enums da Tabela 16 com os valores do PDF', async () => {
    const { rows } = await db.query<{ name: string; values: string[] }>(
      `SELECT t.typname AS name, array_agg(e.enumlabel ORDER BY e.enumsortorder)::text[] AS values
       FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
       JOIN pg_namespace n ON n.oid = t.typnamespace AND n.nspname = 'public'
       GROUP BY t.typname ORDER BY t.typname`,
    );
    const enums = Object.fromEntries(rows.map((row) => [row.name, row.values]));
    expect(Object.keys(enums)).toHaveLength(11);
    expect(enums.question_type).toEqual(['nps', 'scale_1_5']);
    expect(enums.attribution_status).toEqual([
      'attributed',
      'not_qr_origin',
      'no_shift',
      'ambiguous',
    ]);
    expect(enums.user_role).toEqual([
      'superadmin',
      'sector_admin',
      'management',
      'ombudsman',
      'viewer',
    ]);
    expect(enums.response_origin).toEqual(['qr_code', 'link']);
    expect(enums.shift_period).toEqual(['morning', 'afternoon', 'night']);
    expect(Object.keys(enums).sort()).toEqual([
      'attribution_status',
      'import_status',
      'manifestation_event_kind',
      'manifestation_priority',
      'manifestation_status',
      'manifestation_type',
      'question_type',
      'response_origin',
      'shift_period',
      'shift_source',
      'user_role',
    ]);
  });

  it('usa UUID com gen_random_uuid() e audit_logs.id como bigint de identidade', async () => {
    const { rows } = await db.query<{
      table_name: string;
      data_type: string;
      column_default: string | null;
      is_identity: string;
    }>(
      `SELECT table_name, data_type, column_default, is_identity
       FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'id' AND table_name <> '_prisma_migrations'`,
    );
    for (const row of rows) {
      if (row.table_name === 'audit_logs') {
        expect(row).toMatchObject({ data_type: 'bigint', is_identity: 'YES' });
      } else {
        expect(row.data_type).toBe('uuid');
        expect(row.column_default).toBe('gen_random_uuid()');
      }
    }
    expect(rows).toHaveLength(16); // profile_sectors e manifestation_contacts têm PK sem coluna id
  });

  it('armazena todos os instantes como timestamptz', async () => {
    const wrong = await count(
      db,
      `SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
         AND (column_name LIKE '%\\_at' OR column_name LIKE '%\\_at\\_%')
         AND data_type <> 'timestamp with time zone'`,
    );
    expect(wrong).toBe(0);
  });

  it('usa CASCADE somente nas dependências subordinadas e RESTRICT nas demais FKs', async () => {
    const { rows } = await db.query<{ conname: string; confdeltype: string; confupdtype: string }>(
      `SELECT conname, confdeltype, confupdtype FROM pg_constraint
       WHERE contype = 'f' AND connamespace = 'public'::regnamespace ORDER BY conname`,
    );
    const cascade = rows.filter((row) => row.confdeltype === 'c').map((row) => row.conname);
    expect(cascade.sort()).toEqual([
      'manifestation_contacts_manifestation_id_fkey',
      'manifestation_notes_manifestation_id_fkey',
      'profile_sectors_profile_id_fkey',
      'response_answers_response_id_survey_version_id_fkey',
    ]);
    expect(
      rows.filter((row) => row.confdeltype !== 'c').every((row) => row.confdeltype === 'r'),
    ).toBe(true);
    expect(rows.every((row) => row.confupdtype === 'c')).toBe(true);
  });
});

describe('RLS e privilégios (Tabela 16 e Seção 10)', () => {
  it('habilita RLS em todas as tabelas, sem nenhuma política', async () => {
    const withoutRls = await count(
      db,
      "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity",
    );
    const policies = await count(
      db,
      "SELECT count(*) FROM pg_policies WHERE schemaname = 'public'",
    );
    expect(withoutRls).toBe(0);
    expect(policies).toBe(0);
  });

  it('não concede acesso a anon e authenticated nas tabelas, sequências e funções', async (context) => {
    const roles = await count(
      db,
      "SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated')",
    );
    if (roles < 2) {
      context.skip('Papéis do Supabase ausentes neste servidor');
    }
    for (const role of ['anon', 'authenticated']) {
      const tablePrivileges = await count(
        db,
        `SELECT count(*) FROM pg_class c
         WHERE CASE WHEN c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm')
                    THEN has_table_privilege($1, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
                    ELSE false END`,
        [role],
      );
      const sequencePrivileges = await count(
        db,
        `SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE CASE WHEN n.nspname = 'public' AND c.relkind = 'S'
                    THEN has_sequence_privilege($1, c.oid, 'USAGE') ELSE false END`,
        [role],
      );
      const functionPrivileges = await count(
        db,
        `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
           AND has_function_privilege($1, p.oid, 'EXECUTE')`,
        [role],
      );
      expect({ role, tablePrivileges, sequencePrivileges, functionPrivileges }).toEqual({
        role,
        tablePrivileges: 0,
        sequencePrivileges: 0,
        functionPrivileges: 0,
      });
    }
  });
});

describe('auditoria somente de inserção (RF10)', () => {
  it('aceita INSERT e rejeita UPDATE, DELETE e TRUNCATE em audit_logs', async () => {
    await inRollback(db, async () => {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO audit_logs (action, entity_type, entity_id, details)
         VALUES ('SECTOR_CREATED', 'sector', 'abc', '{"campos": ["name"]}') RETURNING id`,
      );
      const id = rows[0]?.id;
      expect(id).toBeDefined();
      await expectDbError(db, "UPDATE audit_logs SET action = 'X' WHERE id = $1", [id], {
        code: '23000',
        constraint: 'audit_logs_insert_only',
      });
      await expectDbError(db, 'DELETE FROM audit_logs WHERE id = $1', [id], {
        code: '23000',
        constraint: 'audit_logs_insert_only',
      });
      await expectDbError(db, 'TRUNCATE audit_logs', [], {
        code: '23000',
        constraint: 'audit_logs_no_truncate',
      });
      await expectDbError(
        db,
        "INSERT INTO audit_logs (id, action, entity_type) VALUES (999999, 'X', 'y')",
        [],
        { code: '428C9' }, // GENERATED ALWAYS: o id não é informado pela aplicação
      );
      await expectDbError(
        db,
        "INSERT INTO audit_logs (action, entity_type, ip_hash) VALUES ('X', 'y', '127.0.0.1')",
        [],
        { code: '23514', constraint: 'audit_logs_ip_hash_format' },
      );
      expect(await count(db, 'SELECT count(*) FROM audit_logs WHERE id = $1', [id])).toBe(1);
    });
  });
});

describe('imutabilidade de perguntas, versões e respostas', () => {
  it('bloqueia texto, tipo e etapa de pergunta publicada, mas permite desativá-la', async () => {
    await inRollback(db, async () => {
      const fx = await createFixture(db);
      await expectDbError(
        db,
        "UPDATE questions SET text = 'Novo texto?' WHERE id = $1",
        [fx.specificA],
        {
          code: '23000',
          constraint: 'questions_locked_after_publication',
        },
      );
      await expectDbError(
        db,
        'UPDATE questions SET journey_stage_id = NULL WHERE id = $1',
        [fx.specificA],
        {
          code: '23000',
          constraint: 'questions_locked_after_publication',
        },
      );
      await db.query('UPDATE questions SET is_active = false WHERE id = $1', [fx.specificA]);
      await expectDbError(db, 'UPDATE questions SET is_active = false WHERE id = $1', [fx.npsA], {
        code: '23514',
        constraint: 'questions_nps_always_active',
      });
    });
  });

  it('impede alterar ou excluir perguntas de versão (instantâneo)', async () => {
    await inRollback(db, async () => {
      const fx = await createFixture(db);
      await expectDbError(
        db,
        "UPDATE survey_version_questions SET text = 'x' WHERE id = $1",
        [fx.svqA1Specific],
        {
          code: '23000',
          constraint: 'svq_immutable',
        },
      );
      await expectDbError(
        db,
        'DELETE FROM survey_version_questions WHERE id = $1',
        [fx.svqA1Specific],
        {
          code: '23000',
          constraint: 'svq_immutable',
        },
      );
    });
  });

  it('exige que a pergunta da versão seja da mesma pesquisa e do mesmo tipo', async () => {
    await inRollback(db, async () => {
      const fx = await createFixture(db);
      const { rows } = await db.query<{ id: string }>(
        "SELECT id FROM questions WHERE survey_config_id = $1 AND type = 'scale_1_5'",
        [fx.surveyB],
      );
      await expectDbError(
        db,
        `INSERT INTO survey_version_questions (survey_version_id, question_id, type, text, journey_stage_id,
           journey_stage_name, journey_stage_position, position, is_required)
         VALUES ($1, $2, 'scale_1_5', 'x', $3, 'Recepção', 1, 9, false)`,
        [fx.versionA2, rows[0]?.id, fx.stageId],
        { code: '23000', constraint: 'svq_question_same_survey' },
      );
    });
  });

  it('impede alterar respostas e notas; permite registrar o uso do token uma única vez', async () => {
    await inRollback(db, async () => {
      const fx = await createFixture(db);
      await expectDbError(
        db,
        'UPDATE responses SET nps_score = 10 WHERE id = $1',
        [fx.responseA1],
        {
          code: '23000',
          constraint: 'responses_immutable',
        },
      );
      await expectDbError(
        db,
        'UPDATE responses SET sector_id = $2 WHERE id = $1',
        [fx.responseA1, fx.sectorB],
        {
          code: '23000',
          constraint: 'responses_immutable',
        },
      );
      await db.query(
        "UPDATE responses SET manifestation_token_used_at = '2026-09-01T12:05:00Z' WHERE id = $1",
        [fx.responseA1],
      );
      await expectDbError(
        db,
        "UPDATE responses SET manifestation_token_used_at = '2026-09-01T12:06:00Z' WHERE id = $1",
        [fx.responseA1],
        { code: '23000', constraint: 'responses_immutable' },
      );
      await db.query(
        `INSERT INTO response_answers (response_id, survey_version_id, survey_version_question_id, question_type, score)
         VALUES ($1, $2, $3, 'scale_1_5', 2)`,
        [fx.responseA1, fx.versionA1, fx.svqA1Specific],
      );
      await expectDbError(
        db,
        'UPDATE response_answers SET score = 5 WHERE response_id = $1',
        [fx.responseA1],
        {
          code: '23000',
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
        'UPDATE survey_configs SET current_version_id = $2 WHERE id = $1',
        [fx.surveyA, fx.versionB1],
        {
          code: '23000',
          constraint: 'survey_configs_current_version_same_survey',
        },
      );
      await expectDbError(
        db,
        "UPDATE survey_configs SET slug = 'novo-slug' WHERE id = $1",
        [fx.surveyA],
        {
          code: '23000',
          constraint: 'survey_configs_locked_after_publication',
        },
      );
      await expectDbError(
        db,
        'UPDATE survey_configs SET sector_id = $2 WHERE id = $1',
        [fx.surveyA, fx.sectorB],
        {
          code: '23000',
          constraint: 'survey_configs_locked_after_publication',
        },
      );
      await db.query("UPDATE survey_configs SET title = 'Título editável' WHERE id = $1", [
        fx.surveyA,
      ]);
      await expectDbError(
        db,
        `INSERT INTO survey_configs (sector_id, title, slug, thank_you_message, created_by)
         VALUES ($1, 'Pesquisa', 'Slug Invalido', 'Obrigado.', $2)`,
        [fx.sectorB, fx.adminId],
        { code: '23514', constraint: 'survey_configs_slug_kebab_case' },
      );
    });
  });

  it('aceita uma única pergunta geral (nps) por pesquisa e por versão (UNIQUE parcial)', async () => {
    await inRollback(db, async () => {
      const fx = await createFixture(db);
      await expectDbError(
        db,
        "INSERT INTO questions (survey_config_id, type, text, is_required, position) VALUES ($1, 'nps', 'Outra geral?', true, 5)",
        [fx.surveyA],
        { code: '23505', constraint: 'questions_one_nps_per_survey_key' },
      );
      // Várias perguntas específicas são aceitas (o índice é parcial).
      await db.query(
        "INSERT INTO questions (survey_config_id, journey_stage_id, type, text, is_required, position) VALUES ($1, $2, 'scale_1_5', 'Mais uma?', false, 6)",
        [fx.surveyA, fx.stageId],
      );
      await expectDbError(
        db,
        `INSERT INTO survey_version_questions (survey_version_id, question_id, type, text, position, is_required)
         VALUES ($1, $2, 'nps', 'Geral duplicada', 7, true)`,
        [fx.versionA1, fx.npsA],
        { code: '23505' },
      );
    });
  });
});

describe('regras de domínio por CHECK', () => {
  const cases: [
    string,
    string,
    (fx: Awaited<ReturnType<typeof createFixture>>) => unknown[],
    string,
  ][] = [
    [
      'código de setor fora do padrão',
      "INSERT INTO sectors (hospital_id, code, name) VALUES ($1, 'pa minusculo', 'Setor X')",
      (fx) => [fx.hospitalId],
      'sectors_code_format',
    ],
    [
      'superadministrador sem escopo global',
      "INSERT INTO profiles (hospital_id, auth_user_id, full_name, email, role, all_sectors) VALUES ($1, gen_random_uuid(), 'X', 'x1@example.com', 'superadmin', false)",
      (fx) => [fx.hospitalId],
      'profiles_scope_by_role',
    ],
    [
      'administrador de setor com escopo global',
      "INSERT INTO profiles (hospital_id, auth_user_id, full_name, email, role, all_sectors) VALUES ($1, gen_random_uuid(), 'X', 'x2@example.com', 'sector_admin', true)",
      (fx) => [fx.hospitalId],
      'profiles_scope_by_role',
    ],
    [
      'e-mail com maiúsculas',
      "INSERT INTO profiles (hospital_id, auth_user_id, full_name, email, role, all_sectors) VALUES ($1, gen_random_uuid(), 'X', 'Maiuscula@example.com', 'viewer', true)",
      (fx) => [fx.hospitalId],
      'profiles_email_lowercase',
    ],
    [
      'perfil inativo sem data de desativação',
      "INSERT INTO profiles (hospital_id, auth_user_id, full_name, email, role, all_sectors, is_active) VALUES ($1, gen_random_uuid(), 'X', 'x3@example.com', 'viewer', true, false)",
      (fx) => [fx.hospitalId],
      'profiles_active_coherence',
    ],
    [
      'turno com menos de 1 hora',
      "INSERT INTO shifts (sector_id, team_id, period, starts_at, ends_at, source, created_by) VALUES ($1, $2, 'night', '2026-09-05T10:00:00Z', '2026-09-05T10:30:00Z', 'manual', $3)",
      (fx) => [fx.sectorA, fx.teamA2, fx.adminId],
      'shifts_duration_1_to_24h',
    ],
    [
      'turno com mais de 24 horas',
      "INSERT INTO shifts (sector_id, team_id, period, starts_at, ends_at, source, created_by) VALUES ($1, $2, 'night', '2026-09-05T10:00:00Z', '2026-09-06T10:01:00Z', 'manual', $3)",
      (fx) => [fx.sectorA, fx.teamA2, fx.adminId],
      'shifts_duration_1_to_24h',
    ],
    [
      'turno importado sem importação',
      "INSERT INTO shifts (sector_id, team_id, period, starts_at, ends_at, source, created_by) VALUES ($1, $2, 'night', '2026-09-05T10:00:00Z', '2026-09-05T16:00:00Z', 'import', $3)",
      (fx) => [fx.sectorA, fx.teamA2, fx.adminId],
      'shifts_source_import_coherence',
    ],
    [
      'turno cancelado sem motivo',
      "INSERT INTO shifts (sector_id, team_id, period, starts_at, ends_at, source, created_by, cancelled_at, cancelled_by) VALUES ($1, $2, 'night', '2026-09-05T10:00:00Z', '2026-09-05T16:00:00Z', 'manual', $3, now(), $3)",
      (fx) => [fx.sectorA, fx.teamA2, fx.adminId],
      'shifts_cancellation_coherence',
    ],
    [
      'importação com totais incoerentes',
      "INSERT INTO shift_imports (uploaded_by, file_name, file_sha256, status, total_rows, accepted_rows, rejected_rows, expires_at) VALUES ($1, 'escala.csv', repeat('b', 64), 'validated', 10, 9, 0, now() + interval '30 minutes')",
      (fx) => [fx.adminId],
      'shift_imports_row_totals',
    ],
    [
      'importação acima de 2.000 linhas',
      "INSERT INTO shift_imports (uploaded_by, file_name, file_sha256, status, total_rows, accepted_rows, rejected_rows, expires_at) VALUES ($1, 'escala.csv', repeat('b', 64), 'validated', 2001, 2001, 0, now() + interval '30 minutes')",
      (fx) => [fx.adminId],
      'shift_imports_row_totals',
    ],
    [
      'importação confirmada sem data de confirmação',
      "INSERT INTO shift_imports (uploaded_by, file_name, file_sha256, status, total_rows, accepted_rows, rejected_rows, expires_at) VALUES ($1, 'escala.csv', repeat('b', 64), 'committed', 10, 10, 0, now() + interval '30 minutes')",
      (fx) => [fx.adminId],
      'shift_imports_status_coherence',
    ],
    [
      'importação com validade acima de 30 minutos',
      "INSERT INTO shift_imports (uploaded_by, file_name, file_sha256, status, total_rows, accepted_rows, rejected_rows, expires_at) VALUES ($1, 'escala.csv', repeat('b', 64), 'validated', 10, 10, 0, now() + interval '31 minutes')",
      (fx) => [fx.adminId],
      'shift_imports_expiration_window',
    ],
    [
      'NPS fora de 0–10',
      "INSERT INTO responses (survey_version_id, sector_id, origin, nps_score, low_score, submitted_at, attribution_status, idempotency_key, request_hash, manifestation_token_expires_at) VALUES ($1, $2, 'link', 11, false, '2026-09-01T12:00:00Z', 'not_qr_origin', gen_random_uuid(), repeat('a', 64), '2026-09-01T13:00:00Z')",
      (fx) => [fx.versionA1, fx.sectorA],
      'responses_nps_score_range',
    ],
    [
      'NPS baixo sem low_score',
      "INSERT INTO responses (survey_version_id, sector_id, origin, nps_score, low_score, submitted_at, attribution_status, idempotency_key, request_hash, manifestation_token_expires_at) VALUES ($1, $2, 'link', 5, false, '2026-09-01T12:00:00Z', 'not_qr_origin', gen_random_uuid(), repeat('a', 64), '2026-09-01T13:00:00Z')",
      (fx) => [fx.versionA1, fx.sectorA],
      'responses_low_score_coherence',
    ],
    [
      'origem link com status de QR',
      "INSERT INTO responses (survey_version_id, sector_id, origin, nps_score, low_score, submitted_at, attribution_status, idempotency_key, request_hash, manifestation_token_expires_at) VALUES ($1, $2, 'link', 9, false, '2026-09-01T12:00:00Z', 'no_shift', gen_random_uuid(), repeat('a', 64), '2026-09-01T13:00:00Z')",
      (fx) => [fx.versionA1, fx.sectorA],
      'responses_origin_attribution',
    ],
    [
      'atribuída sem turno',
      "INSERT INTO responses (survey_version_id, sector_id, origin, nps_score, low_score, submitted_at, attribution_status, idempotency_key, request_hash, manifestation_token_expires_at) VALUES ($1, $2, 'qr_code', 9, false, '2026-09-01T12:00:00Z', 'attributed', gen_random_uuid(), repeat('a', 64), '2026-09-01T13:00:00Z')",
      (fx) => [fx.versionA1, fx.sectorA],
      'responses_attribution_fields',
    ],
    [
      'token de manifestação com validade acima de 60 minutos',
      "INSERT INTO responses (survey_version_id, sector_id, origin, nps_score, low_score, submitted_at, attribution_status, idempotency_key, request_hash, manifestation_token_expires_at) VALUES ($1, $2, 'link', 9, false, '2026-09-01T12:00:00Z', 'not_qr_origin', gen_random_uuid(), repeat('a', 64), '2026-09-01T13:01:00Z')",
      (fx) => [fx.versionA1, fx.sectorA],
      'responses_manifestation_token_window',
    ],
    [
      'nota específica fora de 1–5',
      "INSERT INTO response_answers (response_id, survey_version_id, survey_version_question_id, question_type, score) VALUES ($1, $2, $3, 'scale_1_5', 6)",
      (fx) => [fx.responseA1, fx.versionA1, fx.svqA1Specific],
      'response_answers_score_range',
    ],
    [
      'nota específica registrada para a pergunta geral',
      "INSERT INTO response_answers (response_id, survey_version_id, survey_version_question_id, question_type, score) VALUES ($1, $2, $3, 'nps', 3)",
      (fx) => [fx.responseA1, fx.versionA1, fx.svqA1Nps],
      'response_answers_specific_only',
    ],
  ];

  it.each(cases)('rejeita %s', async (_label, sql, params, constraint) => {
    await inRollback(db, async () => {
      const fx = await createFixture(db);
      await expectDbError(db, sql, params(fx), { code: '23514', constraint });
    });
  });

  it('rejeita nome de setor repetido sem distinguir maiúsculas (índice de expressão)', async () => {
    await inRollback(db, async () => {
      const fx = await createFixture(db);
      await expectDbError(
        db,
        "INSERT INTO sectors (hospital_id, code, name) VALUES ($1, 'OUTRO', 'SETOR A')",
        [fx.hospitalId],
        { code: '23505', constraint: 'sectors_hospital_id_lower_name_key' },
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
  ) =>
    db.query(
      `INSERT INTO responses (survey_version_id, sector_id, origin, nps_score, low_score, submitted_at,
         attribution_status, shift_id, team_id, shift_period, idempotency_key, request_hash, manifestation_token_expires_at)
       VALUES ($1, $2, 'qr_code', 9, false, $3::timestamptz, 'attributed', $4, $5, $6::shift_period,
         gen_random_uuid(), $7, $3::timestamptz + interval '60 minutes')`,
      [fx.versionA1, fx.sectorA, submittedAt, fx.shiftA1, teamId, period, HASH],
    );

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
        await db.query('SAVEPOINT s');
        await expect(insertAttributed(fx, teamId, submittedAt, period)).rejects.toMatchObject({
          code: '23000',
          constraint: 'responses_shift_coherence',
        });
        await db.query('ROLLBACK TO SAVEPOINT s');
      }

      await db.query(
        "UPDATE shifts SET cancelled_at = now(), cancelled_by = $2, cancel_reason = 'Cancelado no teste' WHERE id = $1",
        [fx.shiftA1, fx.adminId],
      );
      await db.query('SAVEPOINT s');
      await expect(insertAttributed(fx, fx.teamA1, '2026-09-01T12:30:00Z')).rejects.toMatchObject({
        code: '23000',
        constraint: 'responses_shift_coherence',
      });
      await db.query('ROLLBACK TO SAVEPOINT s');

      // Equipe de outro setor: barrada pela FK composta (team_id, sector_id).
      await db.query('SAVEPOINT s');
      await expect(insertAttributed(fx, fx.teamB1, '2026-09-01T12:00:00Z')).rejects.toMatchObject({
        code: expect.stringMatching(/^23/) as string,
      });
      await db.query('ROLLBACK TO SAVEPOINT s');
    });
  });

  it('rejeita resposta anterior à publicação da versão', async () => {
    await inRollback(db, async () => {
      const fx = await createFixture(db);
      await db.query('SAVEPOINT s');
      await expect(
        insertResponse(db, {
          versionId: fx.versionA2,
          sectorId: fx.sectorA,
          submittedAt: '2026-08-10T12:00:00Z',
        }),
      ).rejects.toMatchObject({ code: '23000', constraint: 'responses_after_version_publication' });
      await db.query('ROLLBACK TO SAVEPOINT s');
    });
  });
});

describe('manifestações, contatos e linha do tempo', () => {
  it('gera protocolo FHD-AAAA-NNNNNN pela sequência do banco', async () => {
    await inRollback(db, async () => {
      const fx = await createFixture(db);
      const id = await insertManifestation(db, { responseId: fx.responseA1, sectorId: fx.sectorA });
      const { rows } = await db.query<{ protocol: string }>(
        'SELECT protocol FROM manifestations WHERE id = $1',
        [id],
      );
      expect(rows[0]?.protocol).toMatch(/^FHD-\d{4}-\d{6}$/);
    });
  });

  it('valida contato: telefone ou e-mail, formatos e nome', async () => {
    await inRollback(db, async () => {
      const fx = await createFixture(db);
      const id = await insertManifestation(db, {
        responseId: fx.responseA1,
        sectorId: fx.sectorA,
        anonymous: false,
      });
      const insert =
        "INSERT INTO manifestation_contacts (manifestation_id, full_name, phone, email, consent_given_at, purpose_text_version) VALUES ($1, $2, $3, $4, now(), 'v1')";
      await expectDbError(db, insert, [id, 'Contato Fictício 001', null, null], {
        code: '23514',
        constraint: 'manifestation_contacts_phone_or_email',
      });
      await expectDbError(db, insert, [id, 'Contato Fictício 001', '519000001', null], {
        code: '23514',
        constraint: 'manifestation_contacts_phone_format',
      });
      await expectDbError(db, insert, [id, 'Contato Fictício 001', null, 'sem-arroba'], {
        code: '23514',
        constraint: 'manifestation_contacts_email_format',
      });
      await expectDbError(db, insert, [id, '   ', '51900000001', null], {
        code: '23514',
        constraint: 'manifestation_contacts_full_name_not_blank',
      });
      await db.query(insert, [
        id,
        'Contato Fictício 001',
        null,
        'contato.ficticio.001@example.com',
      ]);
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
      await expectDbError(db, 'UPDATE manifestations SET is_anonymous = true WHERE id = $1', [id], {
        code: '23000',
        constraint: 'manifestations_registration_immutable',
      });
      await expectDbError(
        db,
        "UPDATE manifestations SET description = 'Texto trocado depois' WHERE id = $1",
        [id],
        {
          code: '23000',
          constraint: 'manifestations_registration_immutable',
        },
      );
      await db.query(
        "UPDATE manifestations SET status = 'in_review', priority = 'high' WHERE id = $1",
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
        "UPDATE manifestations SET status = 'resolved', resolved_at = now() WHERE id = $1",
        [id],
        {
          code: '23514',
          constraint: 'manifestations_resolution_coherence',
        },
      );
      await expectDbError(
        db,
        "UPDATE manifestations SET status = 'resolved', resolved_at = now(), actions_taken = 'curto' WHERE id = $1",
        [id],
        { code: '23514', constraint: 'manifestations_resolution_coherence' },
      );
      await db.query(
        "UPDATE manifestations SET status = 'resolved', resolved_at = now(), actions_taken = 'Equipe orientada e retorno feito.' WHERE id = $1",
        [id],
      );
      const other = await insertResponse(db, { versionId: fx.versionA1, sectorId: fx.sectorA });
      await expectDbError(
        db,
        `INSERT INTO manifestations (response_id, sector_id, type, description, is_anonymous, triggered_by_low_score, idempotency_key, request_hash)
         VALUES ($1, $2, 'complaint', 'curta', true, false, gen_random_uuid(), $3)`,
        [other, fx.sectorA, HASH],
        { code: '23514', constraint: 'manifestations_description_length' },
      );
    });
  });

  it('aceita uma manifestação por resposta e exige o mesmo setor da resposta', async () => {
    await inRollback(db, async () => {
      const fx = await createFixture(db);
      await insertManifestation(db, { responseId: fx.responseA1, sectorId: fx.sectorA });
      await db.query('SAVEPOINT s');
      await expect(
        insertManifestation(db, { responseId: fx.responseA1, sectorId: fx.sectorA }),
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'manifestations_response_id_key',
      });
      await db.query('ROLLBACK TO SAVEPOINT s');
      const other = await insertResponse(db, { versionId: fx.versionA1, sectorId: fx.sectorA });
      await expect(
        insertManifestation(db, { responseId: other, sectorId: fx.sectorB }),
      ).rejects.toMatchObject({
        code: '23503',
        constraint: 'manifestations_response_id_sector_id_fkey',
      });
      await db.query('ROLLBACK TO SAVEPOINT s');
    });
  });

  it('valida eventos da linha do tempo e impede alterar ou excluir notas diretamente', async () => {
    await inRollback(db, async () => {
      const fx = await createFixture(db);
      const id = await insertManifestation(db, { responseId: fx.responseA1, sectorId: fx.sectorA });
      const insertNote =
        'INSERT INTO manifestation_notes (manifestation_id, author_id, kind, content, from_value, to_value) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id';
      await db.query(insertNote, [id, null, 'created', null, null, 'received']);
      const { rows } = await db.query<{ id: string }>(insertNote, [
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
        [id, fx.adminId, 'status_changed', null, 'received', null],
        {
          code: '23514',
          constraint: 'manifestation_notes_kind_rules',
        },
      );
      await expectDbError(db, insertNote, [id, null, 'note', 'Sem autor', null, null], {
        code: '23514',
        constraint: 'manifestation_notes_kind_rules',
      });
      await expectDbError(
        db,
        insertNote,
        [id, fx.adminId, 'contact_deleted', null, null, 'motivo-livre'],
        {
          code: '23514',
          constraint: 'manifestation_notes_kind_rules',
        },
      );
      await expectDbError(
        db,
        "UPDATE manifestation_notes SET content = 'editada' WHERE id = $1",
        [rows[0]?.id],
        {
          code: '23000',
          constraint: 'manifestation_notes_no_update',
        },
      );
      await expectDbError(db, 'DELETE FROM manifestation_notes WHERE id = $1', [rows[0]?.id], {
        code: '23000',
        constraint: 'manifestation_notes_no_direct_delete',
      });

      // Manutenção (retenção, Seção 10): excluir a manifestação remove as notas em cascata.
      await db.query('DELETE FROM manifestations WHERE id = $1', [id]);
      expect(
        await count(db, 'SELECT count(*) FROM manifestation_notes WHERE manifestation_id = $1', [
          id,
        ]),
      ).toBe(0);
    });
  });
});
