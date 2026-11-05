-- ET02 — Migration customizada 3/5: restrições de integridade que o Prisma não representa.
-- Criada com `prisma migrate dev --create-only` e preenchida manualmente. Não edite depois de aplicada.
--
-- Conteúdo: CHECK de domínio e coerência, índice único de expressão, restrição de exclusão de
-- turnos e a identidade de audit_logs.id (Tabelas 16 e 17 da especificação).

-- -------------------------------------------------------------------------------------------
-- audit_logs.id como bigint de identidade (Tabela 16). O Prisma gera BIGSERIAL; aqui a coluna é
-- convertida para GENERATED ALWAYS AS IDENTITY, mantendo o tipo bigint.
-- -------------------------------------------------------------------------------------------
ALTER TABLE public.audit_logs ALTER COLUMN id DROP DEFAULT;
DROP SEQUENCE public.audit_logs_id_seq;
ALTER TABLE public.audit_logs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;

-- -------------------------------------------------------------------------------------------
-- hospitals
-- -------------------------------------------------------------------------------------------
ALTER TABLE public.hospitals
  ADD CONSTRAINT hospitals_name_not_blank CHECK (btrim(name) <> ''),
  ADD CONSTRAINT hospitals_short_name_not_blank CHECK (btrim(short_name) <> ''),
  ADD CONSTRAINT hospitals_timezone_not_blank CHECK (btrim(timezone) <> '');

-- -------------------------------------------------------------------------------------------
-- profiles: e-mail em minúsculas, escopo por perfil (RN18) e coerência de is_active (RF09)
-- -------------------------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_full_name_not_blank CHECK (btrim(full_name) <> ''),
  ADD CONSTRAINT profiles_email_lowercase CHECK (email = lower(email)),
  ADD CONSTRAINT profiles_email_format CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  -- SA sempre global; AS nunca global; GE, OU e VI globais ou por setores.
  ADD CONSTRAINT profiles_scope_by_role CHECK (
    (role = 'superadmin' AND all_sectors)
    OR (role = 'sector_admin' AND NOT all_sectors)
    OR role IN ('management', 'ombudsman', 'viewer')
  ),
  ADD CONSTRAINT profiles_active_coherence CHECK (
    (is_active AND deactivated_at IS NULL AND deactivated_by IS NULL)
    OR (NOT is_active AND deactivated_at IS NOT NULL)
  );

-- -------------------------------------------------------------------------------------------
-- sectors: código A–Z, 0–9, _ e - com 2 a 20 caracteres (RF12); nome único sem distinguir caixa
-- -------------------------------------------------------------------------------------------
ALTER TABLE public.sectors
  ADD CONSTRAINT sectors_code_format CHECK (code ~ '^[A-Z0-9_-]{2,20}$'),
  ADD CONSTRAINT sectors_name_not_blank CHECK (btrim(name) <> ''),
  ADD CONSTRAINT sectors_active_coherence CHECK (is_active = (deactivated_at IS NULL));

CREATE UNIQUE INDEX sectors_hospital_id_lower_name_key ON public.sectors (hospital_id, lower(name));

-- -------------------------------------------------------------------------------------------
-- teams
-- -------------------------------------------------------------------------------------------
ALTER TABLE public.teams
  ADD CONSTRAINT teams_code_not_blank CHECK (btrim(code) <> ''),
  ADD CONSTRAINT teams_name_not_blank CHECK (btrim(name) <> ''),
  ADD CONSTRAINT teams_active_coherence CHECK (is_active = (deactivated_at IS NULL));

