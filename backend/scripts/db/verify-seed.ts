/**
 * Verifica, por consultas ao banco, as contagens e as relações produzidas pelo seed (ET02).
 * Uso: `npm run db:seed:verify [-- --out caminho.md]`. Somente leitura.
 * Termina com código 1 se alguma verificação divergir do esperado.
 *
 * A "impressão digital" (md5 por tabela, sem auth_user_id, que depende do Supabase Auth local)
 * permite comparar duas execuções do seed com a mesma SEED_REFERENCE_DATE.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import pg from 'pg';

import { describeUrl } from './guard.js';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

interface Check {
  name: string;
  sql: string;
  expected: number | ((value: number) => boolean);
  expectedLabel?: string;
}

const CHECKS: Check[] = [
  { name: 'Hospitais', sql: 'SELECT count(*) FROM hospitals', expected: 1 },
  { name: 'Setores', sql: 'SELECT count(*) FROM sectors', expected: 6 },
  { name: 'Equipes', sql: 'SELECT count(*) FROM teams', expected: 18 },
  {
    name: 'Setores sem exatamente 3 equipes',
    sql: 'SELECT count(*) FROM (SELECT s.id FROM sectors s LEFT JOIN teams t ON t.sector_id = s.id GROUP BY s.id HAVING count(t.id) <> 3) x',
    expected: 0,
  },
  { name: 'Etapas da jornada', sql: 'SELECT count(*) FROM journey_stages', expected: 4 },
  { name: 'Pesquisas', sql: 'SELECT count(*) FROM survey_configs', expected: 6 },
  {
    name: 'Pesquisas com versão vigente',
    sql: 'SELECT count(*) FROM survey_configs WHERE current_version_id IS NOT NULL',
    expected: 6,
  },
  { name: 'Versões publicadas', sql: 'SELECT count(*) FROM survey_versions', expected: 7 },
  {
    name: 'Versões do Pronto Atendimento (v1 e v2)',
    sql: "SELECT count(*) FROM survey_versions v JOIN sectors s ON s.id = v.sector_id WHERE s.code = 'PA'",
    expected: 2,
  },
  {
    name: 'Versões substituídas (v1 do PA)',
    sql: 'SELECT count(*) FROM survey_versions WHERE superseded_at IS NOT NULL',
    expected: 1,
  },
  { name: 'Perguntas', sql: 'SELECT count(*) FROM questions', expected: 43 },
  {
    name: 'Perguntas gerais (nps), uma por pesquisa',
    sql: "SELECT count(*) FROM questions WHERE type = 'nps'",
    expected: 6,
  },
  {
    name: 'Perguntas das versões',
    sql: 'SELECT count(*) FROM survey_version_questions',
    expected: 49,
  },
  { name: 'Usuários de demonstração', sql: 'SELECT count(*) FROM profiles', expected: 6 },
  {
    name: 'Usuários fora de @example.com',
    sql: "SELECT count(*) FROM profiles WHERE email NOT LIKE '%@example.com'",
    expected: 0,
  },
  { name: 'Perfis distintos', sql: 'SELECT count(DISTINCT role) FROM profiles', expected: 5 },
  {
    name: 'Turnos (rodízio de 3 períodos × 150 dias × 6 setores + reforços do PA)',
    sql: 'SELECT count(*) FROM shifts',
    expected: (value) => value > 2700,
    expectedLabel: '> 2.700',
  },
  {
    name: 'Dias locais distintos com turnos',
    sql: "SELECT count(DISTINCT (starts_at AT TIME ZONE 'America/Sao_Paulo')::date) FROM shifts",
    expected: 150,
  },
  {
    name: 'Turnos de reforço do PA (sobreposição entre equipes)',
    sql: "SELECT count(*) FROM shifts sh JOIN sectors s ON s.id = sh.sector_id WHERE s.code = 'PA' AND (sh.starts_at AT TIME ZONE 'America/Sao_Paulo')::time = '10:00'",
    expected: (value) => value > 0,
    expectedLabel: '> 0',
  },
  {
    name: 'Turnos cancelados',
    sql: 'SELECT count(*) FROM shifts WHERE cancelled_at IS NOT NULL',
    expected: 12,
  },
  { name: 'Respostas', sql: 'SELECT count(*) FROM responses', expected: 2400 },
  {
    name: 'Respostas ambíguas (todas no PA)',
    sql: "SELECT count(*) FROM responses r JOIN sectors s ON s.id = r.sector_id WHERE r.attribution_status = 'ambiguous' AND s.code = 'PA'",
    expected: (value) => value > 0,
    expectedLabel: '> 0',
  },
  {
    name: 'Respostas ambíguas fora do PA',
    sql: "SELECT count(*) FROM responses r JOIN sectors s ON s.id = r.sector_id WHERE r.attribution_status = 'ambiguous' AND s.code <> 'PA'",
    expected: 0,
  },
  {
    name: 'Respostas atribuídas a turno e equipe',
    sql: "SELECT count(*) FROM responses WHERE attribution_status = 'attributed'",
    expected: (value) => value > 0,
    expectedLabel: '> 0',
  },
  {
    name: 'Respostas por link (not_qr_origin)',
    sql: "SELECT count(*) FROM responses WHERE origin = 'link' AND attribution_status = 'not_qr_origin'",
    expected: (value) => value > 0,
    expectedLabel: '> 0',
  },
  {
    name: 'Respostas com setor diferente do setor da versão',
    sql: 'SELECT count(*) FROM responses r JOIN survey_versions v ON v.id = r.survey_version_id WHERE v.sector_id <> r.sector_id',
    expected: 0,
  },
  {
    name: 'Notas específicas de outra versão',
    sql: 'SELECT count(*) FROM response_answers a JOIN responses r ON r.id = a.response_id JOIN survey_version_questions q ON q.id = a.survey_version_question_id WHERE a.survey_version_id <> r.survey_version_id OR q.survey_version_id <> r.survey_version_id',
    expected: 0,
  },
  {
    name: 'low_score incoerente com as notas',
    sql: 'SELECT count(*) FROM responses r WHERE r.low_score <> (r.nps_score <= 6 OR EXISTS (SELECT 1 FROM response_answers a WHERE a.response_id = r.id AND a.score <= 2))',
    expected: 0,
  },
  { name: 'Manifestações', sql: 'SELECT count(*) FROM manifestations', expected: 180 },
  {
    name: 'Manifestações com contato fictício (40%)',
    sql: 'SELECT count(*) FROM manifestation_contacts',
    expected: 72,
  },
  {
    name: 'Manifestações não anônimas',
    sql: 'SELECT count(*) FROM manifestations WHERE NOT is_anonymous',
    expected: 72,
  },
  {
    name: 'Contatos em manifestações anônimas',
    sql: 'SELECT count(*) FROM manifestation_contacts c JOIN manifestations m ON m.id = c.manifestation_id WHERE m.is_anonymous',
    expected: 0,
  },
  {
    name: 'Contatos fora do padrão fictício (nome, telefone 5190000NNNN, e-mail example.com)',
    sql: "SELECT count(*) FROM manifestation_contacts WHERE full_name NOT LIKE 'Contato Fictício %' OR (phone IS NOT NULL AND phone NOT LIKE '5190000%') OR (email IS NOT NULL AND email NOT LIKE '%@example.com')",
    expected: 0,
  },
  {
    name: 'Protocolos no formato FHD-AAAA-NNNNNN',
    sql: "SELECT count(*) FROM manifestations WHERE protocol ~ '^FHD-[0-9]{4}-[0-9]{6}$'",
    expected: 180,
  },
  {
    name: 'Manifestações cuja nota baixa diverge da resposta',
    sql: 'SELECT count(*) FROM manifestations m JOIN responses r ON r.id = m.response_id WHERE m.triggered_by_low_score <> r.low_score',
    expected: 0,
  },
  {
    name: 'Tokens de manifestação consumidos',
    sql: 'SELECT count(*) FROM responses WHERE manifestation_token_used_at IS NOT NULL',
    expected: 180,
  },
  {
    name: 'Manifestações sem evento de criação na linha do tempo',
    sql: "SELECT count(*) FROM manifestations m WHERE NOT EXISTS (SELECT 1 FROM manifestation_notes n WHERE n.manifestation_id = m.id AND n.kind = 'created')",
    expected: 0,
  },
  {
    name: 'Arquivadas sem nota de motivo',
    sql: "SELECT count(*) FROM manifestations m WHERE m.status = 'archived' AND NOT EXISTS (SELECT 1 FROM manifestation_notes n WHERE n.manifestation_id = m.id AND n.kind = 'note')",
    expected: 0,
  },
  { name: 'Registros de auditoria', sql: 'SELECT count(*) FROM audit_logs', expected: 0 },
];

const DISTRIBUTIONS: { title: string; sql: string }[] = [
  {
    title: 'Respostas por setor',
    sql: 'SELECT s.code AS chave, count(r.id)::int AS total FROM sectors s LEFT JOIN responses r ON r.sector_id = s.id GROUP BY s.code ORDER BY s.code',
  },
  {
    title: 'Respostas por status de atribuição',
    sql: 'SELECT attribution_status::text AS chave, count(*)::int AS total FROM responses GROUP BY 1 ORDER BY 1',
  },
  {
    title: 'Respostas por origem',
    sql: 'SELECT origin::text AS chave, count(*)::int AS total FROM responses GROUP BY 1 ORDER BY 1',
  },
  {
    title: 'Respostas por versão do PA',
    sql: "SELECT 'v' || v.version_number AS chave, count(r.id)::int AS total FROM survey_versions v JOIN sectors s ON s.id = v.sector_id LEFT JOIN responses r ON r.survey_version_id = v.id WHERE s.code = 'PA' GROUP BY v.version_number ORDER BY v.version_number",
  },
  {
    title: 'Manifestações por tipo',
    sql: 'SELECT type::text AS chave, count(*)::int AS total FROM manifestations GROUP BY 1 ORDER BY 1',
  },
  {
    title: 'Manifestações por status',
    sql: 'SELECT status::text AS chave, count(*)::int AS total FROM manifestations GROUP BY 1 ORDER BY 1',
  },
  {
    title: 'Contatos por canal',
    sql: "SELECT CASE WHEN phone IS NOT NULL AND email IS NOT NULL THEN 'telefone e e-mail' WHEN phone IS NOT NULL THEN 'somente telefone' ELSE 'somente e-mail' END AS chave, count(*)::int AS total FROM manifestation_contacts GROUP BY 1 ORDER BY 1",
  },
  {
    title: 'Linha do tempo por tipo de evento',
    sql: 'SELECT kind::text AS chave, count(*)::int AS total FROM manifestation_notes GROUP BY 1 ORDER BY 1',
  },
  {
    title: 'Outras contagens',
    sql: "SELECT 'response_answers' AS chave, count(*)::int AS total FROM response_answers UNION ALL SELECT 'manifestation_notes', count(*)::int FROM manifestation_notes UNION ALL SELECT 'profile_sectors', count(*)::int FROM profile_sectors UNION ALL SELECT 'shift_imports', count(*)::int FROM shift_imports UNION ALL SELECT 'shifts', count(*)::int FROM shifts",
  },
];

const NPS_SQL = `SELECT count(*)::int AS total,
  count(*) FILTER (WHERE nps_score >= 9)::int AS promoters,
  count(*) FILTER (WHERE nps_score IN (7, 8))::int AS passives,
  count(*) FILTER (WHERE nps_score <= 6)::int AS detractors,
  ROUND(100.0 * (count(*) FILTER (WHERE nps_score >= 9) - count(*) FILTER (WHERE nps_score <= 6))
    / NULLIF(count(*), 0), 1)::text AS nps
FROM responses`;

const FINGERPRINT_TABLES: [string, string][] = [
  ['hospitals', 'id'],
  ['sectors', 'id'],
  ['teams', 'id'],
  ['journey_stages', 'id'],
  ['profiles', 'id'],
  ['profile_sectors', 'profile_id, sector_id'],
  ['survey_configs', 'id'],
  ['questions', 'id'],
  ['survey_versions', 'id'],
  ['survey_version_questions', 'id'],
  ['shifts', 'id'],
  ['responses', 'id'],
  ['response_answers', 'id'],
  ['manifestations', 'id'],
  ['manifestation_contacts', 'manifestation_id'],
  ['manifestation_notes', 'id'],
];

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === '')
    throw new Error('DATABASE_URL não definida.');
  const outIndex = process.argv.indexOf('--out');
  const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const lines: string[] = [];
  let failures = 0;
  try {
    const meta = await client.query<{ now: string; version: string }>(
      "SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS now, current_setting('server_version') AS version",
    );
    lines.push(`# Verificação do seed — ${meta.rows[0]?.now ?? ''}`, '');
    lines.push(
      `- Banco: \`${describeUrl(databaseUrl)}\` (PostgreSQL ${meta.rows[0]?.version ?? '?'})`,
    );
    lines.push('- Comando: `npm run db:seed:verify -w backend`', '');
    lines.push('| Verificação | Esperado | Obtido | Resultado |', '| --- | --- | --- | --- |');
    for (const check of CHECKS) {
      const { rows } = await client.query<{ count: string }>(check.sql);
      const value = Number(rows[0]?.count ?? Number.NaN);
      const ok =
        typeof check.expected === 'number' ? value === check.expected : check.expected(value);
      if (!ok) failures += 1;
      const expected =
        typeof check.expected === 'number' ? String(check.expected) : (check.expectedLabel ?? '');
      lines.push(`| ${check.name} | ${expected} | ${value} | ${ok ? 'APROVADO' : 'REPROVADO'} |`);
    }

    for (const distribution of DISTRIBUTIONS) {
      const { rows } = await client.query<{ chave: string; total: number }>(distribution.sql);
      lines.push('', `## ${distribution.title}`, '', '| Item | Total |', '| --- | --- |');
      for (const row of rows) lines.push(`| ${row.chave} | ${row.total} |`);
    }

    const nps = await client.query<{
      total: number;
      promoters: number;
      passives: number;
      detractors: number;
      nps: string | null;
    }>(NPS_SQL);
    const n = nps.rows[0];
    lines.push('', '## NPS geral do conjunto (consulta da Seção 8)', '');
    lines.push(
      `Total ${n?.total ?? 0}; promotores ${n?.promoters ?? 0}; passivos ${n?.passives ?? 0}; detratores ${n?.detractors ?? 0}; NPS ${n?.nps ?? 'nulo'}.`,
    );

    lines.push(
      '',
      '## Impressão digital (md5 por tabela)',
      '',
      '| Tabela | md5 |',
      '| --- | --- |',
    );
    for (const [table, orderBy] of FINGERPRINT_TABLES) {
      const { rows } = await client.query<{ md5: string | null }>(
        `SELECT md5(string_agg((to_jsonb(t) - 'auth_user_id')::text, '|' ORDER BY ${orderBy})) AS md5 FROM ${table} t`,
      );
      lines.push(`| ${table} | \`${rows[0]?.md5 ?? '(vazia)'}\` |`);
    }

    lines.push(
      '',
      failures === 0 ? '**Resultado: APROVADO**' : `**Resultado: REPROVADO (${failures})**`,
    );
  } finally {
    await client.end();
  }

  const report = `${lines.join('\n')}\n`;
  process.stdout.write(report);
  if (outPath !== undefined) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, report, 'utf8');
  }
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
