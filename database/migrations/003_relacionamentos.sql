-- =============================================================================================
-- Migration 003 — relacionamentos (chaves estrangeiras)
-- =============================================================================================
-- Regra geral: ON DELETE RESTRICT (nada some em cascada; o histórico é preservado, RN11/RN15).
-- ON DELETE CASCADE somente nas dependências subordinadas: profile_sectors (vínculo do perfil),
-- auth_sessions (sessões do perfil), response_answers (notas da resposta), manifestation_contacts
-- e manifestation_notes (dados da manifestação).
--
-- ON UPDATE RESTRICT: as chaves são UUIDs imutáveis. (No PostgreSQL era ON UPDATE CASCADE, sem
-- efeito prático; no MySQL, colunas usadas em CHECK não podem ter ação referencial em cascata.)
--
-- FKs compostas garantem coerência de setor sem depender da aplicação:
-- * shifts/responses (team_id, sector_id) → teams (id, sector_id): equipe do mesmo setor;
-- * survey_versions (survey_config_id, sector_id) → survey_configs (id, sector_id);
-- * responses (survey_version_id, sector_id) → survey_versions (id, sector_id);
-- * response_answers (response_id, survey_version_id) → responses (id, survey_version_id) e
--   (survey_version_question_id, survey_version_id, question_type) → survey_version_questions;
-- * manifestations (response_id, sector_id) → responses (id, sector_id).

ALTER TABLE profiles
  ADD CONSTRAINT profiles_hospital_id_fkey FOREIGN KEY (hospital_id)
    REFERENCES hospitals (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT profiles_deactivated_by_fkey FOREIGN KEY (deactivated_by)
    REFERENCES profiles (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT profiles_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES profiles (id) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE auth_sessions
  ADD CONSTRAINT auth_sessions_profile_id_fkey FOREIGN KEY (profile_id)
    REFERENCES profiles (id) ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE sectors
  ADD CONSTRAINT sectors_hospital_id_fkey FOREIGN KEY (hospital_id)
    REFERENCES hospitals (id) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE profile_sectors
  ADD CONSTRAINT profile_sectors_profile_id_fkey FOREIGN KEY (profile_id)
    REFERENCES profiles (id) ON DELETE CASCADE ON UPDATE RESTRICT,
  ADD CONSTRAINT profile_sectors_sector_id_fkey FOREIGN KEY (sector_id)
    REFERENCES sectors (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT profile_sectors_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES profiles (id) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE teams
  ADD CONSTRAINT teams_sector_id_fkey FOREIGN KEY (sector_id)
    REFERENCES sectors (id) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE shift_imports
  ADD CONSTRAINT shift_imports_uploaded_by_fkey FOREIGN KEY (uploaded_by)
    REFERENCES profiles (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT shift_imports_committed_by_fkey FOREIGN KEY (committed_by)
    REFERENCES profiles (id) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE shifts
  ADD CONSTRAINT shifts_sector_id_fkey FOREIGN KEY (sector_id)
    REFERENCES sectors (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- A equipe pertence ao mesmo setor do turno (RN20).
  ADD CONSTRAINT shifts_team_id_sector_id_fkey FOREIGN KEY (team_id, sector_id)
    REFERENCES teams (id, sector_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT shifts_import_id_fkey FOREIGN KEY (import_id)
    REFERENCES shift_imports (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT shifts_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES profiles (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT shifts_cancelled_by_fkey FOREIGN KEY (cancelled_by)
    REFERENCES profiles (id) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE journey_stages
  ADD CONSTRAINT journey_stages_hospital_id_fkey FOREIGN KEY (hospital_id)
    REFERENCES hospitals (id) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE survey_configs
  ADD CONSTRAINT survey_configs_sector_id_fkey FOREIGN KEY (sector_id)
    REFERENCES sectors (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT survey_configs_current_version_id_fkey FOREIGN KEY (current_version_id)
    REFERENCES survey_versions (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT survey_configs_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES profiles (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT survey_configs_updated_by_fkey FOREIGN KEY (updated_by)
    REFERENCES profiles (id) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE questions
  ADD CONSTRAINT questions_survey_config_id_fkey FOREIGN KEY (survey_config_id)
    REFERENCES survey_configs (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT questions_journey_stage_id_fkey FOREIGN KEY (journey_stage_id)
    REFERENCES journey_stages (id) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE survey_versions
  -- Instantâneo do setor: o mesmo setor da pesquisa no momento da publicação.
  ADD CONSTRAINT survey_versions_survey_config_id_sector_id_fkey FOREIGN KEY (survey_config_id, sector_id)
    REFERENCES survey_configs (id, sector_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT survey_versions_published_by_fkey FOREIGN KEY (published_by)
    REFERENCES profiles (id) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE survey_version_questions
  ADD CONSTRAINT survey_version_questions_survey_version_id_fkey FOREIGN KEY (survey_version_id)
    REFERENCES survey_versions (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT survey_version_questions_question_id_fkey FOREIGN KEY (question_id)
    REFERENCES questions (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT survey_version_questions_journey_stage_id_fkey FOREIGN KEY (journey_stage_id)
    REFERENCES journey_stages (id) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE responses
  ADD CONSTRAINT responses_survey_version_id_sector_id_fkey FOREIGN KEY (survey_version_id, sector_id)
    REFERENCES survey_versions (id, sector_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT responses_sector_id_fkey FOREIGN KEY (sector_id)
    REFERENCES sectors (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT responses_shift_id_fkey FOREIGN KEY (shift_id)
    REFERENCES shifts (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT responses_team_id_sector_id_fkey FOREIGN KEY (team_id, sector_id)
    REFERENCES teams (id, sector_id) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE response_answers
  -- A resposta pertence à mesma versão informada (CASCADE: dependência subordinada).
  ADD CONSTRAINT response_answers_response_id_survey_version_id_fkey FOREIGN KEY (response_id, survey_version_id)
    REFERENCES responses (id, survey_version_id) ON DELETE CASCADE ON UPDATE RESTRICT,
  -- A pergunta pertence à mesma versão e tem o tipo informado (T32, cenário 1).
  ADD CONSTRAINT response_answers_svq_version_type_fkey FOREIGN KEY (survey_version_question_id, survey_version_id, question_type)
    REFERENCES survey_version_questions (id, survey_version_id, type) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE manifestations
  ADD CONSTRAINT manifestations_response_id_sector_id_fkey FOREIGN KEY (response_id, sector_id)
    REFERENCES responses (id, sector_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT manifestations_sector_id_fkey FOREIGN KEY (sector_id)
    REFERENCES sectors (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT manifestations_updated_by_fkey FOREIGN KEY (updated_by)
    REFERENCES profiles (id) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE manifestation_contacts
  ADD CONSTRAINT manifestation_contacts_manifestation_id_fkey FOREIGN KEY (manifestation_id)
    REFERENCES manifestations (id) ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE manifestation_notes
  ADD CONSTRAINT manifestation_notes_manifestation_id_fkey FOREIGN KEY (manifestation_id)
    REFERENCES manifestations (id) ON DELETE CASCADE ON UPDATE RESTRICT,
  ADD CONSTRAINT manifestation_notes_author_id_fkey FOREIGN KEY (author_id)
    REFERENCES profiles (id) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_actor_profile_id_fkey FOREIGN KEY (actor_profile_id)
    REFERENCES profiles (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT audit_logs_sector_id_fkey FOREIGN KEY (sector_id)
    REFERENCES sectors (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
