/**
 * Relatórios Excel — E34 com PostgreSQL real (ET09):
 * T20: gerar os três tipos e um vazio e abrir com ExcelJS → abas, cabeçalhos, tipos, datas, nome e
 * totais corretos; sem contatos.
 * T21: cada tipo por perfil; 11ª exportação; mais de 50.000 linhas → 403 conforme a matriz; 429;
 * 422; auditoria.
 */
import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../src/lib/prisma.js';
import { localDateOf, localTimeOf } from '../../src/utils/dates.js';
import { FakeSupabase } from '../fake-supabase.js';
import { errorOf } from '../helpers.js';
import {
  type AuthScenario,
  buildAuthApp,
  createAuthScenario,
  openConnections,
  type UserKey,
} from './auth-support.js';
import { type App, dataOf, submitResponse } from './et04-et06-support.js';
import { type Db, HASH } from './support.js';

let db: Db;
let prisma: PrismaClient;
let fake: FakeSupabase;
let scenario: AuthScenario;
let app: App;

const CONTACT = {
  fullName: 'Contato Fictício 970',
  email: 'c970@example.com',
  phone: '5190000970',
};
const DESCRIPTION = 'Atendimento demorado na recepção, sem aviso sobre a espera.';

/** Lê o corpo binário do Supertest. */
function binary(res: request.Response, callback: (error: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => {
    callback(null, Buffer.concat(chunks));
  });
}

function exportAs(key: UserKey, query: string, target: App = app) {
  return request(target)
    .get(`/api/v1/reports/export?${query}`)
    .set('Authorization', scenario.bearer(key))
    .buffer(true)
    .parse(binary);
}

async function workbookOf(response: request.Response): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const body = response.body as Buffer;
  // ExcelJS tipa o parâmetro como ArrayBuffer; a cópia evita o Buffer compartilhado do Node.
  await workbook.xlsx.load(
    body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
  );
  return workbook;
}

function sheet(workbook: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const found = workbook.getWorksheet(name);
  if (found === undefined) throw new Error(`Aba ${name} ausente.`);
  return found;
}

function header(ws: ExcelJS.Worksheet): string[] {
  return (ws.getRow(1).values as unknown[]).slice(1).map(String);
}

/** Valor da coluna B na linha cujo rótulo (coluna A) é `label`. */
function valueOf(ws: ExcelJS.Worksheet, label: string): ExcelJS.CellValue {
  let found: ExcelJS.CellValue = undefined;
  ws.eachRow((row) => {
    if (row.getCell(1).value === label) found = row.getCell(2).value;
  });
  return found;
}

/** Todo o texto do arquivo, para procurar dados que não podem aparecer. */
function allText(workbook: ExcelJS.Workbook): string {
  const parts: string[] = [];
  workbook.eachSheet((ws) => {
    ws.eachRow((row) => {
      row.eachCell((cell) => parts.push(cell.text));
    });
  });
  return parts.join('\n');
}

const reportAudits = async (profileId: string) =>
  (
    await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit_logs WHERE action = 'REPORT_EXPORTED' AND actor_profile_id = $1",
      [profileId],
    )
  ).rows[0]?.n ?? 0;

let submittedAt: string;

beforeAll(async () => {
  ({ db, prisma } = await openConnections());
  fake = new FakeSupabase();
  scenario = await createAuthScenario(db, fake);
  app = buildAuthApp(prisma, fake);

  // Três avaliações reais no período padrão (últimos 30 dias) e uma manifestação com contato.
  for (const [npsScore, score] of [
    [10, 4],
    [6, 2],
    [8, null],
  ] as const) {
    const sent = await submitResponse(app, {
      surveyVersionId: scenario.fx.versionA2,
      origin: 'link',
      npsScore,
      answers: score === null ? [] : [{ questionId: scenario.fx.specificA, score }],
    });
    expect(sent.status).toBe(201);
    const data = dataOf<{
      responseId: string;
      submittedAt: string;
      manifestation: { token: string };
    }>(sent);
    submittedAt = data.submittedAt;
    if (npsScore === 6) {
      const created = await request(app)
        .post('/api/v1/public/manifestations')
        .set('Idempotency-Key', crypto.randomUUID())
        .send({
          responseId: data.responseId,
          manifestationToken: data.manifestation.token,
          type: 'complaint',
          description: DESCRIPTION,
          anonymous: false,
          contact: { ...CONTACT, consent: true },
        });
      expect(created.status).toBe(201);
    }
  }
});

