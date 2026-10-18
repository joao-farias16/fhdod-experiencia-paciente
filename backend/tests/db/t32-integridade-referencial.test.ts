/**
 * T32 — Integridade referencial (Tabela 23; RNF18): com PostgreSQL real, o banco rejeita
 * resposta com pergunta de outra versão, setor divergente, contato em manifestação anônima,
 * turno sobreposto, exclusão de setor referenciado e UPDATE de versão publicada.
 *
 * Cada cenário: (1) prepara registros válidos; (2) consulta o estado inicial; (3) executa a
 * operação inválida diretamente no PostgreSQL (SQL puro, sem validação da aplicação); (4) confere
 * o SQLSTATE e o nome da restrição ou do gatilho; (5) consulta de novo e comprova que nada
 * inválido foi gravado. Tudo roda numa transação desfeita ao final.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  connect,
  count,
  createFixture,
  type Db,
  expectDbError,
  type Fixture,
  inRollback,
  insertManifestation,
  insertResponse,
  recordEvidence,
  writeEvidence,
} from './support.js';

let db: Db;

beforeAll(async () => {
  db = await connect();
});

afterAll(async () => {
  writeEvidence('t32-resultado.json');
  await db.end();
});

describe('T32 — integridade referencial garantida pelo PostgreSQL', () => {
  let fx: Fixture;

  beforeEach(async () => {
    // Garante que nenhum teste anterior deixou transação aberta.
    await db.query('ROLLBACK').catch(() => undefined);
  });

  it('cenário 1: rejeita nota de resposta com pergunta de outra versão (FK composta)', async () => {
    await inRollback(db, async () => {
      fx = await createFixture(db);
      const answersOf = () =>
        count(db, 'SELECT count(*) FROM response_answers WHERE response_id = $1', [fx.responseA1]);
      const before = await answersOf();

      // A resposta é da v1; a pergunta específica é a da v2 (mesma pesquisa, outra versão).
      const viaQuestion = await expectDbError(
        db,
        `INSERT INTO response_answers (response_id, survey_version_id, survey_version_question_id, question_type, score)
         VALUES ($1, $2, $3, 'scale_1_5', 4)`,
        [fx.responseA1, fx.versionA1, fx.svqA2Specific],
        { code: '23503', constraint: 'response_answers_svq_version_type_fkey' },
      );
      // Mesmo informando a versão da pergunta, a resposta não pertence a ela.
      const viaResponse = await expectDbError(
        db,
        `INSERT INTO response_answers (response_id, survey_version_id, survey_version_question_id, question_type, score)
         VALUES ($1, $2, $3, 'scale_1_5', 4)`,
        [fx.responseA1, fx.versionA2, fx.svqA2Specific],
        { code: '23503', constraint: 'response_answers_response_id_survey_version_id_fkey' },
      );

      const after = await answersOf();
      expect(after).toBe(before);

      // Controle positivo: a pergunta da própria versão é aceita.
      await db.query(
        `INSERT INTO response_answers (response_id, survey_version_id, survey_version_question_id, question_type, score)
         VALUES ($1, $2, $3, 'scale_1_5', 4)`,
        [fx.responseA1, fx.versionA1, fx.svqA1Specific],
      );
      expect(await answersOf()).toBe(before + 1);

      recordEvidence({
        scenario: '1 — Pergunta de outra versão',
        operation: 'INSERT em response_answers com a pergunta da v2 numa resposta da v1',
        mechanism:
          'FKs compostas response_answers_svq_version_type_fkey e response_answers_response_id_survey_version_id_fkey',
        sqlstate: viaQuestion.code,
        constraint: `${viaQuestion.constraint ?? ''}; ${viaResponse.constraint ?? ''}`,
        message: viaQuestion.message,
        before: { response_answers: before },
        after: { response_answers: after },
      });
    });
  });

  it('cenário 2: rejeita resposta com setor diferente do setor da versão (FK composta)', async () => {
    await inRollback(db, async () => {
      fx = await createFixture(db);
      const responsesOfVersion = () =>
        count(db, 'SELECT count(*) FROM responses WHERE survey_version_id = $1', [fx.versionA1]);
      const before = await responsesOfVersion();

      const error = await expectDbError(
        db,
        `INSERT INTO responses (survey_version_id, sector_id, origin, nps_score, low_score, submitted_at,
           attribution_status, idempotency_key, request_hash, manifestation_token_expires_at)
         VALUES ($1, $2, 'link', 9, false, '2026-09-01T12:00:00Z', 'not_qr_origin', gen_random_uuid(),
           repeat('a', 64), '2026-09-01T13:00:00Z')`,
        [fx.versionA1, fx.sectorB],
        { code: '23503', constraint: 'responses_survey_version_id_sector_id_fkey' },
      );

      const after = await responsesOfVersion();
      expect(after).toBe(before);
      expect(
        await count(db, 'SELECT count(*) FROM responses WHERE sector_id = $1', [fx.sectorB]),
      ).toBe(0);

      // Controle positivo: com o setor da versão, a resposta é aceita.
      await insertResponse(db, { versionId: fx.versionA1, sectorId: fx.sectorA });
      expect(await responsesOfVersion()).toBe(before + 1);

      recordEvidence({
        scenario: '2 — Setor divergente',
        operation: 'INSERT em responses com a versão do setor A e sector_id do setor B',
        mechanism:
          'FK composta responses_survey_version_id_sector_id_fkey → survey_versions(id, sector_id)',
        sqlstate: error.code,
        constraint: error.constraint,
        message: error.message,
        before: { responses_da_versao: before },
        after: { responses_da_versao: after },
      });
    });
  });

  it('cenário 3: rejeita contato em manifestação anônima (gatilho)', async () => {
    await inRollback(db, async () => {
      fx = await createFixture(db);
      const manifestationId = await insertManifestation(db, {
        responseId: fx.responseA1,
        sectorId: fx.sectorA,
        anonymous: true,
      });
      const contactsOf = (id: string) =>
        count(db, 'SELECT count(*) FROM manifestation_contacts WHERE manifestation_id = $1', [id]);
      const before = await contactsOf(manifestationId);

      const error = await expectDbError(
        db,
        `INSERT INTO manifestation_contacts (manifestation_id, full_name, email, consent_given_at, purpose_text_version)
         VALUES ($1, 'Contato Fictício 999', 'contato.ficticio.999@example.com', now(), 'v1')`,
        [manifestationId],
        { code: '23000', constraint: 'manifestation_contacts_not_anonymous' },
      );

      const after = await contactsOf(manifestationId);
      expect(after).toBe(0);
      expect(
        await count(db, 'SELECT count(*) FROM manifestations WHERE id = $1 AND is_anonymous', [
          manifestationId,
        ]),
      ).toBe(1);

      // Controle positivo: manifestação não anônima aceita o contato.
      const otherResponse = await insertResponse(db, {
        versionId: fx.versionA1,
        sectorId: fx.sectorA,
      });
      const identified = await insertManifestation(db, {
        responseId: otherResponse,
        sectorId: fx.sectorA,
        anonymous: false,
      });
      await db.query(
        `INSERT INTO manifestation_contacts (manifestation_id, full_name, phone, consent_given_at, purpose_text_version)
         VALUES ($1, 'Contato Fictício 998', '51900009998', now(), 'v1')`,
        [identified],
      );
      expect(await contactsOf(identified)).toBe(1);

      recordEvidence({
        scenario: '3 — Contato em manifestação anônima',
        operation: 'INSERT em manifestation_contacts para manifestação com is_anonymous = true',
        mechanism: 'Gatilho manifestation_contacts_not_anonymous (BEFORE INSERT OR UPDATE)',
        sqlstate: error.code,
        constraint: error.constraint,
        message: error.message,
        before: { contatos_da_manifestacao: before },
        after: { contatos_da_manifestacao: after },
      });
    });
  });

  it('cenário 4: rejeita turno sobreposto da mesma equipe (restrição de exclusão)', async () => {
    await inRollback(db, async () => {
      fx = await createFixture(db);
      const insertShift = (teamId: string, startsAt: string, endsAt: string, cancelled = false) =>
        db.query(
          `INSERT INTO shifts (sector_id, team_id, period, starts_at, ends_at, source, created_by,
             cancelled_at, cancelled_by, cancel_reason)
           VALUES ($1, $2, 'morning', $3, $4, 'manual', $5, $6, $7, $8)`,
          [
            fx.sectorA,
            teamId,
            startsAt,
            endsAt,
            fx.adminId,
            cancelled ? '2026-08-31T12:00:00Z' : null,
            cancelled ? fx.adminId : null,
            cancelled ? 'Cancelado para o teste' : null,
          ],
        );
      const activeShiftsOf = (teamId: string) =>
        count(db, 'SELECT count(*) FROM shifts WHERE team_id = $1 AND cancelled_at IS NULL', [
          teamId,
        ]);
      const before = await activeShiftsOf(fx.teamA1);

      // Equipe A1 já tem 10:00–16:00 UTC; o novo turno 13:00–19:00 UTC se sobrepõe.
      const error = await expectDbError(
        db,
        `INSERT INTO shifts (sector_id, team_id, period, starts_at, ends_at, source, created_by)
         VALUES ($1, $2, 'morning', '2026-09-01T13:00:00Z', '2026-09-01T19:00:00Z', 'manual', $3)`,
        [fx.sectorA, fx.teamA1, fx.adminId],
        { code: '23P01', constraint: 'shifts_no_overlap_per_team' },
      );
      const after = await activeShiftsOf(fx.teamA1);
      expect(after).toBe(before);

      // Regras do PDF: outra equipe pode ter turno simultâneo (atribuição ambígua, RN07);
      // turno cancelado não conta; turnos que apenas se tocam ([início, fim)) não se sobrepõem.
      await insertShift(fx.teamA2, '2026-09-01T13:00:00Z', '2026-09-01T19:00:00Z');
      await insertShift(fx.teamA1, '2026-09-01T12:00:00Z', '2026-09-01T18:00:00Z', true);
      await insertShift(fx.teamA1, '2026-09-01T16:00:00Z', '2026-09-01T22:00:00Z');
      expect(await activeShiftsOf(fx.teamA1)).toBe(before + 1);
      expect(await activeShiftsOf(fx.teamA2)).toBe(1);

      recordEvidence({
        scenario: '4 — Sobreposição de turnos',
        operation: 'INSERT em shifts sobrepondo turno não cancelado da mesma equipe',
        mechanism:
          'EXCLUDE USING gist shifts_no_overlap_per_team (team_id =, tstzrange &&) WHERE cancelled_at IS NULL',
        sqlstate: error.code,
        constraint: error.constraint,
        message: error.message,
        before: { turnos_ativos_equipe_A1: before },
        after: { turnos_ativos_equipe_A1: after },
      });
    });
  });

  it('cenário 5: rejeita exclusão física de setor referenciado (ON DELETE RESTRICT)', async () => {
    await inRollback(db, async () => {
      fx = await createFixture(db);
      const snapshot = async () => ({
        setor: await count(db, 'SELECT count(*) FROM sectors WHERE id = $1', [fx.sectorA]),
        equipes: await count(db, 'SELECT count(*) FROM teams WHERE sector_id = $1', [fx.sectorA]),
        turnos: await count(db, 'SELECT count(*) FROM shifts WHERE sector_id = $1', [fx.sectorA]),
        respostas: await count(db, 'SELECT count(*) FROM responses WHERE sector_id = $1', [
          fx.sectorA,
        ]),
        pesquisas: await count(db, 'SELECT count(*) FROM survey_configs WHERE sector_id = $1', [
          fx.sectorA,
        ]),
      });
      const before = await snapshot();

      const error = await expectDbError(db, 'DELETE FROM sectors WHERE id = $1', [fx.sectorA], {
        code: '23503',
        constraint: /_sector_id_fkey$/,
      });

      const after = await snapshot();
      expect(after).toEqual(before);
      expect(after.setor).toBe(1);

      recordEvidence({
        scenario: '5 — Exclusão física de setor referenciado',
        operation: 'DELETE FROM sectors de um setor com equipes, turnos, pesquisas e respostas',
        mechanism: 'FKs ON DELETE RESTRICT que referenciam sectors(id)',
        sqlstate: error.code,
        constraint: error.constraint,
        message: error.message,
        before,
        after,
      });
    });
  });

  it('cenário 6: rejeita UPDATE de campo imutável de versão publicada (gatilho)', async () => {
    await inRollback(db, async () => {
      fx = await createFixture(db);
      const read = async () => {
        const { rows } = await db.query<{ title: string; thank_you_message: string }>(
          'SELECT title, thank_you_message FROM survey_versions WHERE id = $1',
          [fx.versionA1],
        );
        return rows[0];
      };
      const before = await read();

      const error = await expectDbError(
        db,
        "UPDATE survey_versions SET title = 'Título alterado' WHERE id = $1",
        [fx.versionA1],
        { code: '23000', constraint: 'survey_versions_immutable' },
      );
      for (const sql of [
        "UPDATE survey_versions SET thank_you_message = 'Outro agradecimento' WHERE id = $1",
        'UPDATE survey_versions SET version_number = 9 WHERE id = $1',
        'UPDATE survey_versions SET published_at = now() WHERE id = $1',
      ]) {
        await expectDbError(db, sql, [fx.versionA1], {
          code: '23000',
          constraint: 'survey_versions_immutable',
        });
      }
      await expectDbError(db, 'DELETE FROM survey_versions WHERE id = $1', [fx.versionA1], {
        code: '23000',
        constraint: 'survey_versions_no_delete',
      });

      const after = await read();
      expect(after).toEqual(before);

      // Exceção prevista: superseded_at é preenchido uma única vez.
      await db.query(
        "UPDATE survey_versions SET superseded_at = '2026-08-15T00:00:00Z' WHERE id = $1",
        [fx.versionA1],
      );
      await expectDbError(
        db,
        "UPDATE survey_versions SET superseded_at = '2026-08-20T00:00:00Z' WHERE id = $1",
        [fx.versionA1],
        { code: '23000', constraint: 'survey_versions_immutable' },
      );

      recordEvidence({
        scenario: '6 — Atualização de versão publicada',
        operation: 'UPDATE survey_versions SET title (e outros campos) / DELETE da versão',
        mechanism: 'Gatilhos survey_versions_immutable (BEFORE UPDATE) e survey_versions_no_delete',
        sqlstate: error.code,
        constraint: error.constraint,
        message: error.message,
        before: { title: before?.title ?? '' },
        after: { title: after?.title ?? '' },
      });
    });
  });
});
