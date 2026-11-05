/**
 * T32 — Integridade referencial (Tabela 23; RNF18): com MySQL real, o banco rejeita
 * resposta com pergunta de outra versão, setor divergente, contato em manifestação anônima,
 * turno sobreposto, exclusão de setor referenciado e UPDATE de versão publicada.
 *
 * Cada cenário: (1) prepara registros válidos; (2) consulta o estado inicial; (3) executa a
 * operação inválida diretamente no MySQL (SQL puro, sem validação da aplicação); (4) confere
 * o código do erro do MySQL e o nome da restrição ou do gatilho; (5) consulta de novo e comprova que nada
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
} from '../support/db.js';

let db: Db;

beforeAll(async () => {
  db = await connect();
});

afterAll(async () => {
  writeEvidence('t32-resultado.json');
  await db.end();
});

describe('T32 — integridade referencial garantida pelo MySQL', () => {
  let fx: Fixture;

  beforeEach(async () => {
    // Garante que nenhum teste anterior deixou transação aberta.
    await db.query('ROLLBACK').catch(() => undefined);
  });

  it('cenário 1: rejeita nota de resposta com pergunta de outra versão (FK composta)', async () => {
    await inRollback(db, async () => {
      fx = await createFixture(db);
      const answersOf = () =>
        count(db, 'SELECT count(*) FROM response_answers WHERE response_id = ?', [fx.responseA1]);
      const before = await answersOf();

      // A resposta é da v1; a pergunta específica é a da v2 (mesma pesquisa, outra versão).
      const viaQuestion = await expectDbError(
        db,
        `INSERT INTO response_answers (response_id, survey_version_id, survey_version_question_id, question_type, score)
         VALUES (?, ?, ?, 'scale_1_5', 4)`,
        [fx.responseA1, fx.versionA1, fx.svqA2Specific],
        { code: 'ER_NO_REFERENCED_ROW_2', constraint: 'response_answers_svq_version_type_fkey' },
      );
      // Mesmo informando a versão da pergunta, a resposta não pertence a ela.
      const viaResponse = await expectDbError(
        db,
        `INSERT INTO response_answers (response_id, survey_version_id, survey_version_question_id, question_type, score)
         VALUES (?, ?, ?, 'scale_1_5', 4)`,
        [fx.responseA1, fx.versionA2, fx.svqA2Specific],
        {
          code: 'ER_NO_REFERENCED_ROW_2',
          constraint: 'response_answers_response_id_survey_version_id_fkey',
        },
      );

      const after = await answersOf();
      expect(after).toBe(before);

      // Controle positivo: a pergunta da própria versão é aceita.
      await db.query(
        `INSERT INTO response_answers (response_id, survey_version_id, survey_version_question_id, question_type, score)
         VALUES (?, ?, ?, 'scale_1_5', 4)`,
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
        count(db, 'SELECT count(*) FROM responses WHERE survey_version_id = ?', [fx.versionA1]);
      const before = await responsesOfVersion();

      const error = await expectDbError(
        db,
        `INSERT INTO responses (survey_version_id, sector_id, origin, nps_score, low_score, submitted_at,
           attribution_status, idempotency_key, request_hash, manifestation_token_expires_at)
         VALUES (?, ?, 'link', 9, false, '2026-09-01 12:00:00', 'not_qr_origin', UUID(),
           repeat('a', 64), '2026-09-01 13:00:00')`,
        [fx.versionA1, fx.sectorB],
        {
          code: 'ER_NO_REFERENCED_ROW_2',
          constraint: 'responses_survey_version_id_sector_id_fkey',
        },
      );

      const after = await responsesOfVersion();
      expect(after).toBe(before);
      expect(
        await count(db, 'SELECT count(*) FROM responses WHERE sector_id = ?', [fx.sectorB]),
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
        count(db, 'SELECT count(*) FROM manifestation_contacts WHERE manifestation_id = ?', [id]);
      const before = await contactsOf(manifestationId);

      const error = await expectDbError(
        db,
        `INSERT INTO manifestation_contacts (manifestation_id, full_name, email, consent_given_at, purpose_text_version)
         VALUES (?, 'Contato Fictício 999', 'contato.ficticio.999@example.com', UTC_TIMESTAMP(3), 'v1')`,
        [manifestationId],
        { code: 'ER_SIGNAL_EXCEPTION', constraint: 'manifestation_contacts_not_anonymous' },
      );

      const after = await contactsOf(manifestationId);
      expect(after).toBe(0);
      expect(
        await count(db, 'SELECT count(*) FROM manifestations WHERE id = ? AND is_anonymous', [
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
         VALUES (?, 'Contato Fictício 998', '51900009998', UTC_TIMESTAMP(3), 'v1')`,
        [identified],
      );
      expect(await contactsOf(identified)).toBe(1);

      recordEvidence({
        scenario: '3 — Contato em manifestação anônima',
        operation: 'INSERT em manifestation_contacts para manifestação com is_anonymous = true',
        mechanism:
          'Gatilhos manifestation_contacts_before_insert/before_update (manifestation_contacts_not_anonymous)',
        sqlstate: error.code,
        constraint: error.constraint,
        message: error.message,
        before: { contatos_da_manifestacao: before },
        after: { contatos_da_manifestacao: after },
      });
    });
  });

  it('cenário 4: rejeita turno sobreposto da mesma equipe (gatilho)', async () => {
    await inRollback(db, async () => {
      fx = await createFixture(db);
      const insertShift = (teamId: string, startsAt: string, endsAt: string, cancelled = false) =>
        db.query(
          `INSERT INTO shifts (sector_id, team_id, period, starts_at, ends_at, source, created_by,
             cancelled_at, cancelled_by, cancel_reason)
           VALUES (?, ?, 'morning', ?, ?, 'manual', ?, ?, ?, ?)`,
          [
            fx.sectorA,
            teamId,
            startsAt,
            endsAt,
            fx.adminId,
            cancelled ? '2026-08-31 12:00:00' : null,
            cancelled ? fx.adminId : null,
            cancelled ? 'Cancelado para o teste' : null,
          ],
        );
      const activeShiftsOf = (teamId: string) =>
        count(db, 'SELECT count(*) FROM shifts WHERE team_id = ? AND cancelled_at IS NULL', [
          teamId,
        ]);
      const before = await activeShiftsOf(fx.teamA1);

      // Equipe A1 já tem 10:00–16:00 UTC; o novo turno 13:00–19:00 UTC se sobrepõe.
      const error = await expectDbError(
        db,
        `INSERT INTO shifts (sector_id, team_id, period, starts_at, ends_at, source, created_by)
         VALUES (?, ?, 'morning', '2026-09-01 13:00:00', '2026-09-01 19:00:00', 'manual', ?)`,
        [fx.sectorA, fx.teamA1, fx.adminId],
        { code: 'ER_SIGNAL_EXCEPTION', constraint: 'shifts_no_overlap_per_team' },
      );
      const after = await activeShiftsOf(fx.teamA1);
      expect(after).toBe(before);

      // Regras do PDF: outra equipe pode ter turno simultâneo (atribuição ambígua, RN07);
      // turno cancelado não conta; turnos que apenas se tocam ([início, fim)) não se sobrepõem.
      await insertShift(fx.teamA2, '2026-09-01 13:00:00', '2026-09-01 19:00:00');
      await insertShift(fx.teamA1, '2026-09-01 12:00:00', '2026-09-01 18:00:00', true);
      await insertShift(fx.teamA1, '2026-09-01 16:00:00', '2026-09-01 22:00:00');
      expect(await activeShiftsOf(fx.teamA1)).toBe(before + 1);
      expect(await activeShiftsOf(fx.teamA2)).toBe(1);

      recordEvidence({
        scenario: '4 — Sobreposição de turnos',
        operation: 'INSERT em shifts sobrepondo turno não cancelado da mesma equipe',
        mechanism:
          'Gatilhos shifts_before_insert/shifts_before_update (shifts_no_overlap_per_team), que substituem o EXCLUDE do PostgreSQL',
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
        setor: await count(db, 'SELECT count(*) FROM sectors WHERE id = ?', [fx.sectorA]),
        equipes: await count(db, 'SELECT count(*) FROM teams WHERE sector_id = ?', [fx.sectorA]),
        turnos: await count(db, 'SELECT count(*) FROM shifts WHERE sector_id = ?', [fx.sectorA]),
        respostas: await count(db, 'SELECT count(*) FROM responses WHERE sector_id = ?', [
          fx.sectorA,
        ]),
        pesquisas: await count(db, 'SELECT count(*) FROM survey_configs WHERE sector_id = ?', [
          fx.sectorA,
        ]),
      });
      const before = await snapshot();

      const error = await expectDbError(db, 'DELETE FROM sectors WHERE id = ?', [fx.sectorA], {
        code: 'ER_ROW_IS_REFERENCED_2',
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
          'SELECT title, thank_you_message FROM survey_versions WHERE id = ?',
          [fx.versionA1],
        );
        return rows[0];
      };
      const before = await read();

      const error = await expectDbError(
        db,
        "UPDATE survey_versions SET title = 'Título alterado' WHERE id = ?",
        [fx.versionA1],
        { code: 'ER_SIGNAL_EXCEPTION', constraint: 'survey_versions_immutable' },
      );
      for (const sql of [
        "UPDATE survey_versions SET thank_you_message = 'Outro agradecimento' WHERE id = ?",
        'UPDATE survey_versions SET version_number = 9 WHERE id = ?',
        'UPDATE survey_versions SET published_at = UTC_TIMESTAMP(3) WHERE id = ?',
      ]) {
        await expectDbError(db, sql, [fx.versionA1], {
          code: 'ER_SIGNAL_EXCEPTION',
          constraint: 'survey_versions_immutable',
        });
      }
      await expectDbError(db, 'DELETE FROM survey_versions WHERE id = ?', [fx.versionA1], {
        code: 'ER_SIGNAL_EXCEPTION',
        constraint: 'survey_versions_no_delete',
      });

      const after = await read();
      expect(after).toEqual(before);

      // Exceção prevista: superseded_at é preenchido uma única vez.
      await db.query(
        "UPDATE survey_versions SET superseded_at = '2026-08-15 00:00:00' WHERE id = ?",
        [fx.versionA1],
      );
      await expectDbError(
        db,
        "UPDATE survey_versions SET superseded_at = '2026-08-20 00:00:00' WHERE id = ?",
        [fx.versionA1],
        { code: 'ER_SIGNAL_EXCEPTION', constraint: 'survey_versions_immutable' },
      );

      recordEvidence({
        scenario: '6 — Atualização de versão publicada',
        operation: 'UPDATE survey_versions SET title (e outros campos) / DELETE da versão',
        mechanism:
          'Gatilhos survey_versions_before_update (survey_versions_immutable) e survey_versions_before_delete (survey_versions_no_delete)',
        sqlstate: error.code,
        constraint: error.constraint,
        message: error.message,
        before: { title: before?.title ?? '' },
        after: { title: after?.title ?? '' },
      });
    });
  });
});