afterAll(async () => {
  await prisma.$disconnect();
  await db.end();
});

describe('T20 — relatório de respostas', () => {
  it('abre com ExcelJS: nome, abas, cabeçalhos, células tipadas, datas locais e totais do E28', async () => {
    const before = await reportAudits(scenario.users.ge.profileId);
    const response = await exportAs('ge', 'type=responses');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-disposition']).toMatch(
      /^attachment; filename="fhdod_respostas_\d{8}-\d{8}_gerado-\d{12}\.xlsx"$/,
    );

    const workbook = await workbookOf(response);
    expect(workbook.worksheets.map((ws) => ws.name)).toEqual([
      'Filtros',
      'Indicadores',
      'Respostas',
      'Respostas por pergunta',
    ]);
    const answers = sheet(workbook, 'Respostas');
    expect(header(answers)).toEqual([
      'ID',
      'Data e hora',
      'Setor',
      'Pesquisa',
      'Versão',
      'Origem',
      'Turno',
      'Equipe',
      'Atribuição',
      'Nota',
      'Classificação',
      'Nota baixa',
    ]);
    expect(answers.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(answers.rowCount).toBe(1 + 3);
    const last = answers.getRow(4);
    expect(last.getCell(2).value).toBeInstanceOf(Date);
    expect(last.getCell(2).numFmt).toBe('dd/mm/yyyy hh:mm');
    // Horário de parede de America/Sao_Paulo (RNF29).
    const instant = new Date(submittedAt);
    expect((last.getCell(2).value as Date).toISOString().slice(0, 16)).toBe(
      `${localDateOf(instant)}T${localTimeOf(instant)}`,
    );
    expect(typeof last.getCell(10).value).toBe('number');
    expect(last.getCell(10).value).toBe(8);
    expect(last.getCell(11).value).toBe('Passivo');
    expect(last.getCell(12).value).toBe('Não');
    expect(answers.getRow(3).getCell(12).value).toBe('Sim');
    expect(answers.getRow(2).getCell(6).value).toBe('Link');
    // Turno e equipe vazios (resposta não atribuída) ficam em branco.
    expect(answers.getRow(2).getCell(7).value).toBeNull();

    const perQuestion = sheet(workbook, 'Respostas por pergunta');
    expect(perQuestion.rowCount).toBe(1 + 2);
    expect(perQuestion.getRow(2).getCell(8).value).toBe(4);

    // Totais iguais aos da tela (RF62).
    const summary = dataOf<{ indicators: { n: number; nps: number } }>(
      await request(app)
        .get('/api/v1/dashboard/summary')
        .set('Authorization', scenario.bearer('ge')),
    );
    const filters = sheet(workbook, 'Filtros');
    expect(valueOf(filters, 'Total de registros')).toBe(summary.indicators.n);
    expect(valueOf(sheet(workbook, 'Indicadores'), 'NPS')).toBe(summary.indicators.nps);
    expect(valueOf(filters, 'Relatório')).toBe('Respostas');
    expect(valueOf(filters, 'Gerado em')).toBeInstanceOf(Date);

    // RF63: sem nome, telefone, e-mail ou texto livre.
    const text = allText(workbook);
    for (const forbidden of [CONTACT.fullName, CONTACT.email, CONTACT.phone, DESCRIPTION]) {
      expect(text).not.toContain(forbidden);
    }
    expect(await reportAudits(scenario.users.ge.profileId)).toBe(before + 1);
  });

  it('filtro sem resultados → 200, arquivo válido com mensagem e total 0', async () => {
    const response = await exportAs('ge', 'type=responses&from=2020-01-01&to=2020-01-31');
    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain('fhdod_respostas_20200101-20200131_');
    const workbook = await workbookOf(response);
    const answers = sheet(workbook, 'Respostas');
    expect(answers.rowCount).toBe(2);
    expect(answers.getRow(2).getCell(1).value).toBe(
      'Nenhum registro encontrado para os filtros aplicados.',
    );
    expect(valueOf(sheet(workbook, 'Filtros'), 'Total de registros')).toBe(0);
    expect(valueOf(sheet(workbook, 'Indicadores'), 'NPS')).toBeNull();
  });
});

