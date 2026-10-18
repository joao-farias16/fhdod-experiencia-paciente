# Padrões de banco de dados (D06) — ET02

Como o banco do FHDOD é criado, alterado, populado e testado. Modelo e dicionário: [`modelo-de-dados.md`](modelo-de-dados.md). Mapeamento e consultas: [`mapeamento-classes-e-consultas.md`](mapeamento-classes-e-consultas.md).

## Pilha e versões

| Item                | Versão / configuração                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| PostgreSQL          | 17 (Supabase CLI local: imagem `supabase/postgres:17.11.0.004`; CI: `postgres:17`)                          |
| Prisma CLI e Client | 7.10.1 (`prisma`, `@prisma/client`), gerador `prisma-client` (ESM, saída em `backend/src/generated/prisma`) |
| Adaptador do driver | `@prisma/adapter-pg` 7.10.1 + `pg` 8 (o Prisma 7 conecta por adaptador)                                     |
| Recurso em prévia   | `previewFeatures = ["partialIndexes"]` (índices parciais com `where: raw(...)`)                             |
| Seed                | `@faker-js/faker` 10 (`fakerPT_BR`, `faker.seed(2026)`), executado com `tsx`                                |
| Banco local         | Supabase CLI 2.121.0 (devDependency da raiz), Docker                                                        |

O Prisma Client é gerado no `npm ci` (script `postinstall` do backend) e **não é versionado** (`backend/src/generated/` está no `.gitignore`, no ESLint e no Prettier).

## Convenções

- Banco em `snake_case` (tabelas no plural); TypeScript em `camelCase` (`@map`/`@@map` no `schema.prisma`).
- Nomes de restrição explícitos e estáveis: `<tabela>_<colunas>_key` (UQ), `<tabela>_<colunas>_fkey` (FK), `<tabela>_<regra>` (CHECK/EXCLUDE) e o nome do gatilho igual à regra.
- `uuid` com `gen_random_uuid()`; `timestamptz(3)` em UTC; textos com `varchar(n)` do PDF.
- Nenhuma exclusão física pela aplicação: desativação lógica (`is_active`, `deactivated_at`) e cancelamento (`cancelled_at`).
- Consultas com `$queryRaw` parametrizado; `$queryRawUnsafe`/`$executeRawUnsafe` proibidos pelo ESLint (RNF11).
- Escritas múltiplas em transação Prisma, com auditoria na mesma transação (RN16) — a partir da ET03.

## Conexões e variáveis (Tabela 15)

| Variável                              | Uso                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                        | API (Prisma Client com `@prisma/adapter-pg`). Nuvem: pooler em **modo transação**, porta **6543**. Validada com Zod na inicialização. |
| `DIRECT_URL`                          | Prisma CLI (`prisma.config.ts`): migrations. Nuvem: pooler em **modo sessão**, porta **5432**.                                        |
| `TEST_DATABASE_URL`                   | testes de integração; precisa ser **local**; o banco é criado e migrado pelos testes.                                                 |
| `SEED_DEMO_PASSWORD`                  | senha das contas de demonstração no Supabase Auth local (RN28: 10+ caracteres, letras e números).                                     |
| `SEED_ALLOW_REMOTE`                   | `false` por padrão; o seed recusa banco/Supabase remotos sem `true` explícito.                                                        |
| `SEED_REFERENCE_DATE`                 | opcional (AAAA-MM-DD): fixa a data de referência para reproduzir exatamente o mesmo conjunto.                                         |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | usadas pelo seed para criar as contas de demonstração; vazias ⇒ perfis sem conta no Auth.                                             |

Valores locais estão em [`backend/.env.example`](../backend/.env.example). O `.env` real nunca é versionado.

## Ambiente local (Supabase CLI)

```bash
npm ci                 # instala tudo e gera o Prisma Client
npm run db:start       # npx supabase start — PostgreSQL 54322, gateway/Auth 54321, Studio 54323
cp backend/.env.example backend/.env   # e preencha SUPABASE_SECRET_KEY com `npx supabase status -o env`
npm run db:migrate     # aplica as migrations (prisma migrate dev)
npm run db:seed        # seed determinístico
npm run db:seed:verify -w backend      # confere as contagens no banco
npm run db:stop        # para os contêineres (os dados ficam no volume)
```

