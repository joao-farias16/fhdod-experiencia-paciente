-- =============================================================================================
-- Migration 002 — chaves únicas e índices
-- =============================================================================================
-- Os nomes seguem os do modelo anterior (PostgreSQL), pois a API identifica conflitos pelo nome da
-- chave (por exemplo, sectors_hospital_id_code_key → 409 CONFLICT no campo code).
-- As chaves compostas (id, sector_id) etc. são alvo das chaves estrangeiras compostas da 003, que
-- garantem a coerência de setor entre turnos, equipes, versões, respostas e manifestações.

-- hospitals ------------------------------------------------------------------------------------
ALTER TABLE hospitals
  ADD UNIQUE KEY hospitals_short_name_key (short_name);

-- profiles -------------------------------------------------------------------------------------
ALTER TABLE profiles
  ADD UNIQUE KEY profiles_email_key (email),
  ADD KEY profiles_hospital_id_idx (hospital_id),
  ADD KEY profiles_hospital_id_role_is_active_idx (hospital_id, role, is_active);

-- auth_sessions --------------------------------------------------------------------------------
ALTER TABLE auth_sessions
  ADD UNIQUE KEY auth_sessions_refresh_token_hash_key (refresh_token_hash),
  ADD KEY auth_sessions_previous_refresh_token_hash_idx (previous_refresh_token_hash),
  ADD KEY auth_sessions_profile_id_revoked_at_idx (profile_id, revoked_at);

-- sectors: nome único no hospital sem distinguir maiúsculas (índice funcional) ----------------
ALTER TABLE sectors
  ADD UNIQUE KEY sectors_hospital_id_code_key (hospital_id, code),
  ADD UNIQUE KEY sectors_hospital_id_lower_name_key (hospital_id, (LOWER(name)));

-- profile_sectors ------------------------------------------------------------------------------
ALTER TABLE profile_sectors
  ADD KEY profile_sectors_sector_id_idx (sector_id);

-- teams ----------------------------------------------------------------------------------------
ALTER TABLE teams
  ADD UNIQUE KEY teams_sector_id_code_key (sector_id, code),
  -- Alvo da FK composta (team_id, sector_id) de shifts e responses.
  ADD UNIQUE KEY teams_id_sector_id_key (id, sector_id);

-- shift_imports --------------------------------------------------------------------------------
ALTER TABLE shift_imports
  ADD KEY shift_imports_uploaded_by_created_at_idx (uploaded_by, created_at);

-- shifts ---------------------------------------------------------------------------------------
ALTER TABLE shifts
  ADD KEY shifts_sector_id_starts_at_ends_at_idx (sector_id, starts_at, ends_at),
  -- Busca de sobreposição por equipe (antes atendida pelo índice GiST da restrição EXCLUDE).
  ADD KEY shifts_team_id_starts_at_ends_at_idx (team_id, starts_at, ends_at),
  ADD KEY shifts_import_id_idx (import_id);

-- journey_stages -------------------------------------------------------------------------------
ALTER TABLE journey_stages
  ADD UNIQUE KEY journey_stages_hospital_id_code_key (hospital_id, code),
  ADD UNIQUE KEY journey_stages_hospital_id_position_key (hospital_id, position);

-- survey_configs -------------------------------------------------------------------------------
ALTER TABLE survey_configs
  ADD UNIQUE KEY survey_configs_slug_key (slug),
  ADD UNIQUE KEY survey_configs_current_version_id_key (current_version_id),
  -- Alvo da FK composta (survey_config_id, sector_id) de survey_versions.
  ADD UNIQUE KEY survey_configs_id_sector_id_key (id, sector_id),
  ADD KEY survey_configs_sector_id_idx (sector_id);

-- questions ------------------------------------------------------------------------------------
ALTER TABLE questions
  ADD UNIQUE KEY questions_one_nps_per_survey_key (nps_survey_config_id),
  ADD KEY questions_survey_config_id_position_idx (survey_config_id, position),
  ADD KEY questions_journey_stage_id_idx (journey_stage_id);

