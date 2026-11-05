-- ET02 — Migration customizada 4/5: gatilhos de imutabilidade, coerência e anonimato.
-- SQL manual (o Prisma não representa gatilhos). Não edite depois de aplicada.
--
-- Todas as violações usam SQLSTATE 23000 (integrity_constraint_violation) e informam no campo
-- CONSTRAINT o nome da regra, para que a API e os testes identifiquem o mecanismo que rejeitou.
-- As funções usam search_path vazio e nomes qualificados (proteção contra sequestro de search_path).

-- ===========================================================================================
-- Funções genéricas
-- ===========================================================================================

-- Rejeita a operação: usada em tabelas ou operações somente de inserção.
CREATE FUNCTION public.reject_immutable_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION '% em % não é permitido: registro imutável', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation',
          CONSTRAINT = TG_NAME,
          HINT = 'Registros publicados, respostas, notas e auditoria preservam o histórico.';
END;
$$;

-- ===========================================================================================
-- survey_configs: versão vigente da própria pesquisa; setor e slug imutáveis após publicar (RN27)
-- ===========================================================================================
CREATE FUNCTION public.survey_configs_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.current_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.survey_versions v
    WHERE v.id = NEW.current_version_id
      AND v.survey_config_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'A versão vigente % não pertence à pesquisa %', NEW.current_version_id, NEW.id
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'survey_configs_current_version_same_survey';
  END IF;

  IF TG_OP = 'UPDATE'
     AND (NEW.slug IS DISTINCT FROM OLD.slug OR NEW.sector_id IS DISTINCT FROM OLD.sector_id)
     AND EXISTS (SELECT 1 FROM public.survey_versions v WHERE v.survey_config_id = OLD.id) THEN
    RAISE EXCEPTION 'Setor e slug da pesquisa % são imutáveis após a primeira publicação', OLD.id
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'survey_configs_locked_after_publication';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER survey_configs_guard
  BEFORE INSERT OR UPDATE ON public.survey_configs
  FOR EACH ROW EXECUTE FUNCTION public.survey_configs_guard();

-- ===========================================================================================
-- questions: texto, tipo e etapa bloqueados após a publicação (RN17); pesquisa nunca muda
-- ===========================================================================================
CREATE FUNCTION public.questions_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.survey_config_id IS DISTINCT FROM OLD.survey_config_id THEN
    RAISE EXCEPTION 'A pergunta % não pode mudar de pesquisa', OLD.id
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'questions_survey_immutable';
  END IF;

  IF OLD.first_published_at IS NOT NULL AND (
       NEW.text IS DISTINCT FROM OLD.text
       OR NEW.type IS DISTINCT FROM OLD.type
       OR NEW.journey_stage_id IS DISTINCT FROM OLD.journey_stage_id
       OR NEW.first_published_at IS DISTINCT FROM OLD.first_published_at
     ) THEN
    RAISE EXCEPTION 'A pergunta % já foi publicada: texto, tipo e etapa são imutáveis', OLD.id
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'questions_locked_after_publication',
            HINT = 'Desative a pergunta e crie outra (RN17).';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER questions_guard
  BEFORE UPDATE ON public.questions
  FOR EACH ROW EXECUTE FUNCTION public.questions_guard();

-- ===========================================================================================
-- survey_versions: imutável; só superseded_at pode ser preenchido uma única vez (RN06)
-- ===========================================================================================
CREATE FUNCTION public.survey_versions_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (to_jsonb(NEW) - 'superseded_at') IS DISTINCT FROM (to_jsonb(OLD) - 'superseded_at')
     OR (OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at) THEN
    RAISE EXCEPTION 'A versão % é imutável; somente superseded_at pode ser preenchido uma vez', OLD.id
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'survey_versions_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER survey_versions_immutable
  BEFORE UPDATE ON public.survey_versions
  FOR EACH ROW EXECUTE FUNCTION public.survey_versions_guard_update();

CREATE TRIGGER survey_versions_no_delete
  BEFORE DELETE ON public.survey_versions
  FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

-- ===========================================================================================
-- survey_version_questions: instantâneo imutável; a pergunta é da mesma pesquisa e do mesmo tipo
-- ===========================================================================================
CREATE FUNCTION public.survey_version_questions_check_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.survey_versions v
    JOIN public.questions q ON q.survey_config_id = v.survey_config_id
    WHERE v.id = NEW.survey_version_id
      AND q.id = NEW.question_id
      AND q.type = NEW.type
  ) THEN
    RAISE EXCEPTION 'A pergunta % não pertence à pesquisa da versão % ou tem outro tipo',
      NEW.question_id, NEW.survey_version_id
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'svq_question_same_survey';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER svq_question_same_survey
  BEFORE INSERT ON public.survey_version_questions
  FOR EACH ROW EXECUTE FUNCTION public.survey_version_questions_check_insert();

CREATE TRIGGER svq_immutable
  BEFORE UPDATE OR DELETE ON public.survey_version_questions
  FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

-- ===========================================================================================
-- responses: coerência do turno na inserção (RN07) e imutabilidade (RN06, RN15)
-- ===========================================================================================
CREATE FUNCTION public.responses_check_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_published_at timestamptz;
  v_shift public.shifts%ROWTYPE;
  v_team_active boolean;