describe('T20 — relatório de indicadores', () => {
  it('abas Filtros, Resumo, Por setor, Por pergunta e Tendência com valores de E28, E29, E32 e E33', async () => {
    const response = await exportAs('as', 'type=indicators');
    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain('fhdod_indicadores_');
    const workbook = await workbookOf(response);
    expect(workbook.worksheets.map((ws) => ws.name)).toEqual([
      'Filtros',
      'Resumo',
      'Por setor',
      'Por pergunta',
      'Tendência',
    ]);
    const get = (path: string) =>
      request(app).get(`/api/v1/dashboard/${path}`).set('Authorization', scenario.bearer('as'));
    const summary = dataOf<{ indicators: { n: number; nps: number } }>(await get('summary'));
    const sectors = dataOf<{ name: string; indicators: { n: number; nps: number | null } }[]>(
      await get('sectors'),
    );
    const trends = dataOf<{ n: number }[]>(await get('trends'));
    const questions = dataOf<{ n: number; average: number }[]>(await get('questions'));

    const resumo = sheet(workbook, 'Resumo');
    expect(valueOf(resumo, 'Respostas consideradas (n)')).toBe(summary.indicators.n);
    expect(valueOf(resumo, 'NPS')).toBe(summary.indicators.nps);

    const bySector = sheet(workbook, 'Por setor');
    expect(bySector.rowCount).toBe(1 + sectors.length);
    expect(bySector.getRow(2).getCell(1).value).toBe(sectors[0]?.name);
    expect(bySector.getRow(2).getCell(4).value).toBe(sectors[0]?.indicators.n);

    const byQuestion = sheet(workbook, 'Por pergunta');
    expect(byQuestion.getRow(2).getCell(4).value).toBe(questions[0]?.n);
    expect(byQuestion.getRow(2).getCell(5).value).toBe(questions[0]?.average);

    const trend = sheet(workbook, 'Tendência');
    expect(trend.rowCount).toBe(1 + trends.length);
    let total = 0;
    trend.eachRow((row, index) => {
      if (index > 1) total += Number(row.getCell(3).value ?? 0);
    });
    expect(total).toBe(summary.indicators.n);
  });
});