-- survey_versions ------------------------------------------------------------------------------
ALTER TABLE survey_versions
  ADD UNIQUE KEY survey_versions_survey_config_id_version_number_key (survey_config_id, version_number),
  -- Alvo da FK composta (survey_version_id, sector_id) de responses.
  ADD UNIQUE KEY survey_versions_id_sector_id_key (id, sector_id),
  ADD KEY survey_versions_survey_config_id_sector_id_idx (survey_config_id, sector_id);

-- survey_version_questions ---------------------------------------------------------------------
ALTER TABLE survey_version_questions
  ADD UNIQUE KEY survey_version_questions_version_question_key (survey_version_id, question_id),
  ADD UNIQUE KEY survey_version_questions_version_position_key (survey_version_id, position),
  -- Alvo da FK composta de response_answers: a pergunta pertence à versão e tem o tipo informado.
  ADD UNIQUE KEY survey_version_questions_id_version_type_key (id, survey_version_id, type),
  ADD UNIQUE KEY survey_version_questions_one_nps_per_version_key (nps_survey_version_id),
  ADD KEY survey_version_questions_question_id_idx (question_id),
  ADD KEY survey_version_questions_journey_stage_id_idx (journey_stage_id);

-- responses ------------------------------------------------------------------------------------
ALTER TABLE responses
  ADD UNIQUE KEY responses_idempotency_key_key (idempotency_key),
  -- Alvos das FKs compostas de response_answers e manifestations.
  ADD UNIQUE KEY responses_id_survey_version_id_key (id, survey_version_id),
  ADD UNIQUE KEY responses_id_sector_id_key (id, sector_id),
  ADD KEY responses_submitted_at_idx (submitted_at),
  ADD KEY responses_sector_id_submitted_at_idx (sector_id, submitted_at),
  ADD KEY responses_team_id_submitted_at_idx (team_id, submitted_at),
  ADD KEY responses_shift_period_submitted_at_idx (shift_period, submitted_at),
  ADD KEY responses_shift_id_idx (shift_id),
  ADD KEY responses_survey_version_id_sector_id_idx (survey_version_id, sector_id);

-- response_answers -----------------------------------------------------------------------------
ALTER TABLE response_answers
  ADD UNIQUE KEY response_answers_response_question_key (response_id, survey_version_question_id),
  ADD KEY response_answers_response_id_survey_version_id_idx (response_id, survey_version_id),
  ADD KEY response_answers_svq_version_type_idx (survey_version_question_id, survey_version_id, question_type);

-- manifestations -------------------------------------------------------------------------------
ALTER TABLE manifestations
  ADD UNIQUE KEY manifestations_protocol_key (protocol),
  ADD UNIQUE KEY manifestations_response_id_key (response_id),
  ADD UNIQUE KEY manifestations_idempotency_key_key (idempotency_key),
  ADD KEY manifestations_response_id_sector_id_idx (response_id, sector_id),
  ADD KEY manifestations_status_received_at_idx (status, received_at),
  ADD KEY manifestations_sector_id_received_at_idx (sector_id, received_at),
  ADD KEY manifestations_type_idx (type),
  ADD KEY manifestations_priority_idx (priority),
  ADD KEY manifestations_received_at_idx (received_at);

-- manifestation_notes --------------------------------------------------------------------------
ALTER TABLE manifestation_notes
  ADD KEY manifestation_notes_manifestation_id_created_at_idx (manifestation_id, created_at),
  ADD KEY manifestation_notes_author_id_idx (author_id);

-- audit_logs -----------------------------------------------------------------------------------
ALTER TABLE audit_logs
  ADD KEY audit_logs_occurred_at_idx (occurred_at),
  ADD KEY audit_logs_actor_profile_id_occurred_at_idx (actor_profile_id, occurred_at),
  ADD KEY audit_logs_entity_type_entity_id_idx (entity_type, entity_id),
  ADD KEY audit_logs_action_occurred_at_idx (action, occurred_at),
  ADD KEY audit_logs_sector_id_idx (sector_id);
