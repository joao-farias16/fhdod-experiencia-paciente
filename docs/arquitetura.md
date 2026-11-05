# Arquitetura do FHDOD (D03)

Este documento descreve como os dois projetos (API e frontend) estão organizados e se comunicam, onde fica cada responsabilidade e as convenções que as próximas etapas devem seguir. Os contratos dos endpoints ficam nos documentos por tema ([autenticação](autenticacao-e-permissoes.md), [setores, escalas e pesquisas](setores-escalas-e-pesquisas.md), [manifestações, dashboard e relatórios](manifestacoes-dashboard-relatorios.md)); o banco, em [`modelo-de-dados.md`](modelo-de-dados.md) e [`padroes-banco-de-dados.md`](padroes-banco-de-dados.md).

## Visão geral

Desde a Etapa 2 do novo cronograma, backend e frontend são **projetos separados**:

- **API (backend)** — ocupa a **raiz** deste repositório: Express 5 + TypeScript + MySQL 8.4 (driver `mysql2`, SQL parametrizado, sem ORM), com um único `package.json`/`package-lock.json`, `tsconfig.json`, ESLint, Prettier, Vitest, commitlint/husky e o `.env` da API.
- **Frontend** — fica temporariamente em `frontend/`, como projeto **independente**: React 19 + Vite, com `package.json`, `package-lock.json`, `tsconfig*.json`, `vite.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.gitignore`, `.env.example`, `.nvmrc` e README próprios. Não usa nenhum arquivo fora da própria pasta e pode ser movido para outro repositório sem ajustes (verificado copiando a pasta para fora do repositório e executando instalação, typecheck, lint, testes e build).