[`supabase/config.toml`](../supabase/config.toml) (versionado):

- `[api] enabled = false` — **Data API (PostgREST) desligada**; o banco só é acessado pelo backend.
- `auto_expose_new_tables = false` — objetos novos não ficam expostos a `anon`/`authenticated` sem GRANT.
- `[db.migrations]` e `[db.seed]` desligados — o esquema vem **somente** das migrations do Prisma (uma única fonte de verdade).
- `[auth] enable_signup = false` — sem cadastro público (Seção 2, d); senha mínima de 10 caracteres com letras e números (RN28).
- `[auth.email] enable_signup = true` — no CLI essa chave liga o **provedor de e-mail** (login por e-mail e senha); desligá-la bloqueia o login (`email_provider_disabled`), por isso permanece `true`.
- Realtime, Storage, Edge Functions e Analytics desligados (não usados).

## Scripts

| Raiz                 | Backend (`-w backend`) | Comando                                                                                     |
| -------------------- | ---------------------- | ------------------------------------------------------------------------------------------- |
| `npm run db:start`   | —                      | `supabase start`                                                                            |
| `npm run db:stop`    | —                      | `supabase stop`                                                                             |
| —                    | `db:generate`          | `prisma generate` (também no `postinstall`)                                                 |
| —                    | `db:validate`          | `prisma validate`                                                                           |
| —                    | `db:format`            | `prisma format`                                                                             |
| `npm run db:migrate` | `db:migrate`           | `prisma migrate dev` (desenvolvimento)                                                      |
| —                    | `db:migrate:create`    | `prisma migrate dev --create-only` (migration para editar)                                  |
| `npm run db:deploy`  | `db:deploy`            | `prisma migrate deploy` (CI e publicação)                                                   |
| —                    | `db:status`            | `prisma migrate status`                                                                     |
| —                    | `db:diff`              | `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` |
| `npm run db:seed`    | `db:seed`              | `tsx prisma/seed.ts`                                                                        |
| —                    | `db:seed:verify`       | contagens e relações por consulta ao banco (somente leitura)                                |
| `npm run db:reset`   | `db:reset`             | **somente local**: `prisma migrate reset --force` + seed                                    |
| —                    | `test:db`              | testes com PostgreSQL real (`tests/db`)                                                     |

## Migrations