describe('T20 — relatório de manifestações (Ouvidoria)', () => {
  it('sem includeText: sem descrição nem providências; nunca contato', async () => {
    const response = await exportAs('ou', 'type=manifestations');
    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain('fhdod_manifestacoes_');
    const workbook = await workbookOf(response);
    expect(workbook.worksheets.map((ws) => ws.name)).toEqual(['Filtros', 'Manifestações']);
    const ws = sheet(workbook, 'Manifestações');
    expect(header(ws)).toEqual([
      'Protocolo',
      'Recebida em',
      'Concluída em',
      'Setor',
      'Tipo',
      'Status',
      'Prioridade',
      'Anônima',
      'Possui contato',
    ]);
    expect(ws.rowCount).toBe(2);
    const row = ws.getRow(2);
    expect(row.getCell(1).text).toMatch(/^FHD-\d{4}-\d{6}$/);
    expect(row.getCell(2).value).toBeInstanceOf(Date);
    expect(row.getCell(3).value).toBeNull();
    expect([
      row.getCell(5).value,
      row.getCell(6).value,
      row.getCell(8).value,
      row.getCell(9).value,
    ]).toEqual(['Reclamação', 'Recebida', 'Não', 'Sim']);
    const text = allText(workbook);
    for (const forbidden of [CONTACT.fullName, CONTACT.email, CONTACT.phone, DESCRIPTION]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('com includeText=true: descrição e providências; contato continua ausente', async () => {
    const response = await exportAs(
      'ou',
      'type=manifestations&includeText=true&manifestationType=complaint&status=received',
    );
    const workbook = await workbookOf(response);
    const ws = sheet(workbook, 'Manifestações');
    expect(header(ws).slice(-2)).toEqual(['Descrição', 'Providências']);
    expect(ws.getRow(2).getCell(10).value).toBe(DESCRIPTION);
    expect(valueOf(sheet(workbook, 'Filtros'), 'Incluir textos')).toBe('Sim');
    const text = allText(workbook);
    for (const forbidden of [CONTACT.fullName, CONTACT.email, CONTACT.phone]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('filtro de status sem resultados → arquivo com mensagem', async () => {
    const response = await exportAs('ou', 'type=manifestations&status=resolved');
    const ws = sheet(await workbookOf(response), 'Manifestações');
    expect(ws.getRow(2).getCell(1).value).toBe(
      'Nenhum registro encontrado para os filtros aplicados.',
    );
  });
});

describe('T21 — bloqueio de exportação não autorizada', () => {
  const MATRIX: Record<'responses' | 'indicators' | 'manifestations', UserKey[]> = {
    responses: ['sa', 'as', 'ge'],
    indicators: ['sa', 'as', 'ge'],
    manifestations: ['ou'],
  };

  it.each(['responses', 'indicators', 'manifestations'] as const)(
    'type=%s: cada perfil → 200 ou 403 conforme a matriz; uma auditoria por exportação',
    async (type) => {
      const target = buildAuthApp(prisma, fake);
      for (const key of ['sa', 'as', 'ge', 'ou', 'vi'] as const) {
        const before = await reportAudits(scenario.users[key].profileId);
        const response = await exportAs(key, `type=${type}`, target);
        if (MATRIX[type].includes(key)) {
          expect(response.status).toBe(200);
          expect(await reportAudits(scenario.users[key].profileId)).toBe(before + 1);
        } else {
          expect(response.status).toBe(403);
          expect(await reportAudits(scenario.users[key].profileId)).toBe(before);
        }
      }
    },
  );

  it('auditoria registra tipo, período e linhas, sem dados pessoais', async () => {
    await exportAs('ge', 'type=responses', buildAuthApp(prisma, fake));
    const { rows } = await db.query<{
      entity_type: string;
      entity_id: string;
      details: Record<string, unknown>;
    }>(
      `SELECT entity_type, entity_id, details FROM audit_logs
       WHERE action = 'REPORT_EXPORTED' AND actor_profile_id = $1 ORDER BY id DESC LIMIT 1`,
      [scenario.users.ge.profileId],
    );
    expect(rows[0]).toMatchObject({
      entity_type: 'report',
      entity_id: 'responses',
      details: { type: 'responses', rows: 3, includeText: false, sectorIds: 'all' },
    });
  });

  it('AS filtrando setor fora do escopo → 403 SECTOR_OUT_OF_SCOPE; tipo inválido → 400', async () => {
    const outside = await exportAs('as', `type=responses&sectorIds=${scenario.fx.sectorB}`);
    expect(outside.status).toBe(403);
    expect(errorOf({ body: JSON.parse((outside.body as Buffer).toString()) as unknown }).code).toBe(
      'SECTOR_OUT_OF_SCOPE',
    );
    expect((await exportAs('ge', 'type=pdf')).status).toBe(400);
    expect((await exportAs('ge', 'type=responses&includeText=true')).status).toBe(400);
  });

  it('11ª exportação em 10 minutos → 429 com Retry-After', async () => {
    const target = buildAuthApp(prisma, fake);
    for (let index = 0; index < 10; index += 1) {
      expect((await exportAs('ge', 'type=indicators', target)).status).toBe(200);
    }
    const blocked = await exportAs('ge', 'type=indicators', target);
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  describe('mais de 50.000 linhas', () => {
    let large: AuthScenario;

    beforeAll(async () => {
      large = await createAuthScenario(db, fake);
      // 50.001 respostas fictícias num hospital exclusivo (removidas ao final).
      await db.query(
        `INSERT INTO responses (survey_version_id, sector_id, origin, nps_score, low_score, submitted_at,
           attribution_status, idempotency_key, request_hash, manifestation_token_expires_at)
         SELECT $1, $2, 'link', 9, false, ts, 'not_qr_origin', gen_random_uuid(), $3, ts + interval '60 minutes'
         FROM (SELECT timestamptz '2026-09-15T12:00:00Z' + (n || ' milliseconds')::interval AS ts
               FROM generate_series(1, 50001) AS n) series`,
        [large.fx.versionA2, large.fx.sectorA, HASH],
      );
    }, 120_000);

    afterAll(async () => {
      await db.query('DELETE FROM responses WHERE survey_version_id = $1', [large.fx.versionA2]);
    });

    it('→ 422 EXPORT_TOO_LARGE e nenhuma auditoria de exportação', async () => {
      const before = await reportAudits(large.users.ge.profileId);
      const response = await request(buildAuthApp(prisma, fake))
        .get('/api/v1/reports/export?type=responses&from=2026-09-15&to=2026-09-15')
        .set('Authorization', large.bearer('ge'));
      expect(response.status).toBe(422);
      expect(errorOf(response).code).toBe('EXPORT_TOO_LARGE');
      expect(await reportAudits(large.users.ge.profileId)).toBe(before);
    }, 120_000);
  });
});
