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
