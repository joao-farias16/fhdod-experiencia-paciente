-- =============================================================================================
-- FHDOD — esquema completo do banco MySQL 8.4 (ARQUIVO GERADO: não edite à mão)
-- =============================================================================================
-- Gerado por `npm run db:schema` a partir de database/migrations/ (5 migrations).
-- Uso no MySQL Workbench, em um banco VAZIO:
--   1. execute database/create_database.sql;
--   2. abra este arquivo, confira o USE abaixo e execute tudo (Ctrl+Shift+Enter);
--   3. (opcional) execute database/seeds/001_dados_base.sql.
-- O arquivo também registra as migrations em schema_migrations, para que `npm run db:migrate`
-- reconheça o banco como atualizado. Para bancos já existentes, aplique só as migrations novas.

USE fhdod;
SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    CHAR(3)      NOT NULL,
  name       VARCHAR(120) NOT NULL,
  checksum   CHAR(64)     NOT NULL,
  applied_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (version)
) ENGINE = InnoDB COMMENT = 'Controle das migrations aplicadas (database/migrations).';

-- >>> 001_tabelas.sql -----------------------------------------------------------------

-- =============================================================================================
-- Migration 001 — tabelas (colunas, tipos, valores padrão e chaves primárias)
-- =============================================================================================
-- Recria em MySQL 8.4 o modelo de dados da ET02 (Seção 8 e Tabela 17 da especificação), antes
-- mantido pelo Prisma no PostgreSQL. Não edite uma migration já aplicada: crie a próxima.
--
-- Convenções:
-- * tabelas e colunas em snake_case; identificadores UUID em CHAR(36), minúsculos (a API gera
--   UUID v4; o DEFAULT (UUID()) atende inserções manuais pelo MySQL Workbench);
-- * instantes em DATETIME(3), SEMPRE em UTC (a API abre as conexões com time_zone = '+00:00');
-- * domínios (antigos ENUM do PostgreSQL) em ENUM; booleanos em BOOLEAN (TINYINT(1));
-- * listas e objetos em JSON;
-- * a unicidade "uma pergunta geral por pesquisa/versão" (antes índice parcial) usa uma coluna
--   gerada que só tem valor quando type = 'nps' (NULL não conflita em índice UNIQUE).
-- Chaves únicas e índices: 002; chaves estrangeiras: 003; CHECK: 004; gatilhos: 005.

-- ---------------------------------------------------------------------------------------------
-- Estrutura institucional, usuários e escopo
-- ---------------------------------------------------------------------------------------------