| Migration                                         | Tipo                                 | Conteúdo                                                                                                                                                                                  |
| ------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261017230000_extensoes_e_protocolo`            | SQL manual                           | `btree_gist` (em `extensions` no Supabase, em `public` no PostgreSQL comum); sequência e função do protocolo (precisam existir antes da tabela `manifestations`, que as usa como DEFAULT) |
| `20261017233719_esquema_inicial`                  | gerada pelo Prisma (`--create-only`) | 11 enums, 18 tabelas, PKs, FKs (inclusive compostas), UQs e índices (inclusive parciais)                                                                                                  |
| `20261017233735_restricoes_integridade`           | `--create-only` + SQL manual         | CHECKs, índice único de expressão `lower(name)`, `EXCLUDE` de turnos e conversão de `audit_logs.id` de `BIGSERIAL` para `GENERATED ALWAYS AS IDENTITY`                                    |
| `20261017233800_gatilhos_imutabilidade_coerencia` | SQL manual                           | funções e gatilhos de imutabilidade, coerência e anonimato                                                                                                                                |
| `20261017233900_seguranca_rls_privilegios`        | SQL manual                           | RLS em todas as tabelas (sem políticas), REVOKE de `anon`/`authenticated` com verificação de existência dos papéis e EXECUTE das funções restrito ao dono                                 |

Regras:

1. Todo o esquema vem das migrations; nada é feito só no painel do Supabase.
2. **Migration aplicada não é editada.** Correção = nova migration (por exemplo, a identidade de `audit_logs.id` foi feita na migration 3, sem alterar a 2).
3. Para SQL que o Prisma não gera: `npm run db:migrate:create -w backend -- --name <nome>`, editar o `migration.sql` gerado e aplicar com `npm run db:migrate`.
4. Antes do PR: `npm run db:validate`, aplicar em banco vazio e `npm run db:diff` (deve sair com código 0 — "No difference detected").
5. Publicação usa somente `prisma migrate deploy` (Tabela 26). **Nenhuma migration é aplicada no Supabase remoto sem autorização do responsável.**

### Limitações do Prisma e onde cada regra está

| Recurso                                               | Representado no `schema.prisma`?     | Onde está                         |
| ----------------------------------------------------- | ------------------------------------ | --------------------------------- |
| Enums, PK, FK simples e compostas, UQ, índices        | sim                                  | migration 2                       |
| Índices únicos/parciais (`WHERE`)                     | sim, com `partialIndexes` (prévia)   | migration 2                       |
| `ON DELETE CASCADE/RESTRICT`, `ON UPDATE CASCADE`     | sim (`onDelete`/`onUpdate`)          | migration 2                       |
| `CHECK`                                               | não                                  | migration 3                       |
| Índice de expressão (`lower(name)`)                   | não                                  | migration 3                       |
| `EXCLUDE USING gist`                                  | não                                  | migration 3 (+ `btree_gist` na 1) |
| Coluna de identidade (`GENERATED ALWAYS AS IDENTITY`) | não (gera `BIGSERIAL`)               | migration 3                       |
| Gatilhos e funções                                    | não                                  | migrations 1 e 4                  |
| Sequência do protocolo                                | não (só o DEFAULT via `dbgenerated`) | migration 1                       |
| RLS, GRANT/REVOKE                                     | não                                  | migration 5                       |

O `prisma migrate diff` ignora o que o schema não representa; por isso ele confirma a parte estrutural e os **testes de banco** (`tests/db`) confirmam CHECKs, EXCLUDE, gatilhos, RLS e privilégios. Relação resposta → manifestação: como a FK é composta, o Prisma exige lista (`Response.manifestations`); a unicidade fica na UQ `response_id`.

## Seed determinístico

Arquivo: [`backend/prisma/seed.ts`](../backend/prisma/seed.ts). Somente dados fictícios.

| Conjunto          | Quantidade | Regra                                                                                                                                                                 |
| ----------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hospital          | 1          | "Hospital Fictício de Demonstração" (`FHDOD-DEMO`)                                                                                                                    |
| Setores           | 6          | PA, INTERNACAO, UTI, MATERNIDADE, AMBULATORIO, IMAGEM (nomes genéricos)                                                                                               |
| Equipes           | 18         | 3 por setor (`EQUIPE-A/B/C`)                                                                                                                                          |
| Etapas da jornada | 4          | RECEPCAO, ATENDIMENTO, AMBIENTE, ALTA (Seção 4.3)                                                                                                                     |
| Pesquisas         | 6          | uma por setor; a do PA com v1 e v2 (v2 troca a pergunta de espera pela de conforto)                                                                                   |
| Turnos            | 2.764      | 150 dias (120 passados + 30 futuros) × 3 períodos × 6 setores + 64 reforços do PA (seg/qua/sex, 10–16 h, equipe de folga); 12 turnos passados cancelados (com motivo) |
| Respostas         | 2.400      | 120 dias anteriores à data de referência; 70% QR Code; atribuição calculada pela RN07 (ambíguas só no PA)                                                             |
| Notas específicas | 9.350      | ~65% das perguntas respondidas, correlacionadas com o NPS                                                                                                             |
| Manifestações     | 180        | 130 de respostas com nota baixa + 50 sem nota baixa; linha do tempo coerente com a RN23                                                                               |
| Contatos          | 72 (40%)   | "Contato Fictício NNN", telefones `5190000NNNN`, e-mails `@example.com` (Seção 10)                                                                                    |
| Usuários          | 6          | `@example.com`: SA, AS (PA e Ambulatório), GE global, GE por setores, OU, VI                                                                                          |

- **Determinismo:** `faker.seed(2026)`, `fakerPT_BR`, IDs explícitos e `created_at`/`updated_at` fixos. Com a mesma `SEED_REFERENCE_DATE` e banco recém-migrado, o resultado é idêntico (verificado por impressão digital md5 por tabela — inclusive entre Supabase local e PostgreSQL 17 puro).
- **Ordem de gravação:** hospital → etapas → setores → perfis → escopos → equipes → pesquisas → perguntas → versões → perguntas das versões → versão vigente → turnos → respostas → notas → manifestações (protocolo pela função do banco) → contatos → linha do tempo; tudo numa **única transação**.
- **Idempotência:** se o hospital `FHDOD-DEMO` já existe, nada é gravado ("Seed já aplicado"). Se houver outros dados, o seed para com erro.
- **Reinicialização:** `npm run db:reset` (somente local) — confere que `DATABASE_URL` e `DIRECT_URL` são locais, executa `prisma migrate reset --force` e o seed.
- **Segurança:** recusa `DATABASE_URL`/`SUPABASE_URL` remotos sem `SEED_ALLOW_REMOTE=true`; a senha vem de `SEED_DEMO_PASSWORD`; as contas são criadas pela API de administração do Supabase Auth **local** (idempotente: reaproveita a conta existente).
- **Verificação:** `npm run db:seed:verify -w backend` executa as consultas de contagem e coerência e termina com código 1 se algo divergir. Resultados reais em [`evidencias/ET02/`](evidencias/ET02/).

## Segurança no banco

- RLS habilitado nas 18 tabelas e em `_prisma_migrations`, **sem políticas**: qualquer papel que não seja o dono (backend) não lê nem grava.
- `anon` e `authenticated` sem privilégios em tabelas, sequências e funções (inclusive para objetos futuros, via `ALTER DEFAULT PRIVILEGES`); EXECUTE das funções do projeto revogado de `PUBLIC`.
- Funções com `SET search_path = ''` e nomes qualificados (`public.`).
- A **Data API do projeto remoto** deve ser desligada no painel do Supabase (Settings → API) pelo responsável; a ET02 não altera o projeto remoto.

## Erros do banco para a API (referência para as próximas etapas)

| SQLSTATE | Origem                                     | Tratamento sugerido na API                                     |
| -------- | ------------------------------------------ | -------------------------------------------------------------- |
| `23505`  | UQ (slug, código, idempotência, protocolo) | 409 `CONFLICT` / `IDEMPOTENCY_KEY_REUSED`                      |
| `23P01`  | `shifts_no_overlap_per_team`               | 409 `SHIFT_OVERLAP`                                            |
| `23503`  | FK (inclusive compostas)                   | 400/422 conforme o endpoint                                    |
| `23514`  | CHECK                                      | 400 `VALIDATION_ERROR` (a API valida antes)                    |
| `23000`  | gatilhos (campo `constraint` = regra)      | 422 (`QUESTION_LOCKED`, `FIELD_LOCKED_AFTER_PUBLICATION` etc.) |

## Testes de banco

`npm run test -w backend` executa dois projetos do Vitest: `unidade-e-integracao` (sem banco) e `banco` (PostgreSQL real). O projeto `banco` exige `TEST_DATABASE_URL` local, cria o banco se necessário, aplica `prisma migrate deploy` e roda cada teste numa transação desfeita (ROLLBACK). Inclui o **T32** e as verificações de estrutura, CHECK, UQ parciais, gatilhos, RLS e privilégios. Detalhes e resultados: [`plano-e-relatorio-de-testes.md`](plano-e-relatorio-de-testes.md).

## Backup e retenção

Previstos para etapas posteriores (Seção 10; `npm run db:backup` e script de retenção). A estrutura já permite excluir na ordem contatos → manifestações → respostas sem violar FKs; a auditoria só pode ser removida por manutenção explícita (desabilitando o gatilho como dono).
