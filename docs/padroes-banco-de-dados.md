# Padrões de banco de dados (D06)

Como o banco do FHDOD é criado, alterado, populado e testado desde a **Etapa 3** (MySQL). Modelo e dicionário: [`modelo-de-dados.md`](modelo-de-dados.md). Mapeamento e consultas: [`mapeamento-classes-e-consultas.md`](mapeamento-classes-e-consultas.md). Passo a passo do MySQL Workbench: [`database/README.md`](../database/README.md).

> Até a Etapa 2 o banco era PostgreSQL 17 (Supabase) gerenciado pelo Prisma 7, com 5 migrations Prisma, RLS e Supabase Auth. Esse histórico permanece nas evidências da ET02 e da ET03 (`docs/evidencias/`); nada abaixo depende mais dessas tecnologias.

## Pilha e versões

| Item             | Versão / configuração                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| MySQL            | **8.4 LTS** (CI: imagem `mysql:8.4`); 8.0.16+ também atende (CHECK aplicado, índices funcionais)  |
| Driver           | `mysql2` 3 (API `mysql2/promise`), pool de conexões; **sem ORM**                                  |
| SQL da aplicação | template `sql` (`src/lib/sql.ts`): todo valor vira parâmetro `?` escapado pelo driver             |
| Migrations       | arquivos SQL versionados em `database/migrations/`, executor próprio (`scripts/db/migrations.ts`) |
| Administração    | MySQL Workbench (importação de `database/schema.sql`, Table Inspector, Reverse Engineer)          |
| Seed             | `@faker-js/faker` 10 (`fakerPT_BR`, `faker.seed(2026)`), `scripts/db/seed.ts` executado com `tsx` |

## Convenções

- Tabelas no plural e colunas em `snake_case`; o TypeScript usa `camelCase` (os repositórios convertem).
- Charset `utf8mb4`, collation **`utf8mb4_0900_as_cs`** (diferencia maiúsculas e acentos); buscas sem distinção de caixa usam `LOWER()` explicitamente.
- `CHAR(36)` para UUIDs (gerados pela API com `randomUUID()`; `DEFAULT (UUID())` para inserções manuais), sempre em minúsculas — a validação da API normaliza os UUIDs recebidos.
- `DATETIME(3)` em **UTC** para todos os instantes; a sessão da API usa `time_zone = '+00:00'` e o driver `timezone: 'Z'`.
- `ENUM` para os domínios da Tabela 16, `BOOLEAN` (TINYINT(1), convertido para `boolean` pelo driver) e `JSON` para listas e detalhes.
- Nomes de restrição explícitos e estáveis: `<tabela>_<colunas>_key` (UNIQUE), `<tabela>_<colunas>_fkey` (FK), `<tabela>_<regra>` (CHECK); gatilhos com `SIGNAL` cuja mensagem começa por `[nome_da_regra]`.
- Nenhuma exclusão física pela aplicação: desativação lógica (`is_active`, `deactivated_at`) e cancelamento (`cancelled_at`).
- Escritas múltiplas em `db.transaction(...)` (READ COMMITTED; nova tentativa automática em deadlock), com a auditoria na mesma transação (RN16).
- SQL somente em `*.repository.ts`, sempre pelo template `sql`; o ESLint proíbe, em `src/`, SQL interpolado com template literal em `query`/`execute` (RNF11).

## Conexões e variáveis

| Variável                    | Uso                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| `DB_HOST`, `DB_PORT`        | servidor (padrão `localhost:3306`)                                                                  |
| `DB_USER`, `DB_PASSWORD`    | credenciais; em produção, o usuário de privilégio mínimo `fhdod_app`                                |
| `DB_NAME`                   | banco (padrão `fhdod`)                                                                              |
| `DB_CONNECTION_LIMIT`       | tamanho do pool (padrão 10)                                                                         |
| `DB_SSL`, `DB_SSL_CA`       | TLS (obrigatório na nuvem; verificação do certificado ligada; CA opcional em PEM)                   |
| `TEST_DB_NAME`, `TEST_DB_*` | banco dos testes (padrão `fhdod_test`; cada `TEST_DB_*` vazia usa a `DB_*`); somente servidor local |
| `SEED_DEMO_PASSWORD`        | senha das contas de demonstração (RN28), gravada só como hash bcrypt                                |
| `SEED_ALLOW_REMOTE`         | `false` por padrão; o seed recusa servidor remoto sem `true` explícito                              |
| `SEED_REFERENCE_DATE`       | opcional (AAAA-MM-DD): reproduz exatamente o mesmo conjunto                                         |

Valores de exemplo em [`.env.example`](../.env.example). O `.env` real nunca é versionado. Banco indisponível (conexão recusada, acesso negado, banco inexistente, conexão perdida) → 503 `SERVICE_UNAVAILABLE`, inclusive em `GET /api/v1/health`.

## Scripts

Executados na raiz com `npm run <script>`:

| Script              | O que faz                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `db:create`         | cria `DB_NAME` com a collation correta, se não existir (nunca apaga)                               |
| `db:migrate`        | aplica as migrations pendentes e as registra em `schema_migrations` (versão, nome, SHA-256)        |
| `db:migrate:status` | lista aplicadas e pendentes; falha se uma migration aplicada foi alterada (checksum) ou sumiu      |
| `db:migration:new`  | `-- nome` cria `database/migrations/NNN_nome.sql` com o próximo número                             |
| `db:schema`         | regenera `database/schema.sql` (todas as migrations + registro em `schema_migrations`)             |
| `db:schema:check`   | falha se `schema.sql` estiver desatualizado (CI e `npm run check`)                                 |
| `db:seed`           | seed de demonstração numa única transação (recusa banco com outros dados e servidor remoto)        |
| `db:seed:export`    | gera `database/seeds/gerado/002_demonstracao.sql` (importável no Workbench; não versionado)        |
| `db:seed:verify`    | contagens, coerência e impressão digital md5 por tabela (somente leitura)                          |
| `db:reset`          | **somente local**: apaga e recria `DB_NAME`, migra e roda o seed                                   |
| `db:create-admin`   | primeiro superadministrador de uma instalação real (`ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD`) |
| `test:db`           | testes com MySQL real (`tests/db`)                                                                 |

## Migrations

| Migration                         | Conteúdo                                                                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `001_tabelas.sql`                 | 20 tabelas com colunas, tipos, padrões e PKs; colunas geradas da unicidade "uma pergunta geral"; linha única do contador do protocolo  |
| `002_chaves_unicas_e_indices.sql` | UNIQUE (inclusive alvos das FKs compostas e o índice funcional `LOWER(name)`) e índices de consulta                                    |
| `003_relacionamentos.sql`         | 42 FKs (simples e compostas), `RESTRICT` por padrão e `CASCADE` só nas dependências subordinadas                                       |
| `004_restricoes.sql`              | 75 CHECK (domínios, formatos com `REGEXP_LIKE(..., 'c')`, coerência de status, janelas de tempo, hash bcrypt)                          |
| `005_gatilhos.sql`                | 21 gatilhos: sobreposição de turnos, imutabilidade (versões, respostas, notas, auditoria), coerência, anonimato do contato e protocolo |

Regras:

1. Todo o esquema vem das migrations; nada é criado só pelo Workbench em ambientes compartilhados.
2. **Migration aplicada não é editada** (o checksum diverge e `db:migrate` para). Correção = nova migration.
3. Os arquivos usam `DELIMITER $$` nos gatilhos e funcionam tanto no Workbench quanto no executor da API (que entende `DELIMITER`, comentários e strings).
4. DDL no MySQL confirma a transação implicitamente: cada migration só é registrada depois de executada por inteiro; se falhar no meio, corrija manualmente antes de repetir. Faça backup antes de migrar dados reais.
5. Depois de criar uma migration: `npm run db:migrate`, `npm test` e `npm run db:schema`; versione a migration e o `schema.sql` juntos.
6. **Nenhuma migration é aplicada num banco remoto sem autorização do responsável.**

## Recursos do PostgreSQL e como ficaram no MySQL

| Recurso no modelo anterior                           | No MySQL 8.4                                                                                                         |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 11 `ENUM` de tipo                                    | `ENUM` por coluna (mesmos valores e ordem; ordenação por posição preservada)                                         |
| `uuid` com `gen_random_uuid()`                       | `CHAR(36)` com `DEFAULT (UUID())`; a API gera UUID v4                                                                |
| `timestamptz(3)`                                     | `DATETIME(3)` em UTC                                                                                                 |
| `jsonb`                                              | `JSON` (CHECK com `JSON_TYPE`)                                                                                       |
| índice único parcial (`WHERE type = 'nps'`)          | coluna gerada (`nps_survey_config_id`/`nps_survey_version_id`) com UNIQUE (NULL não conflita)                        |
| índice único de expressão `lower(name)`              | índice funcional `(hospital_id, (LOWER(name)))`                                                                      |
| `EXCLUDE USING gist` (turnos sobrepostos)            | gatilhos `shifts_before_insert/update` (bloqueiam a equipe e procuram sobreposição com leitura bloqueante)           |
| `SEQUENCE` + função do protocolo                     | tabela `manifestation_protocol_sequence` + gatilho `manifestations_before_insert` (ano em UTC−3)                     |
| funções PL/pgSQL nos gatilhos                        | corpo dos gatilhos em SQL do MySQL, `SIGNAL SQLSTATE '45000'` com `[regra]` na mensagem                              |
| gatilho de `TRUNCATE` em `audit_logs`                | inexistente no MySQL: o usuário da API não tem `DROP` (necessário para `TRUNCATE`)                                   |
| exclusão de notas só em cascata (`pg_trigger_depth`) | gatilho recusa toda exclusão direta; a cascata da FK não dispara gatilhos no MySQL                                   |
| `ON UPDATE CASCADE`                                  | `ON UPDATE RESTRICT` (as chaves são UUIDs imutáveis; o MySQL não permite ação em cascata em colunas usadas em CHECK) |
| RLS e REVOKE de `anon`/`authenticated`               | não se aplica (sem acesso direto do navegador); privilégio mínimo em `database/seguranca/usuarios.sql`               |
| `audit_logs.id` `GENERATED ALWAYS AS IDENTITY`       | `BIGINT UNSIGNED AUTO_INCREMENT`                                                                                     |