-- -------------------------------------------------------------------------------------------
-- shifts: duração de 1 a 24 h (RN20), origem coerente, cancelamento coerente (RF21) e
-- nenhuma sobreposição por equipe entre turnos não cancelados (EXCLUDE gist).
-- -------------------------------------------------------------------------------------------
ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_duration_1_to_24h CHECK (
    ends_at - starts_at BETWEEN interval '1 hour' AND interval '24 hours'
  ),
  ADD CONSTRAINT shifts_source_import_coherence CHECK ((source = 'import') = (import_id IS NOT NULL)),
  ADD CONSTRAINT shifts_cancellation_coherence CHECK (
    (cancelled_at IS NULL AND cancelled_by IS NULL AND cancel_reason IS NULL)
    OR (
      cancelled_at IS NOT NULL
      AND cancelled_by IS NOT NULL
      AND cancel_reason IS NOT NULL
      AND char_length(btrim(cancel_reason)) BETWEEN 5 AND 300
    )
  ),
  ADD CONSTRAINT shifts_no_overlap_per_team EXCLUDE USING gist (
    team_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (cancelled_at IS NULL);

-- -------------------------------------------------------------------------------------------
-- shift_imports: totais (até 2.000 linhas, RN19), status coerente e confirmação em até 30 min
-- -------------------------------------------------------------------------------------------
ALTER TABLE public.shift_imports
  ADD CONSTRAINT shift_imports_file_name_not_blank CHECK (btrim(file_name) <> ''),
  ADD CONSTRAINT shift_imports_file_sha256_format CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT shift_imports_row_totals CHECK (
    total_rows BETWEEN 1 AND 2000
    AND accepted_rows >= 0
    AND rejected_rows >= 0
    AND accepted_rows + rejected_rows = total_rows
  ),
  ADD CONSTRAINT shift_imports_status_coherence CHECK (
    (status = 'validated' AND rejected_rows = 0 AND committed_at IS NULL AND committed_by IS NULL)
    OR (status = 'rejected' AND rejected_rows > 0 AND committed_at IS NULL AND committed_by IS NULL)
    OR (
      status = 'committed'
      AND rejected_rows = 0
      AND committed_at IS NOT NULL
      AND committed_by IS NOT NULL
      AND committed_at <= expires_at
    )
  ),
  ADD CONSTRAINT shift_imports_expiration_window CHECK (
    expires_at > created_at AND expires_at <= created_at + interval '30 minutes'
  ),
  ADD CONSTRAINT shift_imports_json_arrays CHECK (
    jsonb_typeof(errors) = 'array' AND jsonb_typeof(staged_rows) = 'array'
  ),
  ADD CONSTRAINT shift_imports_rejected_has_errors CHECK (
    status <> 'rejected' OR jsonb_array_length(errors) > 0
  );

-- -------------------------------------------------------------------------------------------
-- survey_configs: slug kebab-case e coerência de is_active
-- -------------------------------------------------------------------------------------------
ALTER TABLE public.survey_configs
  ADD CONSTRAINT survey_configs_slug_kebab_case CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT survey_configs_title_not_blank CHECK (btrim(title) <> ''),
  ADD CONSTRAINT survey_configs_thank_you_not_blank CHECK (btrim(thank_you_message) <> ''),
  ADD CONSTRAINT survey_configs_active_coherence CHECK (is_active = (deactivated_at IS NULL));

-- -------------------------------------------------------------------------------------------
-- journey_stages
-- -------------------------------------------------------------------------------------------
ALTER TABLE public.journey_stages
  ADD CONSTRAINT journey_stages_code_not_blank CHECK (btrim(code) <> ''),
  ADD CONSTRAINT journey_stages_name_not_blank CHECK (btrim(name) <> ''),
  ADD CONSTRAINT journey_stages_position_positive CHECK (position > 0);

-- -------------------------------------------------------------------------------------------
-- questions: tipo × obrigatoriedade × etapa (RN01, RN02); a pergunta geral nunca é desativada (RF28)
-- -------------------------------------------------------------------------------------------
ALTER TABLE public.questions
  ADD CONSTRAINT questions_type_required_stage CHECK (
    (type = 'nps' AND is_required AND journey_stage_id IS NULL)
    OR (type = 'scale_1_5' AND NOT is_required AND journey_stage_id IS NOT NULL)
  ),
  ADD CONSTRAINT questions_nps_always_active CHECK (type <> 'nps' OR is_active),
  ADD CONSTRAINT questions_text_not_blank CHECK (btrim(text) <> ''),
  ADD CONSTRAINT questions_position_positive CHECK (position > 0);

-- -------------------------------------------------------------------------------------------
-- survey_versions
-- -------------------------------------------------------------------------------------------
ALTER TABLE public.survey_versions
  ADD CONSTRAINT survey_versions_number_positive CHECK (version_number > 0),
  ADD CONSTRAINT survey_versions_title_not_blank CHECK (btrim(title) <> ''),
  ADD CONSTRAINT survey_versions_thank_you_not_blank CHECK (btrim(thank_you_message) <> ''),
  ADD CONSTRAINT survey_versions_superseded_after_published CHECK (
    superseded_at IS NULL OR superseded_at >= published_at
  );

-- -------------------------------------------------------------------------------------------
-- survey_version_questions: mesmas regras de tipo × obrigatoriedade × etapa, com instantâneo da etapa
-- -------------------------------------------------------------------------------------------
ALTER TABLE public.survey_version_questions
  ADD CONSTRAINT svq_type_required_stage CHECK (
    (type = 'nps' AND is_required AND journey_stage_id IS NULL)
    OR (type = 'scale_1_5' AND NOT is_required AND journey_stage_id IS NOT NULL)
  ),
  ADD CONSTRAINT svq_stage_snapshot_coherence CHECK (
    (journey_stage_id IS NULL AND journey_stage_name IS NULL AND journey_stage_position IS NULL)
    OR (journey_stage_id IS NOT NULL AND journey_stage_name IS NOT NULL AND journey_stage_position IS NOT NULL)
  ),
  ADD CONSTRAINT svq_text_not_blank CHECK (btrim(text) <> ''),
  ADD CONSTRAINT svq_position_positive CHECK (position > 0);

-- -------------------------------------------------------------------------------------------
-- responses: NPS 0–10 e nota baixa (RN01, RN05), origem × atribuição (RN07), token (RN22)
-- -------------------------------------------------------------------------------------------
ALTER TABLE public.responses
  ADD CONSTRAINT responses_nps_score_range CHECK (nps_score BETWEEN 0 AND 10),
  -- NPS de 0 a 6 é sempre nota baixa; com NPS 7–10, low_score indica específica 1 ou 2.
  ADD CONSTRAINT responses_low_score_coherence CHECK (nps_score > 6 OR low_score),
  ADD CONSTRAINT responses_origin_attribution CHECK (
    (origin = 'link' AND attribution_status = 'not_qr_origin')
    OR (origin = 'qr_code' AND attribution_status <> 'not_qr_origin')
  ),
  ADD CONSTRAINT responses_attribution_fields CHECK (
    (attribution_status = 'attributed' AND shift_id IS NOT NULL AND team_id IS NOT NULL AND shift_period IS NOT NULL)
    OR (attribution_status <> 'attributed' AND shift_id IS NULL AND team_id IS NULL AND shift_period IS NULL)
  ),
  ADD CONSTRAINT responses_manifestation_token_window CHECK (
    manifestation_token_expires_at > submitted_at
    AND manifestation_token_expires_at <= submitted_at + interval '60 minutes'
    AND (
      manifestation_token_used_at IS NULL
      OR manifestation_token_used_at BETWEEN submitted_at AND manifestation_token_expires_at
    )
  ),
  ADD CONSTRAINT responses_request_hash_format CHECK (request_hash ~ '^[0-9a-f]{64}$');

-- -------------------------------------------------------------------------------------------
-- response_answers: somente perguntas específicas, escala 1–5 (RN02)
-- -------------------------------------------------------------------------------------------
ALTER TABLE public.response_answers
  ADD CONSTRAINT response_answers_specific_only CHECK (question_type = 'scale_1_5'),
  ADD CONSTRAINT response_answers_score_range CHECK (score BETWEEN 1 AND 5);

-- -------------------------------------------------------------------------------------------
-- manifestations: protocolo, texto de 10 a 2.000 caracteres (RF41), conclusão com providências (RN23)
-- -------------------------------------------------------------------------------------------
ALTER TABLE public.manifestations
  ADD CONSTRAINT manifestations_protocol_format CHECK (protocol ~ '^FHD-[0-9]{4}-[0-9]{6}$'),
  ADD CONSTRAINT manifestations_description_length CHECK (
    char_length(btrim(description)) >= 10 AND char_length(description) <= 2000
  ),
  ADD CONSTRAINT manifestations_actions_not_blank CHECK (
    actions_taken IS NULL OR btrim(actions_taken) <> ''
  ),
  ADD CONSTRAINT manifestations_resolution_coherence CHECK (
    (
      status = 'resolved'
      AND resolved_at IS NOT NULL
      AND actions_taken IS NOT NULL
      AND char_length(btrim(actions_taken)) >= 10
    )
    OR (status <> 'resolved' AND resolved_at IS NULL)
  ),
  ADD CONSTRAINT manifestations_resolved_after_received CHECK (
    resolved_at IS NULL OR resolved_at >= received_at
  ),
  ADD CONSTRAINT manifestations_request_hash_format CHECK (request_hash ~ '^[0-9a-f]{64}$');

-- -------------------------------------------------------------------------------------------
-- manifestation_contacts: nome e telefone ou e-mail, formatos e aceite da finalidade (RN12, RF43)
-- -------------------------------------------------------------------------------------------
ALTER TABLE public.manifestation_contacts
  ADD CONSTRAINT manifestation_contacts_full_name_not_blank CHECK (btrim(full_name) <> ''),
  ADD CONSTRAINT manifestation_contacts_phone_or_email CHECK (phone IS NOT NULL OR email IS NOT NULL),
  -- Somente dígitos com DDD: 10 (fixo) ou 11 (celular) dígitos.
  ADD CONSTRAINT manifestation_contacts_phone_format CHECK (phone IS NULL OR phone ~ '^[0-9]{10,11}$'),
  ADD CONSTRAINT manifestation_contacts_email_format CHECK (
    email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  ADD CONSTRAINT manifestation_contacts_purpose_version_not_blank CHECK (btrim(purpose_text_version) <> '');

-- -------------------------------------------------------------------------------------------
-- manifestation_notes: regras por tipo de evento da linha do tempo
-- -------------------------------------------------------------------------------------------
-- COALESCE: em CHECK, um resultado NULL seria aceito; aqui NULL equivale a violação.
ALTER TABLE public.manifestation_notes
  ADD CONSTRAINT manifestation_notes_kind_rules CHECK (COALESCE(
    CASE kind
      -- Registro pela pesquisa pública (E03): sem autor, status inicial "received".
      WHEN 'created' THEN
        author_id IS NULL AND content IS NULL AND from_value IS NULL AND to_value = 'received'
      WHEN 'status_changed' THEN
        author_id IS NOT NULL AND content IS NULL
        AND from_value IN ('received', 'in_review', 'forwarded', 'resolved', 'archived')
        AND to_value IN ('received', 'in_review', 'forwarded', 'resolved', 'archived')
        AND from_value <> to_value
      WHEN 'priority_changed' THEN
        author_id IS NOT NULL AND content IS NULL
        AND from_value IN ('low', 'medium', 'high')
        AND to_value IN ('low', 'medium', 'high')
        AND from_value <> to_value
      WHEN 'actions_updated' THEN
        author_id IS NOT NULL AND content IS NOT NULL AND btrim(content) <> ''
        AND from_value IS NULL AND to_value IS NULL
      -- Nota interna (E38): 1 a 2.000 caracteres.
      WHEN 'note' THEN
        author_id IS NOT NULL AND content IS NOT NULL
        AND char_length(btrim(content)) >= 1 AND char_length(content) <= 2000
        AND from_value IS NULL AND to_value IS NULL
      -- Eliminação do contato (E40): motivo em to_value.
      WHEN 'contact_deleted' THEN
        author_id IS NOT NULL AND content IS NULL AND from_value IS NULL
        AND to_value IN ('holder_request', 'return_completed', 'other')
      ELSE false
    END,
    false
  ));

-- -------------------------------------------------------------------------------------------
-- audit_logs: campos obrigatórios não vazios, detalhes como objeto JSON e IP somente como HMAC
-- -------------------------------------------------------------------------------------------
ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_action_not_blank CHECK (btrim(action) <> ''),
  ADD CONSTRAINT audit_logs_entity_type_not_blank CHECK (btrim(entity_type) <> ''),
  ADD CONSTRAINT audit_logs_details_object CHECK (jsonb_typeof(details) = 'object'),
  ADD CONSTRAINT audit_logs_ip_hash_format CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$');