Não há `package.json` que gerencie os dois projetos; o ESLint e o Prettier da raiz ignoram `frontend/`, e a CI tem um job para cada projeto. Os dois conversam **apenas por HTTP** (veja [Comunicação entre frontend e API](#comunicação-entre-frontend-e-api)).

Os dois lados seguem a mesma ideia: **organização por domínio** (um módulo/feature por assunto do sistema, com os mesmos nomes dos dois lados) e uma camada pequena de código compartilhado, que só recebe o que é usado por mais de um domínio.

| Domínio                         | Backend (`src/modules/`) | Frontend (`src/features/`) |
| ------------------------------- | ------------------------ | -------------------------- |
| Login, perfil e permissões      | `auth`                   | `auth`                     |
| Usuários                        | `users`                  | `users`                    |
| Auditoria                       | `audit`                  | `audit`                    |
| Setores e equipes               | `sectors`, `teams`       | `sectors`                  |
| Turnos e importação de escala   | `shifts`                 | `shifts`                   |
| Pesquisas (administração)       | `surveys`                | `surveys`                  |
| Pesquisa pública e manifestação | `public-survey`          | `public-survey`            |
| Ouvidoria                       | `manifestations`         | `manifestations`           |
| Dashboard                       | `dashboard`              | `dashboard`                |
| Relatórios Excel                | `reports`                | `reports`                  |
| Saúde da API / página inicial   | `health`                 | `home`                     |

## Backend

```text
(raiz do repositório)
├── src/
│   ├── server.ts        processo: lê o .env, valida o ambiente, cria o pool MySQL, sobe o HTTP
│   ├── app.ts           createApp(deps): middlewares globais, /api/v1, 404 e tratamento de erros
│   ├── routes.ts        agregador de /api/v1: cadeias pública, autenticada e /admin
│   ├── lib/             infraestrutura: env (Zod), logger (pino), database (pool mysql2), sql (template parametrizado), domain-types
│   ├── middlewares/     transversais da aplicação: request-logger, rate-limit, error-handler (+404)
│   ├── modules/         um módulo por domínio (tabela acima)
│   └── utils/           funções puras sem estado: errors, validation, dates, idempotency
├── database/            create_database.sql, schema.sql, migrations/, seeds/, seguranca/ (MySQL Workbench)
├── scripts/             db/ (migrations, seed, verificação, reset local, primeiro admin, trava contra banco remoto), e2e/ (dados da E2E)
└── tests/               unit/, integration/, db/ (MySQL real) e support/
```

### Módulo de domínio

Todo módulo segue o mesmo formato; só existem os arquivos de que o domínio precisa:

| Arquivo                | Responsabilidade                                                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<dominio>.routes.ts`  | `Router` do Express com os controladores: validam a entrada (`parseInput`), chamam o serviço e formatam a resposta. Sem regras e sem acesso ao banco (só tipos).                          |
| `<dominio>.schemas.ts` | esquemas Zod da entrada e constantes de regra usadas na validação.                                                                                                                        |
| `<dominio>.service.ts` | regras de negócio, transações (`db.transaction`) e auditoria; chama o repositório. Recebe o escopo de `req.auth` como parâmetro; não importa o Express.                                   |
| auxiliares do domínio  | arquivos com nome próprio quando a regra é grande ou reutilizada: `shift-rules.ts`, `roster-csv.ts`, `rosters.service.ts`, `dashboard.filters.ts`, `nps.ts`, `attribution.ts`, `xlsx.ts`. |

Desde a Etapa 3 há uma **camada de repositório**: `<dominio>.repository.ts` contém todo o SQL do domínio, sempre pelo template `sql` (valores viram parâmetros `?`), e converte as linhas (snake_case) em objetos (camelCase). Os serviços recebem `Database`/`Queryable` e não escrevem SQL.

Pontos específicos:

- **`auth`** concentra a autenticação e a autorização: `auth.middleware.ts` (`authenticate`, `requirePasswordChanged`, `requirePermission`, auditoria das negativas, `authOf` e `auditContextOf`), `permissions.ts` (matriz da Seção 6 e catálogo `ENDPOINTS`), `scope.ts` (escopo de setores, RN10), `password-policy.ts`, `auth.types.ts`, `tokens.ts` (JWT HS256 e token de renovação), `passwords.ts` (bcrypt), `auth.repository.ts` (credenciais e sessões) e as rotas E44–E46, E04 e E05.
- **`audit`** grava (`recordAudit`, na transação de cada operação) e consulta (E41) a trilha; os demais módulos importam `recordAudit` daqui.
- **`shifts`** inclui a importação de escala (E20, E21), que gera turnos com as mesmas regras do cadastro manual.
- **`dashboard.filters.ts`** é a parte comum ao dashboard e aos relatórios: resolução dos filtros contra o escopo e as condições SQL parametrizadas (template `sql`).
- Um módulo pode importar a regra de outro domínio quando ela pertence àquele domínio (por exemplo, `reports` usa os indicadores de `dashboard`, `public-survey` usa `nps.ts`); o que é genérico fica em `utils/`.

### Código compartilhado

| Pasta          | Conteúdo                                                                                                                                                                                                                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lib/`         | `env.ts` (validação das variáveis com Zod; mensagens citam o nome, nunca o valor), `logger.ts`, `database.ts` (pool mysql2 em UTC/READ COMMITTED, transações com nova tentativa em deadlock, `ping`, classificação de erros), `sql.ts` (template parametrizado, `sql.list`, `sql.json`) e `domain-types.ts` (ENUMs).                                                           |
| `middlewares/` | `request-logger.ts` (X-Request-Id, log sem corpo/IP), `rate-limit.ts` (por IP e por perfil) e `error-handler.ts` (404 `ROUTE_NOT_FOUND` e envelope de erro).                                                                                                                                                                                                                   |
| `utils/`       | `errors.ts` (`HttpError`, `AuthorizationDeniedError`, `unauthenticated`, `serviceUnavailable`, violações de UNIQUE/CHECK/gatilho do MySQL), `validation.ts` (`parseInput`, `invalidField`, `validationError`, `idParamsSchema`, paginação e período RN25), `dates.ts` (fuso do hospital e `Clock`) e `idempotency.ts` (Idempotency-Key, hash canônico, token de manifestação). |

O ESLint impõe as camadas (RNF21): `*.service.ts` e `*.filters.ts` não importam `express`; `*.routes.ts` não importam `lib/database`, `lib/sql` nem repositórios (só tipos); em `src/`, SQL interpolado em `query`/`execute` é proibido (RNF11).

### Fluxo de uma requisição

```text
requisição
  → requestLogger (pino-http: X-Request-Id, log sem corpo/IP)
  → helmet (HSTS, nosniff, Referrer-Policy, CSP) → cors (somente CORS_ORIGIN) → express.json (32 KB)
  → /api/v1 (routes.ts → routers dos módulos)
      rotas públicas: limite por IP → requirePermission(E01/E02/E03, público) → serviço
      rotas autenticadas: authenticate → limite 300/min por perfil
        → requirePasswordChanged (exceto E04, E05 e E46) → requirePermission(Exx)
        → controlador → serviço (escopo de req.auth) → repositório (SQL parametrizado; transação + auditoria)
  → notFoundHandler (404 ROUTE_NOT_FOUND)
  → auditAuthorizationDenials (um AUTHORIZATION_DENIED por 403 FORBIDDEN/SECTOR_OUT_OF_SCOPE)
  → errorHandler (envelope de erro, sem stack trace)
```

### Composição e testes

- `createApp(deps)` recebe `env`, `logger`, `db` (Database), `clock` e `auth` (configuração JWT/bcrypt); os testes usam MySQL real e um dublê de banco (`databaseStub`) nos testes sem banco.
- `tests/support/` reúne o apoio dos testes: `app.ts` (aplicação de teste e dublês sem banco), `db.ts` (conexão e fixtures SQL), `auth-scenario.ts` (usuários de cada perfil com sessões reais), `api.ts` (chamadas autenticadas, CSV, relógio ajustável) e `global-setup.ts` (recria e migra o banco de teste).
- `vitest.config.ts` define dois projetos, ambos no `npm test`: `unidade-e-integracao` e `banco`.

### Padrões de resposta

- Sucesso: `{ "data": ... }` (listas com `meta`: `page`, `pageSize`, `total`).
- Erro: `{ "error": { "code", "message", "details", "requestId" } }`, lançando `HttpError(status, code, message, details)`; toda resposta traz `X-Request-Id`.
- Códigos gerais: `ROUTE_NOT_FOUND` (404), `MALFORMED_JSON` (400), `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415), `RATE_LIMITED` (429, com `Retry-After`), `INTERNAL_ERROR` (500), `SERVICE_UNAVAILABLE` (503, MySQL indisponível).
- Autenticação e usuários: `VALIDATION_ERROR` (400, com `details` por campo e sem ecoar valores), `UNAUTHENTICATED`, `INVALID_CREDENTIALS` (401), `ACCOUNT_DISABLED`, `PASSWORD_CHANGE_REQUIRED`, `FORBIDDEN`, `SECTOR_OUT_OF_SCOPE` (403), `NOT_FOUND` (404), `CONFLICT` (409), `SELF_MODIFICATION_FORBIDDEN`, `LAST_SUPERADMIN`, `USER_INACTIVE`, `INVALID_SCOPE`, `SECTOR_INACTIVE` (422).
- Estrutura, pesquisas e respostas: `EMPTY_FILE`, `TOO_MANY_ROWS`, `ENCODING_INVALID`, `IDEMPOTENCY_KEY_INVALID` (400), `SHIFT_OVERLAP`, `SHIFT_ALREADY_CANCELLED`, `IMPORT_ALREADY_COMMITTED`, `IMPORT_EXPIRED`, `IMPORT_REJECTED`, `NO_CHANGES_TO_PUBLISH`, `SURVEY_NOT_PUBLISHED`, `IDEMPOTENCY_KEY_REUSED`, `SURVEY_VERSION_OUTDATED` (409), `SURVEY_UNAVAILABLE` (410), `FILE_TOO_LARGE` (413), `UNSUPPORTED_FILE_TYPE` (415), `TEAM_INACTIVE`, `DATE_OUT_OF_RANGE`, `FIELD_LOCKED_AFTER_PUBLICATION`, `QUESTION_LOCKED`, `QUESTION_LIMIT_REACHED`, `NPS_QUESTION_REQUIRED`, `SURVEY_INACTIVE` (422). Manifestações e relatórios: ver o documento do tema.
- JSON em camelCase; instantes em ISO 8601 UTC. `GET /api/v1/health` (E43) executa `SELECT 1` com limite de 2 s (RNF27).

### Logs

JSON estruturado (pino), com `service`, `req.id`, método, caminho (sem query string), status e tempo de resposta. Não registram corpo, IP, cabeçalhos nem dados pessoais; `authorization` e `cookie` são removidos. Em testes, o nível é `silent`.

## Frontend

```text
frontend/
├── src/
│   ├── main.tsx         ponto de entrada (cria o roteador e o cliente de consultas)
│   ├── app/             composição: App (provedores), routes, AppLayout (público), AdminArea e
│   │                    AdminLayout (área administrativa sob demanda), NotFoundPage, query-client
│   ├── components/ui/   componentes de interface reutilizáveis: Alert, Button, ConfirmDialog, Dialog,
│   │                    Field, States (carregando, erro, vazio, paginação) e Tag
│   ├── features/        uma pasta por domínio (tabela acima)
│   ├── lib/             sem React: env, api-client (HTTP, query string, download), supabase,
│   │                    format (datas pt-BR), errors (falhas de formulário), route-state
│   ├── styles/          Tailwind e tokens visuais
│   └── test/            setup do Vitest e helpers.tsx (cliente falso, perfis, mock da API, renderApp)
└── e2e/                 Playwright: specs, support.ts (login, capturas, dados) e global-setup.ts
```

### Feature

Cada pasta de `features/` contém as páginas da área (`*Page.tsx`), os componentes que só ela usa e um arquivo `<dominio>-api.ts` com os tipos da API, rótulos em português e os hooks do TanStack Query (consultas e mutações). Páginas grandes são divididas em componentes com nome próprio na mesma pasta (por exemplo, `SurveyEditorPage` usa `SurveyDataForm` e `SurveyQuestions`; `ManifestationDetailPage` usa `ManifestationTreatment` e `ManifestationContact`; `PublicSurveyPage` usa `SurveyFlow`). Os testes de componentes ficam ao lado do código (`*.test.tsx`).

Uma feature pode importar o `-api.ts` de outra quando usa dados daquele domínio (por exemplo, `useSectors` de `sectors-api.ts` alimenta filtros em várias telas); componentes visuais compartilhados vão para `components/ui/`.

### Rotas, estado e formulários

- `app/routes.tsx` define as rotas. A pesquisa pública (`/p/:slug`) e a área administrativa são carregadas sob demanda; o supabase-js e a sessão existem só na área administrativa (`app/AdminArea.tsx`, que aplica `RequireAuth`/`RequirePermission` de `features/auth/RouteGuards.tsx` a cada tela). A permissão exibida é só conveniência: a decisão é sempre do backend.
- Estado do servidor: TanStack Query (cache, invalidação após mutações com `useInvalidateAdmin`); estado de sessão: `AuthProvider`/`auth-context`; estado da pesquisa pública em andamento: `sessionStorage` (`survey-storage.ts`). Não há biblioteca de estado global.
- Formulários: React Hook Form; erros da API vão para os campos com `applyApiError` e, fora dos campos, viram aviso com `failureOf` (`lib/errors.ts`).
- Comunicação: `lib/api-client.ts` (`apiRequest`, `apiDownload`), com o token no cabeçalho `Authorization`, sem cookies; o endereço vem de `VITE_API_URL`, lido só em `lib/env.ts` (veja a seção seguinte).

## Comunicação entre frontend e API

- **Somente HTTP.** O frontend chama os endpoints `/api/v1` da API; não importa código da API, não acessa o banco. A E2E também respeita essa fronteira: aciona os comandos `npm run dev:no-watch` e `npm run e2e:fixture` da API (pasta definida por `FHDOD_API_DIR`), sem importar arquivos dela.
- **Endereço da API:** `VITE_API_URL` (sem `/api/v1`; local `http://localhost:3333`). `lib/env.ts` valida a variável (http/https; https obrigatório em produção) e monta a base `VITE_API_URL + /api/v1`; `lib/api-client.ts` é o único lugar que faz `fetch` na API. Vazia, a base é `/api/v1` na mesma origem — em desenvolvimento, o proxy do Vite (`vite.config.ts`) encaminha `/api` para `http://localhost:3333`; o proxy é só um recurso de desenvolvimento e o build não depende dele.
- **CORS:** a API aceita só as origens listadas em `CORS_ORIGIN` (separadas por vírgula; local `http://localhost:5173`), com métodos e cabeçalhos explícitos (`Authorization`, `Content-Type`, `Idempotency-Key`, `X-Request-Id`) e expõe `X-Request-Id`, `Retry-After`, `Idempotent-Replayed` e `Content-Disposition`. Origens desconhecidas não recebem `Access-Control-Allow-Origin`, e em produção todas as origens precisam usar HTTPS (validação do ambiente na inicialização).
- **Autenticação (Etapa 3):** o frontend faz login em `POST /api/v1/auth/login`, renova em `POST /auth/refresh` e encerra em `POST /auth/logout`; envia o token de acesso em `Authorization: Bearer`. O `JWT_SECRET` existe só no backend. (O frontend, em repositório próprio, ainda precisa trocar o Supabase Auth por esses endpoints.)
- **Portas locais:** API `3333`, frontend `5173`; na E2E, API `3334` (banco de teste) e frontend `5174`.

| Terminal     | Pasta               | Comando       | Endereço                |
| ------------ | ------------------- | ------------- | ----------------------- |
| 1 — API      | raiz do repositório | `npm run dev` | `http://localhost:3333` |
| 2 — Frontend | `frontend/`         | `npm run dev` | `http://localhost:5173` |