## Seed determinístico de demonstração

Arquivo: [`scripts/db/seed.ts`](../scripts/db/seed.ts). Somente dados fictícios: hospital `FHDOD-DEMO`, 6 setores, 18 equipes, 4 etapas, 6 pesquisas (PA com v1 e v2), 2.765 turnos (12 cancelados), 2.400 respostas (~9.330 notas específicas), 180 manifestações, 72 contatos e 6 usuários `@example.com`.

- **Determinismo:** `faker.seed(2026)`, IDs explícitos e instantes fixos; com a mesma `SEED_REFERENCE_DATE` o resultado é idêntico (impressão digital md5 por tabela). Gravar direto (`db:seed`) e importar o arquivo exportado (`db:seed:export`) produzem as mesmas impressões digitais (verificado em 05/11/2026). O hash bcrypt das senhas usa sal aleatório e fica fora da impressão digital.
- **Gravação:** comandos `INSERT` parametrizados em lotes, numa única transação, na ordem das FKs; os protocolos são gerados pelo gatilho, em ordem cronológica.
- **Idempotência e segurança:** se `FHDOD-DEMO` existe, nada é gravado; outros dados → erro; servidor remoto recusado sem `SEED_ALLOW_REMOTE=true`.
- **Dados base de produção:** `database/seeds/001_dados_base.sql` (hospital FHDOD e etapas, idempotente) + `npm run db:create-admin`.

## Segurança no banco

- A API é o único cliente do banco; não há acesso direto pelo navegador.
- Privilégio mínimo (`database/seguranca/usuarios.sql`): `fhdod_app` (SELECT, INSERT, UPDATE, DELETE) para a API e `fhdod_migracao` (DDL e gatilhos) para as migrations.
- Senhas apenas como hash bcrypt (CHECK `profiles_password_hash_bcrypt`); tokens de renovação apenas como SHA-256; IPs apenas como HMAC.
- Na nuvem, `DB_SSL=true` (TLS 1.2+ com verificação do certificado).

## Erros do banco para a API

| Erro do MySQL (`code`, `errno`)                                 | Origem                                         | Tratamento na API                                |
| --------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------ |
| `ER_DUP_ENTRY` (1062)                                           | UNIQUE (slug, código, e-mail, idempotência)    | 409 `CONFLICT` / reenvio idempotente             |
| `ER_SIGNAL_EXCEPTION` (1644)                                    | gatilhos (`[shifts_no_overlap_per_team]` etc.) | 409 `SHIFT_OVERLAP`; 422 conforme a regra        |
| `ER_NO_REFERENCED_ROW_2` / `ER_ROW_IS_REFERENCED_2` (1452/1451) | FK (inclusive compostas)                       | 400/422 conforme o endpoint (a API valida antes) |
| `ER_CHECK_CONSTRAINT_VIOLATED` (3819)                           | CHECK                                          | 400 `VALIDATION_ERROR` (a API valida antes)      |
| conexão recusada/perdida, acesso negado, banco inexistente      | indisponibilidade                              | 503 `SERVICE_UNAVAILABLE`                        |
| `ER_LOCK_DEADLOCK` (1213)                                       | deadlock                                       | transação repetida automaticamente (até 2 vezes) |

Reconhecimento: `isUniqueViolation`, `isConstraintViolation` (`src/utils/errors.ts`) e `isDatabaseUnavailable` (`src/lib/database.ts`).

## Testes de banco

`npm test` executa `unidade-e-integracao` (sem banco) e `banco` (MySQL real). O `global-setup` exige servidor **local** e `TEST_DB_NAME` diferente de `DB_NAME`, **recria** o banco de testes e aplica as migrations com o mesmo executor da CLI. Os testes de regras rodam em transações desfeitas (ROLLBACK); os de API usam um hospital exclusivo por cenário. Inclui o **T32**, as verificações de estrutura (ENUM, tipos, FKs, collation), CHECK, chaves únicas, gatilhos, privilégios do usuário da aplicação e a camada de acesso (`health-mysql.test.ts`: tipos, parametrização, transações e erros). Resultados: [`plano-e-relatorio-de-testes.md`](plano-e-relatorio-de-testes.md).

## Backup e retenção

Backup: `mysqldump --single-transaction --routines --triggers fhdod > backup.sql` ou **Server → Data Export** no Workbench (scripts automatizados previstos para etapa posterior). A estrutura permite excluir na ordem contatos → manifestações → respostas sem violar FKs; a auditoria só pode ser removida por manutenção explícita de um administrador (remoção temporária do gatilho).