BEGIN
  SELECT v.published_at INTO v_published_at
  FROM public.survey_versions v
  WHERE v.id = NEW.survey_version_id;

  IF v_published_at IS NOT NULL AND NEW.submitted_at < v_published_at THEN
    RAISE EXCEPTION 'A resposta não pode ser anterior à publicação da versão %', NEW.survey_version_id
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'responses_after_version_publication';
  END IF;

  IF NEW.shift_id IS NOT NULL THEN
    SELECT * INTO v_shift FROM public.shifts s WHERE s.id = NEW.shift_id;
    SELECT t.is_active INTO v_team_active FROM public.teams t WHERE t.id = NEW.team_id;

    IF v_shift.id IS NULL
       OR v_shift.sector_id IS DISTINCT FROM NEW.sector_id
       OR v_shift.team_id IS DISTINCT FROM NEW.team_id
       OR v_shift.period IS DISTINCT FROM NEW.shift_period
       OR v_shift.cancelled_at IS NOT NULL
       OR NEW.submitted_at < v_shift.starts_at
       OR NEW.submitted_at >= v_shift.ends_at
       OR NOT coalesce(v_team_active, false) THEN
      RAISE EXCEPTION 'Atribuição incoerente com o turno % (setor, equipe, período, cancelamento ou horário)',
        NEW.shift_id
        USING ERRCODE = 'integrity_constraint_violation',
              CONSTRAINT = 'responses_shift_coherence';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER responses_shift_coherence
  BEFORE INSERT ON public.responses
  FOR EACH ROW EXECUTE FUNCTION public.responses_check_insert();

-- Única alteração permitida: registrar o uso do token de manifestação (de nulo para preenchido).
CREATE FUNCTION public.responses_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (to_jsonb(NEW) - 'manifestation_token_used_at') IS DISTINCT FROM (to_jsonb(OLD) - 'manifestation_token_used_at')
     OR (OLD.manifestation_token_used_at IS NOT NULL
         AND NEW.manifestation_token_used_at IS DISTINCT FROM OLD.manifestation_token_used_at) THEN
    RAISE EXCEPTION 'A resposta % é imutável; somente o uso do token pode ser registrado uma vez', OLD.id
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'responses_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER responses_immutable
  BEFORE UPDATE ON public.responses
  FOR EACH ROW EXECUTE FUNCTION public.responses_guard_update();

-- As notas específicas fazem parte da resposta: também não são alteradas.
CREATE TRIGGER response_answers_immutable
  BEFORE UPDATE ON public.response_answers
  FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

-- ===========================================================================================
-- manifestations: dados do registro público imutáveis; só tratamento da Ouvidoria muda (RF46)
-- ===========================================================================================
CREATE FUNCTION public.manifestations_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.protocol IS DISTINCT FROM OLD.protocol
     OR NEW.response_id IS DISTINCT FROM OLD.response_id
     OR NEW.sector_id IS DISTINCT FROM OLD.sector_id
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.is_anonymous IS DISTINCT FROM OLD.is_anonymous
     OR NEW.triggered_by_low_score IS DISTINCT FROM OLD.triggered_by_low_score
     OR NEW.received_at IS DISTINCT FROM OLD.received_at
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Os dados registrados da manifestação % são imutáveis', OLD.id
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'manifestations_registration_immutable',
            HINT = 'Somente status, prioridade, providências, resolved_at, updated_by e updated_at mudam.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER manifestations_registration_immutable
  BEFORE UPDATE ON public.manifestations
  FOR EACH ROW EXECUTE FUNCTION public.manifestations_guard_update();

-- ===========================================================================================
-- manifestation_contacts: proibido em manifestação anônima (RN12, RF42)
-- ===========================================================================================
CREATE FUNCTION public.manifestation_contacts_check_not_anonymous()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.manifestations m
    WHERE m.id = NEW.manifestation_id
      AND m.is_anonymous
  ) THEN
    RAISE EXCEPTION 'A manifestação % é anônima e não pode ter contato', NEW.manifestation_id
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'manifestation_contacts_not_anonymous';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER manifestation_contacts_not_anonymous
  BEFORE INSERT OR UPDATE ON public.manifestation_contacts
  FOR EACH ROW EXECUTE FUNCTION public.manifestation_contacts_check_not_anonymous();

-- ===========================================================================================
-- manifestation_notes: sem UPDATE; exclusão somente em cascata a partir da manifestação
-- ===========================================================================================
CREATE TRIGGER manifestation_notes_no_update
  BEFORE UPDATE ON public.manifestation_notes
  FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

-- Na exclusão em cascata (ação referencial), o gatilho roda aninhado: pg_trigger_depth() > 1.
CREATE FUNCTION public.manifestation_notes_guard_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'Notas da manifestação % só são removidas junto com a manifestação', OLD.manifestation_id
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'manifestation_notes_no_direct_delete';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER manifestation_notes_no_direct_delete
  BEFORE DELETE ON public.manifestation_notes
  FOR EACH ROW EXECUTE FUNCTION public.manifestation_notes_guard_delete();

-- ===========================================================================================
-- audit_logs: somente inserção (RF10, RN16)
-- ===========================================================================================
CREATE TRIGGER audit_logs_insert_only
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON public.audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_immutable_change();
