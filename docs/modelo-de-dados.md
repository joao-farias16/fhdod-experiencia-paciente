# Modelo de dados (D05) — ET02

Implementação da Seção 8 e das Tabelas 16 e 17 da especificação (v1.1). O esquema é criado **somente** pelas migrations versionadas em [`backend/prisma/migrations`](../backend/prisma/migrations) e espelhado em [`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma). Padrões, migrations e seed: [`padroes-banco-de-dados.md`](padroes-banco-de-dados.md). Mapeamento Prisma × tabelas e consultas: [`mapeamento-classes-e-consultas.md`](mapeamento-classes-e-consultas.md).

## Visão geral

- **18 tabelas** no esquema `public`, acessadas apenas pelo backend (o navegador nunca grava nas tabelas).
- Identificadores UUID v4 (`gen_random_uuid()`), exceto `audit_logs.id` (`bigint GENERATED ALWAYS AS IDENTITY`).
- Instantes em `timestamptz` (UTC); filtros e agrupamentos usam `AT TIME ZONE 'America/Sao_Paulo'`.
- Tabelas de cadastro têm `created_at` e `updated_at`.
- 3FN, com instantâneos intencionais (textos e setor nas versões; setor, equipe e período nas respostas) protegidos por FKs compostas e gatilhos.
- FKs com `ON DELETE RESTRICT` e `ON UPDATE CASCADE`; `ON DELETE CASCADE` só em `profile_sectors` (perfil), `response_answers`, `manifestation_contacts` e `manifestation_notes`.
- RLS habilitado em todas as tabelas, **sem políticas**; privilégios de `anon` e `authenticated` revogados; Data API desligada.

## Diagrama entidade-relacionamento

O diagrama omite, como a Figura 3 do PDF, as FKs de autoria para `profiles` (`created_by`, `updated_by`, `published_by`, `cancelled_by`, `uploaded_by`, `committed_by`, `deactivated_by`, `author_id`, `actor_profile_id`); elas estão no dicionário abaixo.

```mermaid
erDiagram
  hospitals ||--o{ profiles : "possui"
  hospitals ||--o{ sectors : "possui"
  hospitals ||--o{ journey_stages : "define"
  profiles ||--o{ profile_sectors : "escopo"
  sectors ||--o{ profile_sectors : "escopo"
  sectors ||--o{ teams : "possui"
  sectors ||--o{ shifts : "possui"
  teams ||--o{ shifts : "cumpre (FK team_id+sector_id)"
  shift_imports ||--o{ shifts : "gera"
  sectors ||--o{ survey_configs : "possui"
  survey_configs ||--o{ questions : "possui"
  journey_stages ||--o{ questions : "agrupa"
  survey_configs ||--o{ survey_versions : "publica (FK survey_config_id+sector_id)"
  survey_configs |o--o| survey_versions : "versão vigente"
  survey_versions ||--o{ survey_version_questions : "instantâneo"
  questions ||--o{ survey_version_questions : "publicada como"
  survey_versions ||--o{ responses : "respondida (FK id+sector_id)"
  shifts |o--o{ responses : "atribuída"
  teams |o--o{ responses : "atribuída (FK team_id+sector_id)"
  responses ||--o{ response_answers : "notas 1–5 (FK id+survey_version_id)"
  survey_version_questions ||--o{ response_answers : "FK id+version+type"
  responses ||--o| manifestations : "no máximo uma (FK id+sector_id)"
  manifestations ||--o| manifestation_contacts : "contato voluntário"
  manifestations ||--o{ manifestation_notes : "linha do tempo"
  profiles |o--o{ audit_logs : "autor"
```

## Domínios (enums)

| Enum                       | Valores                                                                                       | Origem no PDF             |
| -------------------------- | --------------------------------------------------------------------------------------------- | ------------------------- |
| `user_role`                | `superadmin`, `sector_admin`, `management`, `ombudsman`, `viewer`                             | Tabela 12                 |
| `question_type`            | `nps`, `scale_1_5`                                                                            | Tabela 16                 |
| `response_origin`          | `qr_code`, `link`                                                                             | RN07, E02                 |
| `attribution_status`       | `attributed`, `not_qr_origin`, `no_shift`, `ambiguous`                                        | Tabela 16                 |
| `shift_period`             | `morning`, `afternoon`, `night`                                                               | RF19, filtros (Seção 4.3) |
| `shift_source`             | `manual`, `import`                                                                            | RF19, RF22–RF23 (\*)      |
| `import_status`            | `validated`, `rejected`, `committed`                                                          | RF22, E20, E21 (\*)       |
| `manifestation_type`       | `compliment`, `complaint`, `suggestion`                                                       | RF41, exemplo de E03 (\*) |
| `manifestation_status`     | `received`, `in_review`, `forwarded`, `resolved`, `archived`                                  | RF41, RN23 (\*)           |
| `manifestation_priority`   | `low`, `medium`, `high`                                                                       | RF46 (\*)                 |
| `manifestation_event_kind` | `created`, `status_changed`, `priority_changed`, `actions_updated`, `note`, `contact_deleted` | E03, E37, E38, E40 (\*)   |

(\*) O PDF nomeia o enum e descreve os estados, mas não lista os identificadores. Os valores foram derivados literalmente das regras citadas (por exemplo, `received` aparece em RF41; RN23 descreve "recebida, em análise, encaminhada, concluída e arquivada"; E40 cita os motivos `holder_request`, `return_completed` e `other`). A expiração da importação é dada por `expires_at`, sem estado próprio. Ver "Decisões" ao final.

## Dicionário de dados

Legenda: **PK** chave primária; **FK** chave estrangeira; **UQ** unicidade; **CK** CHECK; **TG** gatilho; **IX** índice. Colunas sem "(nulo)" são `NOT NULL`.

### 1. `hospitals`

| Coluna                    | Tipo           | Padrão              |
| ------------------------- | -------------- | ------------------- |
| `id`                      | uuid PK        | `gen_random_uuid()` |
| `name`                    | varchar(160)   |                     |
| `short_name`              | varchar(30)    |                     |
| `timezone`                | varchar(64)    | `America/Sao_Paulo` |
| `created_at`/`updated_at` | timestamptz(3) | `now()`             |

UQ `short_name`; CK nomes e fuso não vazios.

### 2. `profiles`

| Coluna                                             | Tipo                      | Observação                              |
| -------------------------------------------------- | ------------------------- | --------------------------------------- |
| `id`                                               | uuid PK                   |                                         |
| `hospital_id`                                      | uuid FK → hospitals       | RESTRICT                                |
| `auth_user_id`                                     | uuid                      | `auth.users.id` (sem FK entre esquemas) |
| `full_name`                                        | varchar(120)              |                                         |
| `email`                                            | varchar(254)              | minúsculas                              |
| `role`                                             | user_role                 |                                         |
| `all_sectors`, `is_active`, `must_change_password` | boolean                   | padrões false, true, true               |
| `deactivated_at`                                   | timestamptz (nulo)        |                                         |
| `deactivated_by`, `created_by`                     | uuid FK → profiles (nulo) | autoria, RESTRICT                       |
| `created_at`/`updated_at`                          | timestamptz               |                                         |

UQ `auth_user_id`, UQ `email`; CK `profiles_email_lowercase`, `profiles_email_format`, `profiles_scope_by_role` (SA sempre global; AS nunca global; GE/OU/VI livres — RN18), `profiles_active_coherence` (ativo ⇔ sem `deactivated_*`). "AS com ao menos um setor" é validado pela aplicação (RF06), pois envolve outra tabela.

### 3. `sectors`

`id`; `hospital_id` FK; `code` varchar(20); `name` varchar(120); `description` varchar(500) (nulo); `is_active`; `deactivated_at` (nulo); `created_at`/`updated_at`.
UQ (`hospital_id`, `code`); UQ de expressão (`hospital_id`, `lower(name)`); CK `sectors_code_format` (`^[A-Z0-9_-]{2,20}$`, RF12), `sectors_active_coherence`.

### 4. `profile_sectors`

`profile_id` FK → profiles (**CASCADE**); `sector_id` FK → sectors (RESTRICT); `created_by` FK (nulo); `created_at`. PK (`profile_id`, `sector_id`); IX `sector_id`.

### 5. `teams`

`id`; `sector_id` FK; `code` varchar(20); `name` varchar(120); `is_active`; `deactivated_at` (nulo); `created_at`/`updated_at`.
UQ (`sector_id`, `code`) e UQ (`id`, `sector_id`) — alvo das FKs compostas de `shifts` e `responses`; CK não vazios e coerência de `is_active`.

### 6. `shifts`

| Coluna                         | Tipo                           |
| ------------------------------ | ------------------------------ |
| `id`, `sector_id`, `team_id`   | uuid                           |
| `period`                       | shift_period                   |
| `starts_at`, `ends_at`         | timestamptz                    |
| `source`                       | shift_source                   |
| `import_id`                    | uuid FK → shift_imports (nulo) |
| `created_by`                   | uuid FK → profiles             |
| `cancelled_at`, `cancelled_by` | (nulo)                         |
| `cancel_reason`                | varchar(300) (nulo)            |
| `created_at`/`updated_at`      | timestamptz                    |

FK composta (`team_id`, `sector_id`) → `teams(id, sector_id)` (equipe do mesmo setor, RN20); CK `shifts_duration_1_to_24h`, `shifts_source_import_coherence` (`import` ⇔ `import_id`), `shifts_cancellation_coherence` (motivo de 5 a 300 caracteres); **EXCLUDE** `shifts_no_overlap_per_team` `USING gist (team_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE (cancelled_at IS NULL)`; IX (`sector_id`, `starts_at`, `ends_at`) e `import_id`. Turnos de equipes diferentes podem coincidir (é o que gera atribuição ambígua, RN07).

### 7. `shift_imports`

`id`; `uploaded_by` FK; `file_name` varchar(255); `file_sha256` char(64); `status` import_status; `total_rows`, `accepted_rows`, `rejected_rows` integer; `errors` jsonb (`[]`); `staged_rows` jsonb (`[]`); `expires_at`; `committed_at`, `committed_by` (nulo); `created_at`/`updated_at`.
CK `shift_imports_row_totals` (1 a 2.000 linhas; aceitas + rejeitadas = total — RN19), `shift_imports_status_coherence` (`validated` sem rejeitadas e sem confirmação; `rejected` com rejeitadas; `committed` sem rejeitadas, com `committed_at ≤ expires_at` e `committed_by`), `shift_imports_expiration_window` (até 30 min após `created_at`), `shift_imports_json_arrays`, `shift_imports_rejected_has_errors`, `shift_imports_file_sha256_format`.

### 8. `survey_configs`

`id`; `sector_id` FK; `title` varchar(120); `slug` varchar(80); `intro_text` varchar(500) (nulo); `thank_you_message` varchar(500); `is_active`; `deactivated_at` (nulo); `current_version_id` FK → survey_versions (nulo, UQ); `has_unpublished_changes`; `created_by` FK; `updated_by` FK (nulo); `created_at`/`updated_at`.
UQ `slug`; UQ (`id`, `sector_id`); CK `survey_configs_slug_kebab_case`; **TG** `survey_configs_guard`: a versão vigente pertence à própria pesquisa; slug e setor imutáveis após a primeira publicação (RN27).

### 9. `journey_stages`

`id`; `hospital_id` FK; `code` varchar(30); `name` varchar(80); `position` smallint; `is_active`; `created_at`/`updated_at`. UQ (`hospital_id`, `code`) e (`hospital_id`, `position`). O seed cria RECEPCAO, ATENDIMENTO, AMBIENTE e ALTA (Seção 4.3).

### 10. `questions`

`id`; `survey_config_id` FK; `journey_stage_id` FK (nulo); `type` question_type; `text` varchar(200); `is_required`; `position` smallint; `is_active`; `first_published_at` (nulo); `created_at`/`updated_at`.
CK `questions_type_required_stage` (`nps` ⇒ obrigatória e sem etapa; `scale_1_5` ⇒ opcional e com etapa — RN01, RN02), `questions_nps_always_active` (RF28); **UQ parcial** `questions_one_nps_per_survey_key` (`survey_config_id`) `WHERE type = 'nps'`; **TG** `questions_guard`: após `first_published_at`, texto, tipo e etapa ficam bloqueados (RN17); a pesquisa nunca muda.

### 11. `survey_versions`

`id`; `survey_config_id`, `sector_id` (instantâneo); `version_number` integer; `title`; `intro_text` (nulo); `thank_you_message`; `published_at`; `published_by` FK; `superseded_at` (nulo).
FK composta (`survey_config_id`, `sector_id`) → `survey_configs(id, sector_id)`; UQ (`survey_config_id`, `version_number`) e (`id`, `sector_id`); **TG** `survey_versions_immutable` (só `superseded_at`, de nulo para preenchido, uma vez) e `survey_versions_no_delete`.

### 12. `survey_version_questions`

`id`; `survey_version_id` FK; `question_id` FK; `type`; `text` varchar(200); `journey_stage_id` (nulo); `journey_stage_name` varchar(80) (nulo); `journey_stage_position` smallint (nulo); `position`; `is_required`.
UQ (`survey_version_id`, `question_id`), (`survey_version_id`, `position`) e (`id`, `survey_version_id`, `type`); **UQ parcial** uma `nps` por versão; CK tipo × obrigatoriedade × etapa e coerência do instantâneo da etapa; **TG** `svq_question_same_survey` (a pergunta é da mesma pesquisa e do mesmo tipo) e `svq_immutable` (sem UPDATE/DELETE).

### 13. `responses`

| Coluna                                 | Tipo                  |
| -------------------------------------- | --------------------- |
| `id`, `survey_version_id`, `sector_id` | uuid                  |
| `origin`                               | response_origin       |
| `nps_score`                            | smallint              |
| `low_score`                            | boolean               |
| `submitted_at`                         | timestamptz (`now()`) |
| `attribution_status`                   | attribution_status    |
| `shift_id`, `team_id`                  | uuid (nulo)           |
| `shift_period`                         | shift_period (nulo)   |
| `idempotency_key`                      | uuid (UQ)             |
| `request_hash`                         | char(64)              |
| `manifestation_token_expires_at`       | timestamptz           |
| `manifestation_token_used_at`          | timestamptz (nulo)    |

FK composta (`survey_version_id`, `sector_id`) → `survey_versions(id, sector_id)` (**setor da versão**, T32); FK `shift_id`; FK composta (`team_id`, `sector_id`) → `teams`; UQ (`id`, `survey_version_id`) e (`id`, `sector_id`) para as FKs compostas filhas.
CK `responses_nps_score_range`, `responses_low_score_coherence` (NPS ≤ 6 ⇒ nota baixa), `responses_origin_attribution` (`link` ⇔ `not_qr_origin`), `responses_attribution_fields` (`attributed` ⇔ turno, equipe e período preenchidos), `responses_manifestation_token_window` (validade ≤ 60 min; uso dentro da validade — RN22), `responses_request_hash_format`.
**TG** `responses_shift_coherence` (na inserção: turno do mesmo setor, mesma equipe e período, não cancelado, contendo `submitted_at`, equipe ativa; resposta não anterior à publicação da versão) e `responses_immutable` (só `manifestation_token_used_at`, uma vez).
IX `submitted_at`; (`sector_id`, `submitted_at`); **parciais** (`team_id`, `submitted_at`) `WHERE team_id IS NOT NULL`, (`shift_period`, `submitted_at`) `WHERE shift_period IS NOT NULL`, `shift_id` `WHERE shift_id IS NOT NULL`; `survey_version_id`.

### 14. `response_answers`

`id`; `response_id`; `survey_version_id`; `survey_version_question_id`; `question_type`; `score` smallint.
FK composta (`response_id`, `survey_version_id`) → `responses(id, survey_version_id)` **CASCADE**; FK composta (`survey_version_question_id`, `survey_version_id`, `question_type`) → `survey_version_questions(id, survey_version_id, type)` — **a pergunta pertence à versão da resposta** (T32); UQ (`response_id`, `survey_version_question_id`); CK `response_answers_specific_only` e `response_answers_score_range` (1–5); **TG** `response_answers_immutable`.

### 15. `manifestations`

| Coluna                              | Tipo                                                |
| ----------------------------------- | --------------------------------------------------- |
| `id`                                | uuid                                                |
| `protocol`                          | varchar(15), padrão `next_manifestation_protocol()` |
| `response_id`, `sector_id`          | uuid                                                |
| `type`                              | manifestation_type                                  |
| `description`                       | text                                                |
| `is_anonymous`                      | boolean (padrão true — RN12)                        |
| `triggered_by_low_score`            | boolean                                             |
| `status`, `priority`                | enums (padrões `received`, `medium`)                |
| `actions_taken`                     | text (nulo)                                         |
| `received_at`, `resolved_at` (nulo) | timestamptz                                         |
| `updated_by`                        | uuid FK (nulo)                                      |
| `idempotency_key`                   | uuid (UQ)                                           |
| `request_hash`                      | char(64)                                            |
| `created_at`/`updated_at`           | timestamptz (`updated_at` para concorrência — RF46) |

UQ `protocol`, `response_id` (uma por resposta — RN22) e `idempotency_key`; FK composta (`response_id`, `sector_id`) → `responses(id, sector_id)`; CK `manifestations_protocol_format`, `manifestations_description_length` (10 a 2.000), `manifestations_resolution_coherence` (`resolved` ⇔ `resolved_at`, com providências de 10+ caracteres — RN23), `manifestations_resolved_after_received`; **TG** `manifestations_registration_immutable` (só status, prioridade, providências, `resolved_at`, `updated_by` e `updated_at` mudam); IX por status, setor, tipo, prioridade e data.

### 16. `manifestation_contacts`

`manifestation_id` (PK = FK **CASCADE**); `full_name` varchar(120); `phone` varchar(11) (nulo); `email` varchar(254) (nulo); `consent_given_at`; `purpose_text_version` varchar(10); `created_at`.
CK telefone ou e-mail, formatos (telefone com 10 ou 11 dígitos; e-mail), nome e versão da finalidade não vazios; **TG** `manifestation_contacts_not_anonymous` — **nenhum contato em manifestação anônima** (RN12, T32). Tabela segregada: nenhuma consulta analítica ou de relatório a lê.

### 17. `manifestation_notes`

`id`; `manifestation_id` FK **CASCADE**; `author_id` FK (nulo); `kind` manifestation_event_kind; `content` text (nulo); `from_value`, `to_value` varchar(30) (nulo); `created_at`.
CK `manifestation_notes_kind_rules` por tipo: `created` (sem autor, `to_value = 'received'`), `status_changed` e `priority_changed` (autor, de/para válidos e diferentes), `actions_updated` (autor e conteúdo), `note` (autor, 1 a 2.000 caracteres), `contact_deleted` (autor, motivo `holder_request`/`return_completed`/`other`); **TG** `manifestation_notes_no_update` e `manifestation_notes_no_direct_delete` (exclusão só em cascata, na manutenção de retenção).

### 18. `audit_logs`

`id` bigint identidade; `occurred_at`; `actor_profile_id` FK (nulo); `actor_role` user_role (nulo); `action` varchar(60); `entity_type` varchar(40); `entity_id` varchar(64) (nulo); `sector_id` FK (nulo); `details` jsonb (`{}`); `request_id` uuid (nulo); `ip_hash` char(64) (nulo).
CK `details` objeto JSON e `ip_hash` hexadecimal (HMAC, nunca o IP); **TG** `audit_logs_insert_only` (UPDATE/DELETE) e `audit_logs_no_truncate`; IX por data, autor, entidade, ação e setor.

## Objetos auxiliares

| Objeto                                     | Função                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Extensão `btree_gist`                      | igualdade de `uuid` na restrição de exclusão de turnos                                                                                                                                                                                                                                                             |
| Sequência `manifestation_protocol_seq`     | número NNNNNN do protocolo (1 a 999.999, sem ciclo)                                                                                                                                                                                                                                                                |
| Função `next_manifestation_protocol(p_at)` | `FHD-` + ano local de `p_at` + `-` + NNNNNN (Seção 4.3)                                                                                                                                                                                                                                                            |
| Funções de gatilho                         | `reject_immutable_change`, `survey_configs_guard`, `questions_guard`, `survey_versions_guard_update`, `survey_version_questions_check_insert`, `responses_check_insert`, `responses_guard_update`, `manifestations_guard_update`, `manifestation_contacts_check_not_anonymous`, `manifestation_notes_guard_delete` |

Todas as violações de gatilho usam SQLSTATE `23000` e informam o nome da regra no campo `constraint` do erro.

## Decisões de modelagem tomadas na ET02 (lacunas do PDF)

1. **Valores de enums não listados no PDF** — derivados das regras citadas na tabela de domínios; nenhum estado novo foi criado.
2. **`shift_imports` sem estado `expired`** — a expiração é calculada por `expires_at` (RN19); a confirmação após o prazo é barrada por `committed_at ≤ expires_at`.
3. **Imutabilidade de respostas** — bloqueia UPDATE (exceto o uso único do token, necessário para RN22) e mantém DELETE possível apenas para a manutenção de retenção prevista na Seção 10 (ordem contatos → manifestações → respostas → auditoria). A aplicação nunca exclui (RN11). Em `audit_logs`, a exclusão por manutenção exige desabilitar explicitamente o gatilho como dono da tabela.
4. **`low_score` com NPS 7–10** — o CHECK garante só a parte decidível na própria linha (NPS ≤ 6 ⇒ nota baixa); a parte "específica 1 ou 2" é calculada pelo backend (e conferida no seed por `db:seed:verify`).
5. **Escopo "AS com ao menos um setor"** — envolve `profile_sectors`; fica na aplicação (RF06/RF08), não em CHECK.
6. **Nome do hospital no seed** — "Hospital Fictício de Demonstração", sem dados reais da instituição.
7. **`profiles.auth_user_id` sem FK para `auth.users`** — o esquema `auth` é do Supabase e não existe no PostgreSQL da CI.
8. **Relação resposta → manifestação no Prisma** — declarada como lista (`manifestations`), porque a FK é composta; a unicidade (no máximo uma) é garantida por `manifestations_response_id_key`.
