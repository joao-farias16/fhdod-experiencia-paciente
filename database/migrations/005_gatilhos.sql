-- =============================================================================================
-- Migration 005 — gatilhos de imutabilidade, coerência, anonimato e protocolo
-- =============================================================================================
-- Regras que dependem de outras linhas (o CHECK do MySQL só enxerga a própria linha).
-- Toda violação usa SIGNAL SQLSTATE '45000' (erro 1644) com a mensagem iniciada pelo nome da
-- regra entre colchetes, por exemplo "[audit_logs_insert_only] ...": a API e os testes
-- identificam o mecanismo que rejeitou a operação por esse nome.
--
-- Diferenças em relação ao PostgreSQL (documentadas em docs/modelo-de-dados.md):
-- * EXCLUDE USING gist (turnos sobrepostos) → gatilhos shifts_before_insert/update, que bloqueiam
--   a linha da equipe (FOR UPDATE) e procuram sobreposição com leitura com bloqueio;
-- * SEQUENCE + função do protocolo → tabela manifestation_protocol_sequence + gatilho;
-- * o MySQL não dispara gatilhos em exclusões em cascata, então manifestation_notes rejeita toda
--   exclusão direta e continua sendo removida apenas junto com a manifestação (ON DELETE CASCADE);
-- * não há gatilho de TRUNCATE no MySQL: o usuário da aplicação não recebe o privilégio DROP
--   (necessário para TRUNCATE), conforme database/seguranca/usuarios.sql.
--
-- No MySQL Workbench o arquivo roda inteiro (Ctrl+Shift+Enter); os blocos usam DELIMITER $$.

DELIMITER $$

-- ===========================================================================================
-- shifts: sem sobreposição por equipe entre turnos não cancelados (antes EXCLUDE USING gist)
-- ===========================================================================================
CREATE TRIGGER shifts_before_insert
BEFORE INSERT ON shifts
FOR EACH ROW
BEGIN
  DECLARE v_team CHAR(36);
  DECLARE v_overlap CHAR(36);
  IF NEW.cancelled_at IS NULL THEN
    -- Serializa os cadastros da mesma equipe (concorrência entre duas requisições).
    SELECT id INTO v_team FROM teams WHERE id = NEW.team_id FOR UPDATE;
    SELECT s.id INTO v_overlap
    FROM shifts s
    WHERE s.team_id = NEW.team_id
      AND s.cancelled_at IS NULL
      AND s.starts_at < NEW.ends_at
      AND s.ends_at > NEW.starts_at
    LIMIT 1
    FOR SHARE;
    IF v_overlap IS NOT NULL THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = '[shifts_no_overlap_per_team] A equipe já tem turno sobreposto a este horário.';
    END IF;
  END IF;
END$$

CREATE TRIGGER shifts_before_update
BEFORE UPDATE ON shifts
FOR EACH ROW
BEGIN
  DECLARE v_team CHAR(36);
  DECLARE v_overlap CHAR(36);
  IF NEW.cancelled_at IS NULL AND (
       NOT (NEW.team_id <=> OLD.team_id)
       OR NOT (NEW.starts_at <=> OLD.starts_at)
       OR NOT (NEW.ends_at <=> OLD.ends_at)
       OR OLD.cancelled_at IS NOT NULL
     ) THEN
    SELECT id INTO v_team FROM teams WHERE id = NEW.team_id FOR UPDATE;
    SELECT s.id INTO v_overlap
    FROM shifts s
    WHERE s.team_id = NEW.team_id
      AND s.id <> NEW.id
      AND s.cancelled_at IS NULL
      AND s.starts_at < NEW.ends_at
      AND s.ends_at > NEW.starts_at
    LIMIT 1
    FOR SHARE;
    IF v_overlap IS NOT NULL THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = '[shifts_no_overlap_per_team] A equipe já tem turno sobreposto a este horário.';
    END IF;
  END IF;
END$$

-- ===========================================================================================
-- survey_configs: versão vigente da própria pesquisa; setor e slug imutáveis após publicar (RN27)
-- ===========================================================================================
CREATE TRIGGER survey_configs_before_insert
BEFORE INSERT ON survey_configs
FOR EACH ROW
BEGIN
  IF NEW.current_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM survey_versions v WHERE v.id = NEW.current_version_id AND v.survey_config_id = NEW.id
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = '[survey_configs_current_version_same_survey] A versão vigente não pertence à pesquisa.';
  END IF;
