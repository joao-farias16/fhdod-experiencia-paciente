# FHDOD — Sistema de Gestão da Experiência do Paciente

Este repositório contém a **API REST (backend)** do FHDOD, aplicação web para digitalizar a coleta, a organização e a análise da experiência de pacientes e acompanhantes da **Fundação Hospitalar Dr. Oswaldo Diesel**: pesquisa pública por setor acessada por QR Code ou link, dashboard com NPS e filtros, módulo de Ouvidoria, relatórios Excel e TV Wall com indicadores agregados.

> **Ambiente acadêmico.** O projeto usa somente dados fictícios e custo zero. Nenhum dado real de pacientes deve ser inserido.

## Contexto acadêmico e autores

Projeto integrado do curso **Técnico em Informática Integrado ao Ensino Médio** da **Escola Técnica Estadual Monteiro Lobato – CIMOL** (Taquara/RS, 2026).

| Autor                      | GitHub                                             |
| -------------------------- | -------------------------------------------------- |
| João Vitor Farias da Silva | [@joao-farias16](https://github.com/joao-farias16) |
| Felipe Lorini              | —                                                  |

O desenvolvimento é dividido em 14 etapas (ET01–ET14), cada uma executada integralmente por um integrante e revisada pelo outro (Tabela 27 da especificação).

- Quadro Kanban oficial: [GitHub Projects — FHDOD](https://github.com/users/joao-farias16/projects/1)
- Figma (telas das etapas implementadas, na página Page 1): [sistema-hospital](https://www.figma.com/design/kcRMvRhHs8IYRfsZkv1BLZ/sistema-hospital)
- Links da aplicação publicada e da documentação da API (Swagger) serão adicionados quando existirem (ET12 e ET13).

## Estado atual

**ET01 — Repositório, ambiente e Kanban**: integrada em `develop`.
**ET02 — Modelo de dados**: integrada em `develop`.
**ET03 — Autenticação e permissões**: integrada em `develop`.
**ET04, ET05 e ET06 — Setores e escalas, pesquisas e pesquisa pública**: integradas em `develop`.
**ET07, ET08 e ET09 — Manifestações e Ouvidoria, dashboard e relatórios Excel**: integradas em `develop`.
**Etapa 1 do novo cronograma — Revisão e reorganização do projeto**: integrada em `develop` (issue #32), sem mudança de funcionalidades.
**Etapa 2 do novo cronograma — Separação definitiva do backend e do frontend**: na branch `refactor/separacao-backend-frontend`, sem mudança de funcionalidades. A API passou para a raiz do repositório e o frontend foi removido deste repositório, passando a ser mantido em repositório próprio (veja [Organização do repositório](#organização-do-repositório)).

| Implementado (ET01 a ET09)                                                                     | Reservado para etapas futuras                            |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| API na raiz; frontend em repositório próprio (comunicação só por HTTP)                         | TV Wall (E42, TL15, ET10)                                |
| **ET03:** Supabase Auth, E04–E10 e E41, matriz da Seção 6, escopo e auditoria                  | Conferência das telas com o Figma (revisão)              |
| **ET03:** telas de login, troca de senha, usuários e auditoria (TL01, TL02, TL16, TL17)        |                                                          |
| **ET04:** setores, equipes, etapas, turnos e importação de escala CSV (E10–E21; TL05–TL07)     | Backup e retenção (scripts), OpenAPI/Swagger (ET11–ET12) |
| **ET04:** atribuição de avaliações a turno e equipe (RF24)                                     | E2E com axe em todas as telas (ET11)                     |
| **ET05:** pesquisas, perguntas, versões imutáveis, link, QR Code e cartaz (E16, E22–E27; TL08) | Publicação na nuvem (ET12)                               |
| **ET06:** pesquisa pública por link/QR Code com envio idempotente (E01, E02; TL09, TL11)       |                                                          |
| **ET07:** manifestação após a avaliação, anonimato, contato e protocolo (E03; TL10)            |                                                          |
| **ET07:** Ouvidoria: lista, detalhe, status, notas e contato auditado (E35–E40; TL12, TL13)    |                                                          |
| **ET08:** painel geral e por setor com filtros, supressão e comparação (E28–E33; TL03, TL04)   |                                                          |
| **ET09:** relatórios Excel de respostas, indicadores e manifestações (E34; TL14)               |                                                          |
| API Express 5 com `GET /api/v1/health` (com `SELECT 1`), segurança, logs e erros               |                                                          |
| **ET02:** Prisma 7, 18 tabelas, 5 migrations, CHECK/EXCLUDE/gatilhos, RLS, seed e T32          |                                                          |
| ESLint, Prettier, TypeScript strict, Vitest, commitlint                                        |                                                          |
| CI no GitHub Actions (gitleaks, lint, typecheck, testes, build, saúde, `npm audit`)            |                                                          |
| Testes E2E com Playwright (no repositório do frontend; dados preparados por `e2e:fixture`)     |                                                          |
| `.gitignore`, `.env.example` fictícios e varredura de segredos; quadro Kanban com as etapas    |                                                          |

Desde a ET02, a API conecta-se ao PostgreSQL pelo Prisma; a rota de saúde responde 503 se o banco não responder em 2 s.

## Tecnologias

| Camada    | Tecnologias (versões instaladas)                                                                                                                                                                                  |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend   | Node.js 24 LTS (alvo), Express 5.3, TypeScript 5.9, Zod 4, supabase-js 2 (Supabase Auth), helmet, cors, express-rate-limit, pino / pino-http, multer 2 e csv-parse 7 (escala CSV), ExcelJS 4.4 (relatórios .xlsx) |
| Banco     | PostgreSQL 17 (Supabase CLI local), Prisma 7.10.1 (`@prisma/client`, `@prisma/adapter-pg`, `pg`), `@faker-js/faker` 10 no seed, Supabase CLI 2.121.0                                                              |
| Qualidade | ESLint 10 + typescript-eslint (strictTypeChecked), Prettier 3, Vitest 5, Supertest, commitlint + husky                                                                                                            |
| CI        | GitHub Actions, gitleaks 8.30.1, `npm audit`                                                                                                                                                                      |
| Previstas | Recharts, OpenAPI 3.1 + Swagger UI, axe                                                                                                                                                                           |

As bibliotecas da linha "Previstas" fazem parte da especificação, mas só serão instaladas na etapa que as utilizar, para não manter dependências sem uso.

## Pré-requisitos

- **Node.js 24 LTS** (versão em `.nvmrc`; a CI usa Node 24). O projeto também foi verificado com Node 22.12+.
- **npm 10+** (instalado com o Node.js).
- **Git**.
- **Docker** (Docker Desktop no Windows) para o banco local. O Supabase CLI vem como dependência de desenvolvimento (`npx supabase`).

## Organização do repositório

Desde a **Etapa 2 do novo cronograma (separação definitiva)**, este repositório é **dedicado à API (backend)**, que fica na raiz: há um único `package.json`, com as dependências e os scripts da API (endereço local `http://localhost:3333`; documentação neste README e em [`docs/`](docs/)). A interface web não faz parte deste repositório: é mantida em repositório próprio, com dependências, configurações, documentação e CI próprias.

A API e o frontend se comunicam **somente por HTTP**: o frontend chama os endpoints `/api/v1`, e a API libera a origem do frontend pelo CORS (`CORS_ORIGIN`). O frontend não importa código da API, não acessa o banco nem o Prisma.

## Estrutura de pastas

O backend é organizado **por domínio** (`auth`, `users`, `audit`, `sectors`, `shifts`, `surveys`, `public-survey`, `manifestations`, `dashboard`, `reports`), com uma camada pequena de código compartilhado. Detalhes e convenções: [`docs/arquitetura.md`](docs/arquitetura.md).

```text
fhdod-experiencia-paciente/      repositório da API (backend na raiz)
├── src/
│   ├── server.ts                inicialização do processo (.env, ambiente, Prisma, Supabase, HTTP)
│   ├── app.ts                   createApp(deps): middlewares globais, CORS, /api/v1, 404 e erros
│   ├── routes.ts                agregador de /api/v1 (cadeias pública, autenticada e /admin)
│   ├── lib/                     infraestrutura: env, logger, prisma, supabase
│   ├── middlewares/             request-logger, rate-limit e error-handler (inclui o 404)
│   ├── modules/<domínio>/       *.routes.ts (rotas e controladores), *.schemas.ts (Zod),
│   │                            *.service.ts (regras, Prisma, transações) e auxiliares do domínio
│   └── utils/                   funções puras: errors, validation, dates, idempotency
├── prisma/                      schema.prisma, migrations/ e seed.ts
├── scripts/                     db/ (verificação do seed, reset local, trava de banco remoto) e
│                                e2e/ (dados fictícios da E2E executada pelo repositório do frontend)
├── tests/                       unit/, integration/, db/ (PostgreSQL real), supabase/ e support/
├── supabase/config.toml         ambiente local (PostgreSQL 54322, Auth 54321, Data API desligada)
├── docs/                        documentação técnica e evidencias/ (por etapa)
├── .github/                     CI da API e modelo de Pull Request
├── package.json · package-lock.json   dependências e scripts da API
├── tsconfig.json · tsconfig.build.json · vitest.config.ts · prisma.config.ts
├── eslint.config.js · .prettierrc.json · commitlint.config.js · .husky/
├── .env.example                 variáveis da API (o .env real não é versionado)
└── README.md
```

`dist/` (builds), `coverage/`, `playwright-report/`, `test-results/` e `src/generated/` (Prisma Client) são gerados e não versionados.

## Instalação da API

```bash
git clone https://github.com/joao-farias16/fhdod-experiencia-paciente.git
cd fhdod-experiencia-paciente
npm ci
cp .env.example .env
```

O `npm ci` instala as dependências da API, gera o Prisma Client em `src/generated/` (`postinstall`) e ativa o hook `commit-msg` (husky) que valida as mensagens de commit. Se `src/generated/` for apagado ou o `schema.prisma` mudar, gere o client de novo com `npm run db:generate` antes de lint, typecheck, testes ou build.

### Banco de dados local (ET02)

Com o Docker em execução, na raiz do repositório:

```bash
npm run db:start                      # Supabase CLI: PostgreSQL 54322, Auth 54321, Studio 54323
npx supabase status -o env            # copie SECRET_KEY para SUPABASE_SECRET_KEY no .env
npm run db:migrate                    # aplica as migrations versionadas
npm run db:seed                       # dados fictícios determinísticos
npm run db:seed:verify                # confere as contagens no banco
```

`npm run db:reset` recria o banco **local** (migrations + seed) e recusa URLs remotas. Detalhes: [`docs/padroes-banco-de-dados.md`](docs/padroes-banco-de-dados.md), [`docs/modelo-de-dados.md`](docs/modelo-de-dados.md) e [`docs/mapeamento-classes-e-consultas.md`](docs/mapeamento-classes-e-consultas.md).

Contas de demonstração (somente no ambiente local, senha = `SEED_DEMO_PASSWORD` do seu `.env`): `superadmin@`, `admin.setor@`, `gestao@`, `gestao.setores@`, `ouvidoria@` e `visualizador@example.com`. Elas são usadas no login do frontend (TL01), mantido em repositório próprio.

O seed também publica as pesquisas dos 6 setores fictícios. Na API, a pesquisa pública responde sem login, por exemplo em `GET http://localhost:3333/api/v1/public/surveys/pronto-atendimento` (E01).

> **Windows — "ports are not available" ao iniciar o Supabase.** Se `npm run db:start` falhar com `bind: An attempt was made to access a socket in a way forbidden by its access permissions` nas portas 54321–54323, o Windows reservou essa faixa (veja com `netsh interface ipv4 show excludedportrange protocol=tcp`). Em um terminal **como administrador**, execute `net stop winnat` e `net start winnat` e tente de novo.

## Variáveis de ambiente da API

O `.env` fica na **raiz** do repositório (copiado de `.env.example`, que tem só valores fictícios).

| Variável                              | Uso                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                            | `development`, `test` ou `production`                                                                                                 |
| `PORT`                                | porta da API (padrão `3333`)                                                                                                          |
| `CORS_ORIGIN`                         | **obrigatória**; origens do frontend permitidas, separadas por vírgula (local `http://localhost:5173`; HTTPS em produção)             |
| `LOG_LEVEL`                           | nível do pino (padrão `info`)                                                                                                         |
| `TRUST_PROXY`                         | número de proxies confiáveis (Render = `1`)                                                                                           |
| `DATABASE_URL`                        | **obrigatória** (ET02); API → PostgreSQL (nuvem: pooler transação, 6543)                                                              |
| `DIRECT_URL`                          | Prisma Migrate (nuvem: pooler sessão, 5432)                                                                                           |
| `TEST_DATABASE_URL`                   | testes de banco e E2E (somente servidor local)                                                                                        |
| `SEED_*`                              | senha das contas de demonstração, trava de banco remoto e data de referência                                                          |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | **obrigatórias** (ET03): validação do token e administração das contas; seed                                                          |
| `AUDIT_IP_SECRET`                     | HMAC do IP na auditoria (opcional local; obrigatória em produção, 32+)                                                                |
| `PUBLIC_APP_URL`                      | endereço do frontend: base dos links e do QR Code `/p/<slug>` (padrão local `http://localhost:5173`; HTTPS e obrigatória em produção) |
| `MANIFESTATION_TOKEN_SECRET`          | HMAC do token devolvido por E02 (opcional local; obrigatória em produção, 32+)                                                        |
| `SUPABASE_PUBLISHABLE_KEY`            | somente `npm run test:supabase`                                                                                                       |

Todas as variáveis da Tabela 15 já são lidas pela API. Sem `MANIFESTATION_TOKEN_SECRET` local, a API usa um segredo aleatório válido enquanto estiver rodando. Valores locais do Supabase: `npx supabase status -o env` (`API_URL`, `SECRET_KEY`, `PUBLISHABLE_KEY`). A API valida as variáveis na inicialização e não sobe se alguma for inválida.

**Nunca versione arquivos `.env`** (o `.gitignore` só aceita `.env.example`). A chave secreta do Supabase existe somente na API.

## Execução

Na raiz do repositório:

```bash
npm run dev            # http://localhost:3333 (recarrega ao salvar)
```

O CORS da API libera as origens de `CORS_ORIGIN` (no ambiente local, o frontend em `http://localhost:5173`). O CORS só aceita as origens listadas — uma origem desconhecida não recebe `Access-Control-Allow-Origin` — e, em produção, todas precisam usar HTTPS. Para publicar o frontend em outro endereço, inclua esse endereço em `CORS_ORIGIN` e em `PUBLIC_APP_URL`.

Para executar a API a partir do build: `npm run build` e depois `npm start`.

### Rota de saúde da API

`GET /api/v1/health` (E43) — pública, limitada a 60 requisições por minuto por IP, com `Cache-Control: no-store`:

```bash
curl http://localhost:3333/api/v1/health
```

```json
{
  "data": {
    "status": "ok",
    "service": "fhdod-api",
    "timestamp": "2026-10-11T00:55:36.685Z",
    "uptimeSeconds": 0
  }
}
```

Erros seguem o padrão `{ "error": { "code", "message", "details", "requestId" } }` (por exemplo, `ROUTE_NOT_FOUND`, `MALFORMED_JSON`, `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`, `INTERNAL_ERROR`). Toda resposta traz o cabeçalho `X-Request-Id`.

### Endpoints implementados

| Grupo                         | Endpoints (prefixo `/api/v1`)                                                                            | Documentação                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Saúde                         | E43 `GET /health`                                                                                        | [`docs/arquitetura.md`](docs/arquitetura.md)                                               |
| Perfil, usuários e auditoria  | E04–E09, E41                                                                                             | [`docs/autenticacao-e-permissoes.md`](docs/autenticacao-e-permissoes.md)                   |
| Setores, equipes e etapas     | E10–E12 `/admin/sectors`, E13–E15 `/admin/teams`, E16 `/admin/journey-stages`                            | [`docs/setores-escalas-e-pesquisas.md`](docs/setores-escalas-e-pesquisas.md)               |
| Turnos e importação de escala | E17–E19 `/admin/shifts`, E20 `POST /admin/rosters/import`, E21 `POST /admin/rosters/imports/:id/confirm` | [`docs/setores-escalas-e-pesquisas.md`](docs/setores-escalas-e-pesquisas.md)               |
| Pesquisas                     | E22–E25 `/admin/surveys`, E26 `POST /admin/surveys/:id/publish`, E27 `GET /admin/surveys/:id/qr`         | [`docs/setores-escalas-e-pesquisas.md`](docs/setores-escalas-e-pesquisas.md)               |
| Pesquisa pública (sem login)  | E01 `GET /public/surveys/:slug`, E02 `POST /public/responses` (cabeçalho `Idempotency-Key` com UUID v4)  | [`docs/setores-escalas-e-pesquisas.md`](docs/setores-escalas-e-pesquisas.md)               |
| Manifestação (sem login)      | E03 `POST /public/manifestations` (`Idempotency-Key` e token devolvido por E02)                          | [`docs/manifestacoes-dashboard-relatorios.md`](docs/manifestacoes-dashboard-relatorios.md) |
| Ouvidoria                     | E35–E38 `/ouvidoria/manifestations[/:id[/notes]]`, E39–E40 `/ouvidoria/manifestations/:id/contact`       | [`docs/manifestacoes-dashboard-relatorios.md`](docs/manifestacoes-dashboard-relatorios.md) |
| Dashboard                     | E28–E33 `/dashboard/summary`, `/sectors`, `/shifts`, `/teams`, `/trends`, `/questions`                   | [`docs/manifestacoes-dashboard-relatorios.md`](docs/manifestacoes-dashboard-relatorios.md) |
| Relatórios Excel              | E34 `GET /reports/export?type=` `responses`, `indicators` ou `manifestations`                            | [`docs/manifestacoes-dashboard-relatorios.md`](docs/manifestacoes-dashboard-relatorios.md) |

A especificação OpenAPI/Swagger (`/api/docs`) ainda não existe (prevista para uma etapa futura).

## Qualidade: lint, typecheck, testes e build (API)

Comandos executados na **raiz** do repositório.

| Comando                 | O que faz                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `npm run check`         | formatação, lint, typecheck, testes e build em sequência (mesmos passos do job `qualidade` da CI)                        |
| `npm run format:check`  | verifica a formatação (Prettier); `npm run format` corrige                                                               |
| `npm run lint`          | ESLint sem avisos tolerados (inclui as regras de camadas); `npm run lint:fix` corrige                                    |
| `npm run typecheck`     | TypeScript (`src`, `tests`, `prisma`, `scripts`)                                                                         |
| `npm test`              | projetos `unidade-e-integracao` e `banco`: unidade, integração e banco real (T32, T12–T26, T07–T11, T18–T21, T36, T37)   |
| `npm run test:db`       | somente o projeto `banco` (PostgreSQL, `TEST_DATABASE_URL`)                                                              |
| `npm run test:supabase` | projeto `supabase`: T12, T13 e T16 contra o Supabase Auth local (`npm run db:start`)                                     |
| `npm run test:coverage` | cobertura da API                                                                                                         |
| `npm run build`         | build da API em `dist/` (`npm start` executa o build)                                                                    |
| `npm run dev:no-watch`  | API sem recarga automática (usado pela E2E do frontend, em repositório próprio; no dia a dia, prefira `npm run dev`)     |
| `npm run e2e:fixture`   | cria/exclui os dados fictícios da E2E do frontend no banco de teste (acionado pela E2E do frontend; não é usado sozinho) |

Regras de lint relevantes para segurança: `any` explícito proibido (RNF20), `$queryRawUnsafe` proibido (RNF11).

Os testes de banco usam `TEST_DATABASE_URL` (somente servidor local; o banco é criado e migrado automaticamente). Para usar outro PostgreSQL local sem editar o `.env`, defina a variável na linha de comando, por exemplo `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/fhdod_test npm test` com um contêiner `postgres:17`.

## Integração contínua

O workflow [`.github/workflows/ci.yml`](.github/workflows/ci.yml) roda em push e pull request para `main` e `develop`:

1. **Segredos** — gitleaks no histórico completo;
2. **API** — `npm ci` na raiz, serviço PostgreSQL 17, validação do schema, `prisma migrate deploy` em banco vazio, `prisma migrate diff --exit-code`, seed com verificação das contagens, formatação, lint, typecheck, testes (inclusive com banco real), build e verificação de `GET /api/v1/health` com o build, em Node 24;
3. **Dependências** — `npm audit --audit-level=high` com o `package.json` e o `package-lock.json` da raiz (API).

## ET01 — Repositório, ambiente e Kanban

Critério de conclusão (Tabela 27): estrutura, CI, proteções e serviços sem cobrança; **um clone limpo passa no lint e no typecheck**.

- [x] Estrutura inicial, frontend e backend executáveis, rota de saúde
- [x] Lint, typecheck, testes e builds passando localmente (inclusive em cópia limpa, com Node 22 e Node 24)
- [x] `.gitignore`, `.env.example` e varredura de segredos sem achados
- [x] Workflow de CI preparado
- [x] Quadro Kanban configurado com os cards da ET01
- [ ] Commit, push e Pull Request (feitos pelo responsável)
- [ ] Primeira execução da CI no GitHub
- [ ] Proteção de `main` e `develop` e inclusão do Felipe como colaborador
- [ ] Revisão do Felipe

Evidências: [`docs/plano-e-relatorio-de-testes.md`](docs/plano-e-relatorio-de-testes.md).

## ET02 — Modelo de dados

Critério de conclusão (Tabela 27): migrations, seed; **contagens do seed e T32 aprovados**.

- [x] Prisma 7 configurado e integrado ao backend (`DATABASE_URL`, saúde com `SELECT 1`)
- [x] 18 tabelas, 11 enums, FKs compostas, CHECK, UQ parciais, EXCLUDE, gatilhos, sequência do protocolo
- [x] RLS sem políticas e privilégios de `anon`/`authenticated` revogados; Data API desligada no ambiente local
- [x] 5 migrations reconstroem o banco vazio; `migrate diff` sem diferenças (Supabase local e PostgreSQL 17 puro)
- [x] Seed determinístico com contagens verificadas no banco (1/6/18/4/6/2.400/180/72/6)
- [x] T32 com os 6 cenários aprovados contra PostgreSQL real (e teste de mutação comprovando a detecção)
- [ ] Commit, push, Pull Request e CI remota (feitos pelo responsável)
- [ ] Revisão do Felipe
- [ ] Data API do projeto Supabase remoto desligada no painel e migrations aplicadas na nuvem (somente com autorização, ET12)

Evidências: [`docs/evidencias/ET02/`](docs/evidencias/ET02/) e [`docs/plano-e-relatorio-de-testes.md`](docs/plano-e-relatorio-de-testes.md).

## ET03 — Autenticação e permissões

Critério de conclusão (Tabela 27): **E04–E09, E41, TL01, TL02, TL16, TL17; T12–T17**.

- [x] Login no Supabase Auth, validação do token a cada requisição, perfil/escopo/permissões no E04, logout com revogação
- [x] E05 (troca de senha), E06–E09 (usuários, escopo, desativação, redefinição assistida com senha temporária CSPRNG)
- [x] E41 (auditoria) e auditoria na mesma transação das operações; negativas de autorização auditadas
- [x] Matriz da Seção 6 no backend; escopo por setor nas consultas (403/404)
- [x] TL01, TL02, TL16 e TL17 integradas à API
- [x] T12–T17 executados (integração com PostgreSQL real, Supabase Auth local, componentes e E2E)
- [ ] Commit, push, Pull Request e CI remota (feitos pelo responsável)
- [ ] Revisão do Felipe e conferência das telas com o Figma

Detalhes: [`docs/autenticacao-e-permissoes.md`](docs/autenticacao-e-permissoes.md). Evidências: [`docs/evidencias/ET03/`](docs/evidencias/ET03/) e [`docs/plano-e-relatorio-de-testes.md`](docs/plano-e-relatorio-de-testes.md).

## ET04 — Setores, equipes e turnos

Critério de conclusão (Tabela 27): **E10–E21, TL05–TL07; T22–T25**.

- [x] Setores (E10–E12) e equipes (E13–E15) com cadastro, edição, desativação e reativação lógicas, escopo e auditoria
- [x] Turnos manuais (E17–E19): horas locais em UTC, virada de dia, 1 a 24 h, sem sobreposição por equipe, cancelamento com motivo
- [x] Importação CSV (E20–E21): pré-validação sem gravar turnos, erros por linha e coluna, confirmação única em até 30 minutos
- [x] Atribuição das avaliações a turno e equipe (RF24) no registro da resposta (E02)
- [x] TL05 (`/admin/setores`), TL06 (`/admin/turnos`) e TL07 (`/admin/escalas/importar`) integradas à API
- [x] T22–T25 aprovados na integração com PostgreSQL real; componentes das telas aprovados
- [x] E2E administrativo (`e2e/escalas-e-pesquisas.spec.ts`, hoje no repositório do frontend: TL05, TL07 com turno noturno, TL06) aprovado com Supabase local
- [ ] Commit, push, Pull Request e CI remota (feitos pelo responsável); revisão do João (responsável da etapa: Felipe)

## ET05 — Pesquisas

Critério de conclusão (Tabela 27): **E16, E22–E27, TL08; T02, T26**.

- [x] Criação em rascunho com a pergunta geral automática; edição de textos; perguntas específicas com etapa, ordem e ativação
- [x] Bloqueios: setor, slug e pergunta geral após a 1ª publicação; pergunta publicada imutável; limite de 10 específicas ativas
- [x] Publicação de versões imutáveis com instantâneos, histórico com autor, desativação e reativação; 409 sem alterações
- [x] Link e QR Code com `origem=qr`/`origem=link`, exportação PNG e SVG e cartaz A4 (TL08)
- [x] T26 aprovado na integração; URLs exatas do T02 verificadas na integração
- [x] T02 no E2E: TL08 publicada; os arquivos PNG e SVG baixados decodificam (jsqr) para a URL exata com `origem=qr`, que abre a pesquisa e registra a resposta
- [ ] Leitura do cartaz com a câmera de um celular (parte manual do T02) — **não executada**
- [ ] Commit, push, Pull Request e CI remota (feitos pelo responsável); revisão do Felipe

## ET06 — Pesquisa pública

Critério de conclusão (Tabela 27): **E01, E02, TL09, TL11; T01, T03–T06, T10, T27, T28**.

- [x] Acesso sem login nem cookies por link ou QR Code; 404 para rascunho ou inexistente e 410 para inativa
- [x] Pergunta geral 0–10 obrigatória, específicas 1–5 opcionais com "Limpar resposta", "Etapa X de Y", Voltar e recarga preservadas
- [x] Validação no frontend e no backend; envio idempotente (`Idempotency-Key`, `request_hash`, UNIQUE) e reenvios automáticos (1, 2 e 4 s)
- [x] Confirmação somente após 201/200, com o agradecimento da versão; limpeza das chaves `fhdod:*` ao concluir e após 3 min + 60 s
- [x] T01, T03, T04, T05, T06, T10, T27 e T28 aprovados (integração, componentes e E2E da pesquisa pública em 1440 e 360 px)
- [ ] Commit, push, Pull Request e CI remota (feitos pelo responsável); revisão do João (responsável da etapa: Felipe)

Detalhes das três etapas: [`docs/setores-escalas-e-pesquisas.md`](docs/setores-escalas-e-pesquisas.md). Evidências: [`docs/evidencias/ET04-ET06/`](docs/evidencias/ET04-ET06/) e [`docs/plano-e-relatorio-de-testes.md`](docs/plano-e-relatorio-de-testes.md).

## ET07 — Manifestações e Ouvidoria

Critério de conclusão (Tabela 27): **E03, E35–E40, TL10, TL12, TL13; T07–T09, T18, T19**.

- [x] E03: token HMAC de 60 min e uso único, idempotência, anonimato padrão, contato segregado com aceite, protocolo `FHD-AAAA-NNNNNN`
- [x] E35–E40: lista com filtros e trecho, detalhe com linha do tempo (sem contato), transições da RN23, `updatedAt`, notas, contato auditado com `no-store` e eliminação com motivo
- [x] TL10 (oferta após nota baixa ou ação secundária, formulário e protocolo), TL12 e TL13
- [x] T07, T08, T09, T10 (E03), T18 e T19 aprovados (integração, componentes e E2E)
- [ ] Conferência com o Figma; commit, push, Pull Request e CI remota (feitos pelo responsável); revisão do Felipe

## ET08 — Dashboard

Critério de conclusão (Tabela 27): **E28–E33, TL03, TL04; T05, T11, T36, T37**.

- [x] E28–E33 com filtros comuns, escopo, comparação, cobertura, série sem lacunas e supressão para o VI (RN21)
- [x] TL03 (`/painel`) e TL04 (`/painel/setores/:sectorId`) com filtros na URL, n em todo indicador, tabela alternativa e atualização a cada 60 s
- [x] T05, T11, T36 e T37 aprovados (integração, componentes e E2E); T15 repetido contra o E28 real
- [ ] Conferência com o Figma; commit, push, Pull Request e CI remota; revisão do João (responsável da etapa: Felipe)

## ET09 — Excel

Critério de conclusão (Tabela 27): **E34, TL14; T20, T21**.

- [x] E34 com ExcelJS: respostas, indicadores (iguais a E28/E29/E32/E33) e manifestações (`includeText` só para a Ouvidoria; contato nunca)
- [x] Células tipadas, datas `dd/mm/aaaa hh:mm`, cabeçalho congelado, nome padronizado, arquivo vazio válido; 50.000 linhas (422), 10 em 10 min (429) e auditoria
- [x] TL14 (`/relatorios`) e exportação pelo painel (RF62)
- [x] T20 e T21 aprovados (arquivos abertos com ExcelJS na integração; download no E2E)
- [ ] Abertura manual no Excel e no LibreOffice (RF63) — **não executada**; commit, push, Pull Request e CI remota; revisão do Felipe

Detalhes das três etapas: [`docs/manifestacoes-dashboard-relatorios.md`](docs/manifestacoes-dashboard-relatorios.md). Evidências: [`docs/evidencias/ET07-ET09/`](docs/evidencias/ET07-ET09/) e [`docs/plano-e-relatorio-de-testes.md`](docs/plano-e-relatorio-de-testes.md).

## Limitações conhecidas e pendências

- **E2E com Supabase Auth (frontend):** 23/23 aprovados em 28/10/2026 (`t12-autenticacao`, `administracao`, `escalas-e-pesquisas`, `pesquisa-publica` e `manifestacoes-painel-relatorios`) e novamente após a separação da Etapa 2 (resultado em [`docs/plano-e-relatorio-de-testes.md`](docs/plano-e-relatorio-de-testes.md)). Se `npm run db:start` acusar porta proibida, conferir `netsh interface ipv4 show excludedportrange protocol=tcp` e liberar a faixa (ver [banco local](#banco-de-dados-local-et02)). A E2E é executada a partir do repositório do frontend; neste repositório ficam apenas os dados de apoio (`npm run e2e:fixture`) e as evidências já registradas em `docs/evidencias/`.
- **Supabase remoto vazio (verificado em 28/10/2026):** o projeto `mowxlbpwhcsurjpcrpra` tem 0 tabelas e 0 migrations; a publicação do esquema é da ET12 e exige autorização. Tudo foi desenvolvido e testado no Supabase local ([detalhes](docs/manifestacoes-dashboard-relatorios.md#supabase-e-figma)).
- **Figma (28/10/2026):** o arquivo `sistema-hospital` reúne, na página Page 1, os componentes visuais do FHDOD e as telas de todas as etapas implementadas (ET01 a ET09): início, pesquisa pública, manifestação, confirmação, login, troca de senha, painel geral e por setor, setores e equipes, escalas, importação, pesquisas e cartaz, Ouvidoria, relatórios, usuários, auditoria e acesso não permitido. A TL15 (TV Wall, ET10) ainda não foi implementada e não tem tela. A revisão cruzada das telas faz parte da revisão de cada etapa. Detalhes em [`docs/manifestacoes-dashboard-relatorios.md`](docs/manifestacoes-dashboard-relatorios.md#supabase-e-figma).
- **`npm audit`:** o ExcelJS 4.4 depende do `uuid` 8, com aviso moderado (GHSA-w5hq-g745-h8pq) que só afeta `v3`/`v5`/`v6` com `buf`; o ExcelJS usa apenas `v4`. A CI falha somente em alta ou crítica.
- **Banco de desenvolvimento local:** `npm run db:seed:verify` acusa 2.401 respostas (uma resposta manual de 27/10/2026) e 2 registros de auditoria (primeiro E2E da ET03); restaurar só com `npm run db:reset` autorizado.
- **OpenAPI/Swagger, axe e T35/T39** continuam previstos para a ET11/ET12.
- A matriz de testes completa e a execução contra a nuvem dependem das próximas etapas (ET11–ET12).

## Branches e colaboração

- `main`: versão publicada; `develop`: integração. Ambas protegidas (Pull Request, CI aprovada e aprovação do outro integrante).
- Trabalho em `feature/<id>-<descricao>`, `fix/<id>-<descricao>` ou `docs/<descricao>`, sempre a partir de `develop`.
- Commits no padrão **Conventional Commits** em português (`feat`, `fix`, `docs`, `test`, `refactor`, `style`, `chore`, `ci`, `build`, `perf`), validados pelo commitlint.
- No quadro, no máximo **2 itens "Em andamento" por pessoa**.

Detalhes e passo a passo das proteções: [`docs/padroes-git.md`](docs/padroes-git.md). Arquitetura da API e comunicação com o frontend: [`docs/arquitetura.md`](docs/arquitetura.md).