CREATE TABLE hospitals (
  id         CHAR(36)     NOT NULL DEFAULT (UUID()),
  name       VARCHAR(160) NOT NULL,
  short_name VARCHAR(30)  NOT NULL,
  timezone   VARCHAR(64)  NOT NULL DEFAULT 'America/Sao_Paulo',
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE = InnoDB COMMENT = 'Hospital (instituição); um por instalação, com o fuso de referência.';

CREATE TABLE profiles (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()),
  hospital_id          CHAR(36)     NOT NULL,
  full_name            VARCHAR(120) NOT NULL,
  -- Sempre em minúsculas (CHECK profiles_email_lowercase).
  email                VARCHAR(254) NOT NULL,
  -- Hash bcrypt da senha (nunca a senha em texto puro). Substitui o Supabase Auth.
  password_hash        VARCHAR(255) NOT NULL,
  role                 ENUM('superadmin', 'sector_admin', 'management', 'ombudsman', 'viewer') NOT NULL,
  all_sectors          BOOLEAN      NOT NULL DEFAULT FALSE,
  is_active            BOOLEAN      NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN      NOT NULL DEFAULT TRUE,
  password_changed_at  DATETIME(3)  NULL,
  last_login_at        DATETIME(3)  NULL,
  deactivated_at       DATETIME(3)  NULL,
  deactivated_by       CHAR(36)     NULL,
  created_by           CHAR(36)     NULL,
  created_at           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE = InnoDB COMMENT = 'Usuários administrativos (perfis SA, AS, GE, OU e VI) e credenciais.';

CREATE TABLE auth_sessions (
  id                          CHAR(36)    NOT NULL DEFAULT (UUID()),
  profile_id                  CHAR(36)    NOT NULL,
  -- SHA-256 (hexadecimal) do token de renovação; o token em si nunca é gravado.
  refresh_token_hash          CHAR(64)    NOT NULL,
  -- Hash do token anterior à última renovação (detecção de reutilização).
  previous_refresh_token_hash CHAR(64)    NULL,
  created_at                  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_refreshed_at           DATETIME(3) NULL,
  expires_at                  DATETIME(3) NOT NULL,
  revoked_at                  DATETIME(3) NULL,
  revoked_reason              ENUM('logout', 'password_changed', 'password_reset', 'refresh_reuse') NULL,
  -- HMAC-SHA256 do IP do login (AUDIT_IP_SECRET); nunca o IP em claro.
  ip_hash                     CHAR(64)    NULL,
  PRIMARY KEY (id)
) ENGINE = InnoDB COMMENT = 'Sessões de login (token de renovação rotativo, logout e revogação).';

CREATE TABLE sectors (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()),
  hospital_id    CHAR(36)     NOT NULL,
  -- Padrão ^[A-Z0-9_-]{2,20}$ (RF12); imutável pela aplicação (RF14).
  code           VARCHAR(20)  NOT NULL,
  name           VARCHAR(120) NOT NULL,
  description    VARCHAR(500) NULL,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  deactivated_at DATETIME(3)  NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE = InnoDB COMMENT = 'Setores do hospital (RF12–RF15).';

CREATE TABLE profile_sectors (
  profile_id CHAR(36)    NOT NULL,
  sector_id  CHAR(36)    NOT NULL,
  created_by CHAR(36)    NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (profile_id, sector_id)
) ENGINE = InnoDB COMMENT = 'Escopo de setores de cada usuário (RN18, RF08).';

CREATE TABLE teams (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()),
  sector_id      CHAR(36)     NOT NULL,
  code           VARCHAR(20)  NOT NULL,
  name           VARCHAR(120) NOT NULL,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  deactivated_at DATETIME(3)  NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE = InnoDB COMMENT = 'Equipes de cada setor (RF16–RF18).';

-- ---------------------------------------------------------------------------------------------
-- Escalas
-- ---------------------------------------------------------------------------------------------

CREATE TABLE shift_imports (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()),
  uploaded_by   CHAR(36)     NOT NULL,
  file_name     VARCHAR(255) NOT NULL,
  file_sha256   CHAR(64)     NOT NULL,
  status        ENUM('validated', 'rejected', 'committed') NOT NULL,
  total_rows    INT          NOT NULL,
  accepted_rows INT          NOT NULL,
  rejected_rows INT          NOT NULL,
  -- Erros por linha e coluna (RF22); lista JSON.
  errors        JSON         NOT NULL DEFAULT (JSON_ARRAY()),
  -- Linhas validadas aguardando confirmação (RF23); lista JSON.
  staged_rows   JSON         NOT NULL DEFAULT (JSON_ARRAY()),
  expires_at    DATETIME(3)  NOT NULL,
  committed_at  DATETIME(3)  NULL,
  committed_by  CHAR(36)     NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE = InnoDB COMMENT = 'Importações de escala CSV (RF22, RF23).';

CREATE TABLE shifts (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()),
  sector_id     CHAR(36)     NOT NULL,
  team_id       CHAR(36)     NOT NULL,
  period        ENUM('morning', 'afternoon', 'night') NOT NULL,
  starts_at     DATETIME(3)  NOT NULL,
  ends_at       DATETIME(3)  NOT NULL,
  source        ENUM('manual', 'import') NOT NULL,
  import_id     CHAR(36)     NULL,
  created_by    CHAR(36)     NOT NULL,
  cancelled_at  DATETIME(3)  NULL,
  cancelled_by  CHAR(36)     NULL,
  cancel_reason VARCHAR(300) NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE = InnoDB COMMENT = 'Turnos das equipes (RF19–RF21); sem sobreposição por equipe (gatilho).';

-- ---------------------------------------------------------------------------------------------
-- Pesquisas, perguntas e versões
-- ---------------------------------------------------------------------------------------------

CREATE TABLE journey_stages (
  id         CHAR(36)    NOT NULL DEFAULT (UUID()),
  hospital_id CHAR(36)   NOT NULL,
  code       VARCHAR(30) NOT NULL,
  name       VARCHAR(80) NOT NULL,
  position   SMALLINT    NOT NULL,
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE = InnoDB COMMENT = 'Etapas da jornada do paciente (Seção 4.3).';

CREATE TABLE survey_configs (
  id                      CHAR(36)     NOT NULL DEFAULT (UUID()),
  sector_id               CHAR(36)     NOT NULL,
  title                   VARCHAR(120) NOT NULL,
  -- kebab-case (CHECK); setor e slug imutáveis após a primeira publicação (RN27, gatilho).
  slug                    VARCHAR(80)  NOT NULL,
  intro_text              VARCHAR(500) NULL,
  thank_you_message       VARCHAR(500) NOT NULL,
  is_active               BOOLEAN      NOT NULL DEFAULT TRUE,
  deactivated_at          DATETIME(3)  NULL,
  -- Versão vigente; o gatilho exige que seja uma versão desta pesquisa.
  current_version_id      CHAR(36)     NULL,
  has_unpublished_changes BOOLEAN      NOT NULL DEFAULT TRUE,
  created_by              CHAR(36)     NOT NULL,
  updated_by              CHAR(36)     NULL,
  created_at              DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at              DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE = InnoDB COMMENT = 'Configuração editável das pesquisas (rascunho e versão vigente).';

CREATE TABLE questions (
  id                 CHAR(36)     NOT NULL DEFAULT (UUID()),
  survey_config_id   CHAR(36)     NOT NULL,
  journey_stage_id   CHAR(36)     NULL,
  type               ENUM('nps', 'scale_1_5') NOT NULL,
  text               VARCHAR(200) NOT NULL,
  is_required        BOOLEAN      NOT NULL,
  position           SMALLINT     NOT NULL,
  is_active          BOOLEAN      NOT NULL DEFAULT TRUE,
  -- Preenchido na primeira publicação; depois disso texto, tipo e etapa ficam bloqueados (RN17).
  first_published_at DATETIME(3)  NULL,
  created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  -- Uma pergunta geral (nps) por pesquisa (RN01): valor só para a pergunta geral.
  nps_survey_config_id CHAR(36) GENERATED ALWAYS AS (CASE WHEN type = 'nps' THEN survey_config_id END) VIRTUAL,
  PRIMARY KEY (id)
) ENGINE = InnoDB COMMENT = 'Perguntas editáveis das pesquisas (geral 0–10 e específicas 1–5).';

CREATE TABLE survey_versions (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()),
  survey_config_id  CHAR(36)     NOT NULL,
  -- Instantâneo do setor da pesquisa no momento da publicação.
  sector_id         CHAR(36)     NOT NULL,
  version_number    INT          NOT NULL,
  title             VARCHAR(120) NOT NULL,
  intro_text        VARCHAR(500) NULL,
  thank_you_message VARCHAR(500) NOT NULL,
  published_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  published_by      CHAR(36)     NOT NULL,
  -- Única coluna alterável depois da publicação (gatilho de imutabilidade).
  superseded_at     DATETIME(3)  NULL,
  PRIMARY KEY (id)
) ENGINE = InnoDB COMMENT = 'Versões publicadas e imutáveis das pesquisas (RN06).';

CREATE TABLE survey_version_questions (
  id                     CHAR(36)     NOT NULL DEFAULT (UUID()),
  survey_version_id      CHAR(36)     NOT NULL,
  question_id            CHAR(36)     NOT NULL,
  type                   ENUM('nps', 'scale_1_5') NOT NULL,
  text                   VARCHAR(200) NOT NULL,
  journey_stage_id       CHAR(36)     NULL,
  journey_stage_name     VARCHAR(80)  NULL,
  journey_stage_position SMALLINT     NULL,
  position               SMALLINT     NOT NULL,
  is_required            BOOLEAN      NOT NULL,
  -- Uma pergunta geral (nps) por versão (RN01).
  nps_survey_version_id  CHAR(36) GENERATED ALWAYS AS (CASE WHEN type = 'nps' THEN survey_version_id END) VIRTUAL,
  PRIMARY KEY (id)
) ENGINE = InnoDB COMMENT = 'Instantâneo imutável das perguntas de cada versão publicada.';

-- ---------------------------------------------------------------------------------------------
-- Respostas
-- ---------------------------------------------------------------------------------------------

CREATE TABLE responses (
  id                             CHAR(36)    NOT NULL DEFAULT (UUID()),
  survey_version_id              CHAR(36)    NOT NULL,
  -- Instantâneo do setor da versão (FK composta com survey_versions).
  sector_id                      CHAR(36)    NOT NULL,
  origin                         ENUM('qr_code', 'link') NOT NULL,
  nps_score                      SMALLINT    NOT NULL,
  low_score                      BOOLEAN     NOT NULL,
  submitted_at                   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  attribution_status             ENUM('attributed', 'not_qr_origin', 'no_shift', 'ambiguous') NOT NULL,
  shift_id                       CHAR(36)    NULL,
  team_id                        CHAR(36)    NULL,
  shift_period                   ENUM('morning', 'afternoon', 'night') NULL,
  idempotency_key                CHAR(36)    NOT NULL,
  request_hash                   CHAR(64)    NOT NULL,
  manifestation_token_expires_at DATETIME(3) NOT NULL,
  -- Única coluna alterável depois do registro (uso único do token, RN22).
  manifestation_token_used_at    DATETIME(3) NULL,
  PRIMARY KEY (id)
) ENGINE = InnoDB COMMENT = 'Avaliações anônimas registradas pela pesquisa pública (imutáveis).';

CREATE TABLE response_answers (
  id                         CHAR(36) NOT NULL DEFAULT (UUID()),
  response_id                CHAR(36) NOT NULL,
  survey_version_id          CHAR(36) NOT NULL,
  survey_version_question_id CHAR(36) NOT NULL,
  -- Sempre scale_1_5: a nota geral fica em responses.nps_score (CHECK).
  question_type              ENUM('nps', 'scale_1_5') NOT NULL,
  score                      SMALLINT NOT NULL,
  PRIMARY KEY (id)
) ENGINE = InnoDB COMMENT = 'Notas das perguntas específicas (1–5) de cada avaliação.';

-- ---------------------------------------------------------------------------------------------
-- Manifestações e Ouvidoria
-- ---------------------------------------------------------------------------------------------

CREATE TABLE manifestation_protocol_sequence (
  id         TINYINT     NOT NULL,
  current_value INT      NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE = InnoDB COMMENT = 'Contador NNNNNN do protocolo FHD-AAAA-NNNNNN (substitui a SEQUENCE do PostgreSQL).';

INSERT INTO manifestation_protocol_sequence (id, current_value) VALUES (1, 0);

CREATE TABLE manifestations (
  id                     CHAR(36)    NOT NULL DEFAULT (UUID()),
  -- FHD-AAAA-NNNNNN; preenchido pelo gatilho manifestations_before_insert quando vazio.
  protocol               VARCHAR(15) NOT NULL DEFAULT '',
  response_id            CHAR(36)    NOT NULL,
  sector_id              CHAR(36)    NOT NULL,
  type                   ENUM('compliment', 'complaint', 'suggestion') NOT NULL,
  description            TEXT        NOT NULL,
  is_anonymous           BOOLEAN     NOT NULL DEFAULT TRUE,
  triggered_by_low_score BOOLEAN     NOT NULL,
  status                 ENUM('received', 'in_review', 'forwarded', 'resolved', 'archived') NOT NULL DEFAULT 'received',
  priority               ENUM('low', 'medium', 'high') NOT NULL DEFAULT 'medium',
  actions_taken          TEXT        NULL,
  received_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at            DATETIME(3) NULL,
  updated_by             CHAR(36)    NULL,
  idempotency_key        CHAR(36)    NOT NULL,
  request_hash           CHAR(64)    NOT NULL,
  created_at             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  -- Controle de concorrência otimista do RF46.
  updated_at             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE = InnoDB COMMENT = 'Elogios, reclamações e sugestões vinculados a uma avaliação.';

CREATE TABLE manifestation_contacts (
  manifestation_id     CHAR(36)     NOT NULL,
  full_name            VARCHAR(120) NOT NULL,
  -- Somente dígitos, com DDD (10 ou 11 dígitos).
  phone                VARCHAR(11)  NULL,
  email                VARCHAR(254) NULL,
  consent_given_at     DATETIME(3)  NOT NULL,
  -- Versão do texto de finalidade aceito (Seção 4.3), por exemplo "v1".
  purpose_text_version VARCHAR(10)  NOT NULL,
  created_at           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (manifestation_id)
) ENGINE = InnoDB COMMENT = 'Contato voluntário, segregado dos indicadores (RN12); nunca em manifestação anônima.';

CREATE TABLE manifestation_notes (
  id               CHAR(36)    NOT NULL DEFAULT (UUID()),
  manifestation_id CHAR(36)    NOT NULL,
  author_id        CHAR(36)    NULL,
  kind             ENUM('created', 'status_changed', 'priority_changed', 'actions_updated', 'note', 'contact_deleted') NOT NULL,
  content          TEXT        NULL,
  from_value       VARCHAR(30) NULL,
  to_value         VARCHAR(30) NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE = InnoDB COMMENT = 'Linha do tempo da manifestação: eventos e notas internas (sem UPDATE).';

-- ---------------------------------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------------------------------

CREATE TABLE audit_logs (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  occurred_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actor_profile_id CHAR(36)        NULL,
  actor_role       ENUM('superadmin', 'sector_admin', 'management', 'ombudsman', 'viewer') NULL,
  action           VARCHAR(60)     NOT NULL,
  entity_type      VARCHAR(40)     NOT NULL,
  entity_id        VARCHAR(64)     NULL,
  sector_id        CHAR(36)        NULL,
  details          JSON            NOT NULL DEFAULT (JSON_OBJECT()),
  request_id       CHAR(36)        NULL,
  -- HMAC-SHA256 do IP com AUDIT_IP_SECRET (Seção 10); nunca o IP em claro.
  ip_hash          CHAR(64)        NULL,
  PRIMARY KEY (id)
) ENGINE = InnoDB COMMENT = 'Trilha de auditoria: somente inserção (gatilhos), sem dados pessoais.';

-- >>> 002_chaves_unicas_e_indices.sql -------------------------------------------------

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

-- >>> 003_relacionamentos.sql ---------------------------------------------------------

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

-- >>> 004_restricoes.sql --------------------------------------------------------------

-- =============================================================================================
-- Migration 004 — restrições de integridade (CHECK)
-- =============================================================================================
-- Regras de domínio e coerência das Tabelas 16 e 17 (MySQL 8.0.16+ aplica CHECK de fato).
-- Os nomes são os mesmos do modelo anterior: a API e os testes identificam a regra violada pelo
-- nome informado na mensagem do MySQL ("Check constraint '<nome>' is violated.").
-- Expressões regulares com REGEXP_LIKE(..., 'c'): sempre sensíveis a maiúsculas.
-- Regras que dependem de outras linhas ou tabelas ficam nos gatilhos (005).

-- hospitals ------------------------------------------------------------------------------------
ALTER TABLE hospitals
  ADD CONSTRAINT hospitals_name_not_blank CHECK (TRIM(name) <> ''),
  ADD CONSTRAINT hospitals_short_name_not_blank CHECK (TRIM(short_name) <> ''),
  ADD CONSTRAINT hospitals_timezone_not_blank CHECK (TRIM(timezone) <> '');

-- profiles: e-mail em minúsculas, senha só como hash, escopo por perfil (RN18), situação (RF09) --
ALTER TABLE profiles
  ADD CONSTRAINT profiles_full_name_not_blank CHECK (TRIM(full_name) <> ''),
  ADD CONSTRAINT profiles_email_lowercase CHECK (email = LOWER(email)),
  ADD CONSTRAINT profiles_email_format CHECK (REGEXP_LIKE(email, '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$', 'c')),
  -- Hash bcrypt ($2a$, $2b$ ou $2y$, custo de 2 dígitos e 53 caracteres): nunca texto puro.
  ADD CONSTRAINT profiles_password_hash_bcrypt CHECK (REGEXP_LIKE(password_hash, '^\\$2[aby]\\$[0-9]{2}\\$[./A-Za-z0-9]{53}$', 'c')),
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

-- auth_sessions --------------------------------------------------------------------------------
ALTER TABLE auth_sessions
  ADD CONSTRAINT auth_sessions_refresh_hash_format CHECK (REGEXP_LIKE(refresh_token_hash, '^[0-9a-f]{64}$', 'c')),
  ADD CONSTRAINT auth_sessions_previous_hash_format CHECK (
    previous_refresh_token_hash IS NULL OR REGEXP_LIKE(previous_refresh_token_hash, '^[0-9a-f]{64}$', 'c')
  ),
  ADD CONSTRAINT auth_sessions_expiration_after_creation CHECK (expires_at > created_at),
  ADD CONSTRAINT auth_sessions_revocation_coherence CHECK (
    (revoked_at IS NULL AND revoked_reason IS NULL) OR (revoked_at IS NOT NULL AND revoked_reason IS NOT NULL)
  ),
  ADD CONSTRAINT auth_sessions_ip_hash_format CHECK (ip_hash IS NULL OR REGEXP_LIKE(ip_hash, '^[0-9a-f]{64}$', 'c'));

-- sectors: código A–Z, 0–9, _ e - com 2 a 20 caracteres (RF12) -----------------------------------
ALTER TABLE sectors
  ADD CONSTRAINT sectors_code_format CHECK (REGEXP_LIKE(code, '^[A-Z0-9_-]{2,20}$', 'c')),
  ADD CONSTRAINT sectors_name_not_blank CHECK (TRIM(name) <> ''),
  ADD CONSTRAINT sectors_active_coherence CHECK (is_active = (deactivated_at IS NULL));

-- teams ----------------------------------------------------------------------------------------
ALTER TABLE teams
  ADD CONSTRAINT teams_code_not_blank CHECK (TRIM(code) <> ''),
  ADD CONSTRAINT teams_name_not_blank CHECK (TRIM(name) <> ''),
  ADD CONSTRAINT teams_active_coherence CHECK (is_active = (deactivated_at IS NULL));

-- shifts: duração de 1 a 24 h (RN20), origem coerente e cancelamento coerente (RF21) -----------
-- A ausência de sobreposição por equipe (antes EXCLUDE USING gist) é garantida por gatilho (005).
ALTER TABLE shifts
  ADD CONSTRAINT shifts_duration_1_to_24h CHECK (
    ends_at >= starts_at + INTERVAL 1 HOUR AND ends_at <= starts_at + INTERVAL 24 HOUR
  ),
  ADD CONSTRAINT shifts_source_import_coherence CHECK ((source = 'import') = (import_id IS NOT NULL)),
  ADD CONSTRAINT shifts_cancellation_coherence CHECK (
    (cancelled_at IS NULL AND cancelled_by IS NULL AND cancel_reason IS NULL)
    OR (
      cancelled_at IS NOT NULL
      AND cancelled_by IS NOT NULL
      AND cancel_reason IS NOT NULL
      AND CHAR_LENGTH(TRIM(cancel_reason)) BETWEEN 5 AND 300
    )
  );

-- shift_imports: totais (até 2.000 linhas, RN19), status coerente e confirmação em até 30 min ---
ALTER TABLE shift_imports
  ADD CONSTRAINT shift_imports_file_name_not_blank CHECK (TRIM(file_name) <> ''),
  ADD CONSTRAINT shift_imports_file_sha256_format CHECK (REGEXP_LIKE(file_sha256, '^[0-9a-f]{64}$', 'c')),
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
    expires_at > created_at AND expires_at <= created_at + INTERVAL 30 MINUTE
  ),
  ADD CONSTRAINT shift_imports_json_arrays CHECK (
    JSON_TYPE(errors) = 'ARRAY' AND JSON_TYPE(staged_rows) = 'ARRAY'
  ),
  ADD CONSTRAINT shift_imports_rejected_has_errors CHECK (
    status <> 'rejected' OR JSON_LENGTH(errors) > 0
  );

-- survey_configs: slug kebab-case e coerência de is_active --------------------------------------
ALTER TABLE survey_configs
  ADD CONSTRAINT survey_configs_slug_kebab_case CHECK (REGEXP_LIKE(slug, '^[a-z0-9]+(-[a-z0-9]+)*$', 'c')),
  ADD CONSTRAINT survey_configs_title_not_blank CHECK (TRIM(title) <> ''),
  ADD CONSTRAINT survey_configs_thank_you_not_blank CHECK (TRIM(thank_you_message) <> ''),
  ADD CONSTRAINT survey_configs_active_coherence CHECK (is_active = (deactivated_at IS NULL));

-- journey_stages -------------------------------------------------------------------------------
ALTER TABLE journey_stages
  ADD CONSTRAINT journey_stages_code_not_blank CHECK (TRIM(code) <> ''),
  ADD CONSTRAINT journey_stages_name_not_blank CHECK (TRIM(name) <> ''),
  ADD CONSTRAINT journey_stages_position_positive CHECK (position > 0);

-- questions: tipo × obrigatoriedade × etapa (RN01, RN02); a geral nunca é desativada (RF28) ----
ALTER TABLE questions
  ADD CONSTRAINT questions_type_required_stage CHECK (
    (type = 'nps' AND is_required AND journey_stage_id IS NULL)
    OR (type = 'scale_1_5' AND NOT is_required AND journey_stage_id IS NOT NULL)
  ),
  ADD CONSTRAINT questions_nps_always_active CHECK (type <> 'nps' OR is_active),
  ADD CONSTRAINT questions_text_not_blank CHECK (TRIM(text) <> ''),
  ADD CONSTRAINT questions_position_positive CHECK (position > 0);

-- survey_versions ------------------------------------------------------------------------------
ALTER TABLE survey_versions
  ADD CONSTRAINT survey_versions_number_positive CHECK (version_number > 0),
  ADD CONSTRAINT survey_versions_title_not_blank CHECK (TRIM(title) <> ''),
  ADD CONSTRAINT survey_versions_thank_you_not_blank CHECK (TRIM(thank_you_message) <> ''),
  ADD CONSTRAINT survey_versions_superseded_after_published CHECK (
    superseded_at IS NULL OR superseded_at >= published_at
  );

-- survey_version_questions: mesmas regras, com o instantâneo da etapa ---------------------------
ALTER TABLE survey_version_questions
  ADD CONSTRAINT svq_type_required_stage CHECK (
    (type = 'nps' AND is_required AND journey_stage_id IS NULL)
    OR (type = 'scale_1_5' AND NOT is_required AND journey_stage_id IS NOT NULL)
  ),
  ADD CONSTRAINT svq_stage_snapshot_coherence CHECK (
    (journey_stage_id IS NULL AND journey_stage_name IS NULL AND journey_stage_position IS NULL)
    OR (journey_stage_id IS NOT NULL AND journey_stage_name IS NOT NULL AND journey_stage_position IS NOT NULL)
  ),
  ADD CONSTRAINT svq_text_not_blank CHECK (TRIM(text) <> ''),
  ADD CONSTRAINT svq_position_positive CHECK (position > 0);

-- responses: NPS 0–10 e nota baixa (RN01, RN05), origem × atribuição (RN07), token (RN22) -------
ALTER TABLE responses
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
    AND manifestation_token_expires_at <= submitted_at + INTERVAL 60 MINUTE
    AND (
      manifestation_token_used_at IS NULL
      OR manifestation_token_used_at BETWEEN submitted_at AND manifestation_token_expires_at
    )
  ),
  ADD CONSTRAINT responses_request_hash_format CHECK (REGEXP_LIKE(request_hash, '^[0-9a-f]{64}$', 'c'));

-- response_answers: somente perguntas específicas, escala 1–5 (RN02) ----------------------------
ALTER TABLE response_answers
  ADD CONSTRAINT response_answers_specific_only CHECK (question_type = 'scale_1_5'),
  ADD CONSTRAINT response_answers_score_range CHECK (score BETWEEN 1 AND 5);

-- manifestation_protocol_sequence: linha única e limite de 6 dígitos ---------------------------
ALTER TABLE manifestation_protocol_sequence
  ADD CONSTRAINT manifestation_protocol_sequence_single_row CHECK (id = 1),
  ADD CONSTRAINT manifestation_protocol_sequence_range CHECK (current_value BETWEEN 0 AND 999999);

-- manifestations: protocolo, texto de 10 a 2.000 caracteres (RF41), conclusão (RN23) -----------
ALTER TABLE manifestations
  ADD CONSTRAINT manifestations_protocol_format CHECK (REGEXP_LIKE(protocol, '^FHD-[0-9]{4}-[0-9]{6}$', 'c')),
  ADD CONSTRAINT manifestations_description_length CHECK (
    CHAR_LENGTH(TRIM(description)) >= 10 AND CHAR_LENGTH(description) <= 2000
  ),
  ADD CONSTRAINT manifestations_actions_not_blank CHECK (
    actions_taken IS NULL OR TRIM(actions_taken) <> ''
  ),
  ADD CONSTRAINT manifestations_resolution_coherence CHECK (
    (
      status = 'resolved'
      AND resolved_at IS NOT NULL
      AND actions_taken IS NOT NULL
      AND CHAR_LENGTH(TRIM(actions_taken)) >= 10
    )
    OR (status <> 'resolved' AND resolved_at IS NULL)
  ),
  ADD CONSTRAINT manifestations_resolved_after_received CHECK (
    resolved_at IS NULL OR resolved_at >= received_at
  ),
  ADD CONSTRAINT manifestations_request_hash_format CHECK (REGEXP_LIKE(request_hash, '^[0-9a-f]{64}$', 'c'));

-- manifestation_contacts: nome e telefone ou e-mail, formatos e aceite (RN12, RF43) ------------
ALTER TABLE manifestation_contacts
  ADD CONSTRAINT manifestation_contacts_full_name_not_blank CHECK (TRIM(full_name) <> ''),
  ADD CONSTRAINT manifestation_contacts_phone_or_email CHECK (phone IS NOT NULL OR email IS NOT NULL),
  -- Somente dígitos com DDD: 10 (fixo) ou 11 (celular) dígitos.
  ADD CONSTRAINT manifestation_contacts_phone_format CHECK (phone IS NULL OR REGEXP_LIKE(phone, '^[0-9]{10,11}$', 'c')),
  ADD CONSTRAINT manifestation_contacts_email_format CHECK (
    email IS NULL OR REGEXP_LIKE(email, '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$', 'c')
  ),
  ADD CONSTRAINT manifestation_contacts_purpose_version_not_blank CHECK (TRIM(purpose_text_version) <> '');

-- manifestation_notes: regras por tipo de evento da linha do tempo -----------------------------
-- IS TRUE: em CHECK, um resultado NULL seria aceito; aqui NULL equivale a violação.
ALTER TABLE manifestation_notes
  ADD CONSTRAINT manifestation_notes_kind_rules CHECK ((
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
        author_id IS NOT NULL AND content IS NOT NULL AND TRIM(content) <> ''
        AND from_value IS NULL AND to_value IS NULL
      -- Nota interna (E38): 1 a 2.000 caracteres.
      WHEN 'note' THEN
        author_id IS NOT NULL AND content IS NOT NULL
        AND CHAR_LENGTH(TRIM(content)) >= 1 AND CHAR_LENGTH(content) <= 2000
        AND from_value IS NULL AND to_value IS NULL
      -- Eliminação do contato (E40): motivo em to_value.
      WHEN 'contact_deleted' THEN
        author_id IS NOT NULL AND content IS NULL AND from_value IS NULL
        AND to_value IN ('holder_request', 'return_completed', 'other')
      ELSE FALSE
    END
  ) IS TRUE);

-- audit_logs: campos obrigatórios, detalhes como objeto JSON e IP somente como HMAC -------------
ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_action_not_blank CHECK (TRIM(action) <> ''),
  ADD CONSTRAINT audit_logs_entity_type_not_blank CHECK (TRIM(entity_type) <> ''),
  ADD CONSTRAINT audit_logs_details_object CHECK (JSON_TYPE(details) = 'OBJECT'),
  ADD CONSTRAINT audit_logs_ip_hash_format CHECK (ip_hash IS NULL OR REGEXP_LIKE(ip_hash, '^[0-9a-f]{64}$', 'c'));

-- >>> 005_gatilhos.sql ----------------------------------------------------------------

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

-- Registro das migrations aplicadas por este arquivo.
INSERT INTO schema_migrations (version, name, checksum) VALUES
  ('001', 'tabelas', 'f83e7d5b0d8892c2bdf99660df8fad97e16693894c86f9dfbae34487d939a6d4'),
  ('002', 'chaves_unicas_e_indices', '4382777740f1745a3687f4c83766d95a9a05773d6016680814ccce6ae76cf35d'),
  ('003', 'relacionamentos', 'c5b24eac13e76a0ef26074fb9e0bb1f5c921561e87da764e735c8245530b50e5'),
  ('004', 'restricoes', 'ca226bc2c3f24390d1a9f5993f5cc4f5ba3a9d1a3105e76ad06a63a0b2b8fef5'),
  ('005', 'gatilhos', '82cc90d613769b63ace0b4bb9c163af97f22b190ba8482af61375da4e649e63f');