END$$

CREATE TRIGGER survey_configs_before_update
BEFORE UPDATE ON survey_configs
FOR EACH ROW
BEGIN
  IF NEW.current_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM survey_versions v WHERE v.id = NEW.current_version_id AND v.survey_config_id = NEW.id
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = '[survey_configs_current_version_same_survey] A versão vigente não pertence à pesquisa.';
  END IF;
  IF (NOT (NEW.slug <=> OLD.slug) OR NOT (NEW.sector_id <=> OLD.sector_id))
     AND EXISTS (SELECT 1 FROM survey_versions v WHERE v.survey_config_id = OLD.id) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = '[survey_configs_locked_after_publication] Setor e slug são imutáveis após a primeira publicação.';
  END IF;
END$$

-- ===========================================================================================
-- questions: texto, tipo e etapa bloqueados após a publicação (RN17); pesquisa nunca muda
-- ===========================================================================================
CREATE TRIGGER questions_before_update
BEFORE UPDATE ON questions
FOR EACH ROW
BEGIN
  IF NOT (NEW.survey_config_id <=> OLD.survey_config_id) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = '[questions_survey_immutable] A pergunta não pode mudar de pesquisa.';
  END IF;
  IF OLD.first_published_at IS NOT NULL AND (
       NOT (NEW.text <=> OLD.text)
       OR NOT (NEW.type <=> OLD.type)
       OR NOT (NEW.journey_stage_id <=> OLD.journey_stage_id)
       OR NOT (NEW.first_published_at <=> OLD.first_published_at)
     ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = '[questions_locked_after_publication] Pergunta publicada: texto, tipo e etapa são imutáveis.';
  END IF;
END$$

-- ===========================================================================================
-- survey_versions: imutável; só superseded_at pode ser preenchido uma única vez (RN06)
-- ===========================================================================================
CREATE TRIGGER survey_versions_before_update
BEFORE UPDATE ON survey_versions
FOR EACH ROW
BEGIN
  IF NOT (NEW.id <=> OLD.id)
     OR NOT (NEW.survey_config_id <=> OLD.survey_config_id)
     OR NOT (NEW.sector_id <=> OLD.sector_id)
     OR NOT (NEW.version_number <=> OLD.version_number)
     OR NOT (NEW.title <=> OLD.title)
     OR NOT (NEW.intro_text <=> OLD.intro_text)
     OR NOT (NEW.thank_you_message <=> OLD.thank_you_message)
     OR NOT (NEW.published_at <=> OLD.published_at)
     OR NOT (NEW.published_by <=> OLD.published_by)
     OR (OLD.superseded_at IS NOT NULL AND NOT (NEW.superseded_at <=> OLD.superseded_at)) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = '[survey_versions_immutable] A versão é imutável; somente superseded_at é preenchido uma vez.';
  END IF;
END$$

CREATE TRIGGER survey_versions_before_delete
BEFORE DELETE ON survey_versions
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = '[survey_versions_no_delete] Versões publicadas preservam o histórico e não são excluídas.';
END$$

-- ===========================================================================================
-- survey_version_questions: instantâneo imutável; a pergunta é da mesma pesquisa e do mesmo tipo
-- ===========================================================================================
CREATE TRIGGER svq_before_insert
BEFORE INSERT ON survey_version_questions
FOR EACH ROW
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM survey_versions v
    JOIN questions q ON q.survey_config_id = v.survey_config_id
    WHERE v.id = NEW.survey_version_id
      AND q.id = NEW.question_id
      AND q.type = NEW.type
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = '[svq_question_same_survey] A pergunta não pertence à pesquisa da versão ou tem outro tipo.';
  END IF;
END$$

CREATE TRIGGER svq_before_update
BEFORE UPDATE ON survey_version_questions
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = '[svq_immutable] UPDATE em survey_version_questions não é permitido: registro imutável.';
END$$

CREATE TRIGGER svq_before_delete
BEFORE DELETE ON survey_version_questions
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = '[svq_immutable] DELETE em survey_version_questions não é permitido: registro imutável.';
END$$

-- ===========================================================================================
-- responses: coerência do turno na inserção (RN07) e imutabilidade (RN06, RN15)
-- ===========================================================================================
CREATE TRIGGER responses_before_insert
BEFORE INSERT ON responses
FOR EACH ROW
BEGIN
  DECLARE v_published_at DATETIME(3);
  DECLARE v_shift_id CHAR(36);
  DECLARE v_shift_sector CHAR(36);
  DECLARE v_shift_team CHAR(36);
  DECLARE v_shift_period VARCHAR(20);
  DECLARE v_shift_cancelled DATETIME(3);
  DECLARE v_shift_starts DATETIME(3);
  DECLARE v_shift_ends DATETIME(3);
  DECLARE v_team_active BOOLEAN;

  SELECT v.published_at INTO v_published_at
  FROM survey_versions v WHERE v.id = NEW.survey_version_id;

  IF v_published_at IS NOT NULL AND NEW.submitted_at < v_published_at THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = '[responses_after_version_publication] A resposta não pode ser anterior à publicação da versão.';
  END IF;

  IF NEW.shift_id IS NOT NULL THEN
    SELECT s.id, s.sector_id, s.team_id, s.period, s.cancelled_at, s.starts_at, s.ends_at
      INTO v_shift_id, v_shift_sector, v_shift_team, v_shift_period, v_shift_cancelled, v_shift_starts, v_shift_ends
    FROM shifts s WHERE s.id = NEW.shift_id;
    SELECT t.is_active INTO v_team_active FROM teams t WHERE t.id = NEW.team_id;

    IF v_shift_id IS NULL
       OR NOT (v_shift_sector <=> NEW.sector_id)
       OR NOT (v_shift_team <=> NEW.team_id)
       OR NOT (v_shift_period <=> NEW.shift_period)
       OR v_shift_cancelled IS NOT NULL
       OR NEW.submitted_at < v_shift_starts
       OR NEW.submitted_at >= v_shift_ends
       OR NOT COALESCE(v_team_active, FALSE) THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = '[responses_shift_coherence] Atribuição incoerente com o turno (setor, equipe, período, cancelamento ou horário).';
    END IF;
  END IF;
END$$

-- Única alteração permitida: registrar o uso do token de manifestação (de nulo para preenchido).
CREATE TRIGGER responses_before_update
BEFORE UPDATE ON responses
FOR EACH ROW
BEGIN
  IF NOT (NEW.id <=> OLD.id)
     OR NOT (NEW.survey_version_id <=> OLD.survey_version_id)
     OR NOT (NEW.sector_id <=> OLD.sector_id)
     OR NOT (NEW.origin <=> OLD.origin)
     OR NOT (NEW.nps_score <=> OLD.nps_score)
     OR NOT (NEW.low_score <=> OLD.low_score)
     OR NOT (NEW.submitted_at <=> OLD.submitted_at)
     OR NOT (NEW.attribution_status <=> OLD.attribution_status)
     OR NOT (NEW.shift_id <=> OLD.shift_id)
     OR NOT (NEW.team_id <=> OLD.team_id)
     OR NOT (NEW.shift_period <=> OLD.shift_period)
     OR NOT (NEW.idempotency_key <=> OLD.idempotency_key)
     OR NOT (NEW.request_hash <=> OLD.request_hash)
     OR NOT (NEW.manifestation_token_expires_at <=> OLD.manifestation_token_expires_at)
     OR (OLD.manifestation_token_used_at IS NOT NULL
         AND NOT (NEW.manifestation_token_used_at <=> OLD.manifestation_token_used_at)) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = '[responses_immutable] A resposta é imutável; somente o uso do token é registrado uma vez.';
  END IF;
END$$

-- As notas específicas fazem parte da resposta: também não são alteradas.
CREATE TRIGGER response_answers_before_update
BEFORE UPDATE ON response_answers
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = '[response_answers_immutable] UPDATE em response_answers não é permitido: registro imutável.';
END$$

-- ===========================================================================================
-- manifestations: protocolo FHD-AAAA-NNNNNN e dados do registro público imutáveis (RF46)
-- ===========================================================================================
-- Ano do instante de recebimento no fuso do hospital (America/Sao_Paulo = UTC−3, sem horário de
-- verão desde 2019; deslocamento fixo para não depender das tabelas de fuso do servidor).
CREATE TRIGGER manifestations_before_insert
BEFORE INSERT ON manifestations
FOR EACH ROW
BEGIN
  DECLARE v_next INT;
  IF NEW.protocol IS NULL OR NEW.protocol = '' THEN
    UPDATE manifestation_protocol_sequence SET current_value = current_value + 1 WHERE id = 1;
    SELECT current_value INTO v_next FROM manifestation_protocol_sequence WHERE id = 1;
    SET NEW.protocol = CONCAT(
      'FHD-',
      DATE_FORMAT(CONVERT_TZ(NEW.received_at, '+00:00', '-03:00'), '%Y'),
      '-',
      LPAD(v_next, 6, '0')
    );
  END IF;
END$$

CREATE TRIGGER manifestations_before_update
BEFORE UPDATE ON manifestations
FOR EACH ROW
BEGIN
  IF NOT (NEW.id <=> OLD.id)
     OR NOT (NEW.protocol <=> OLD.protocol)
     OR NOT (NEW.response_id <=> OLD.response_id)
     OR NOT (NEW.sector_id <=> OLD.sector_id)
     OR NOT (NEW.type <=> OLD.type)
     OR NOT (NEW.description <=> OLD.description)
     OR NOT (NEW.is_anonymous <=> OLD.is_anonymous)
     OR NOT (NEW.triggered_by_low_score <=> OLD.triggered_by_low_score)
     OR NOT (NEW.received_at <=> OLD.received_at)
     OR NOT (NEW.idempotency_key <=> OLD.idempotency_key)
     OR NOT (NEW.request_hash <=> OLD.request_hash)
     OR NOT (NEW.created_at <=> OLD.created_at) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = '[manifestations_registration_immutable] Os dados registrados da manifestação são imutáveis.';
  END IF;
END$$

-- ===========================================================================================
-- manifestation_contacts: proibido em manifestação anônima (RN12, RF42)
-- ===========================================================================================
CREATE TRIGGER manifestation_contacts_before_insert
BEFORE INSERT ON manifestation_contacts
FOR EACH ROW
BEGIN
  IF EXISTS (SELECT 1 FROM manifestations m WHERE m.id = NEW.manifestation_id AND m.is_anonymous) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = '[manifestation_contacts_not_anonymous] Manifestação anônima não pode ter contato.';
  END IF;
END$$

CREATE TRIGGER manifestation_contacts_before_update
BEFORE UPDATE ON manifestation_contacts
FOR EACH ROW
BEGIN
  IF EXISTS (SELECT 1 FROM manifestations m WHERE m.id = NEW.manifestation_id AND m.is_anonymous) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = '[manifestation_contacts_not_anonymous] Manifestação anônima não pode ter contato.';
  END IF;
END$$

-- ===========================================================================================
-- manifestation_notes: sem UPDATE; exclusão somente em cascata a partir da manifestação
-- ===========================================================================================
CREATE TRIGGER manifestation_notes_before_update
BEFORE UPDATE ON manifestation_notes
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = '[manifestation_notes_no_update] UPDATE em manifestation_notes não é permitido: registro imutável.';
END$$

-- A exclusão em cascata (ON DELETE CASCADE) não dispara gatilhos no MySQL: só a direta chega aqui.
CREATE TRIGGER manifestation_notes_before_delete
BEFORE DELETE ON manifestation_notes
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = '[manifestation_notes_no_direct_delete] Notas só são removidas junto com a manifestação.';
END$$

-- ===========================================================================================
-- audit_logs: somente inserção (RF10, RN16)
-- ===========================================================================================
CREATE TRIGGER audit_logs_before_update
BEFORE UPDATE ON audit_logs
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = '[audit_logs_insert_only] UPDATE em audit_logs não é permitido: registro imutável.';
END$$

CREATE TRIGGER audit_logs_before_delete
BEFORE DELETE ON audit_logs
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = '[audit_logs_insert_only] DELETE em audit_logs não é permitido: registro imutável.';
END$$

DELIMITER ;
