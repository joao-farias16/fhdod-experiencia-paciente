# Arquitetura do FHDOD (D03)

Este documento descreve como o código está organizado no backend e no frontend, onde fica cada responsabilidade e as convenções que as próximas etapas devem seguir. Os contratos dos endpoints ficam nos documentos por tema ([autenticação](autenticacao-e-permissoes.md), [setores, escalas e pesquisas](setores-escalas-e-pesquisas.md), [manifestações, dashboard e relatórios](manifestacoes-dashboard-relatorios.md)); o banco, em [`modelo-de-dados.md`](modelo-de-dados.md) e [`padroes-banco-de-dados.md`](padroes-banco-de-dados.md).

## Visão geral

O repositório é um monorepo com npm workspaces: `backend` (API REST em Express 5) e `frontend` (React 19 + Vite) têm dependências, scripts e testes próprios e conversam apenas por HTTP (`/api/v1`). Ferramentas comuns (ESLint, Prettier, TypeScript base, commitlint, CI) ficam na raiz.

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
backend/
├── src/
│   ├── server.ts        processo: lê o .env, valida o ambiente, cria Prisma e Supabase, sobe o HTTP
│   ├── app.ts           createApp(deps): middlewares globais, /api/v1, 404 e tratamento de erros
│   ├── routes.ts        agregador de /api/v1: cadeias pública, autenticada e /admin
│   ├── lib/             infraestrutura: env (Zod), logger (pino), prisma (cliente), supabase (Auth)
│   ├── middlewares/     transversais da aplicação: request-logger, rate-limit, error-handler (+404)
│   ├── modules/         um módulo por domínio (tabela acima)
│   ├── utils/           funções puras sem estado: errors, validation, dates, idempotency
│   └── generated/       Prisma Client gerado por `prisma generate` (não versionado)
├── prisma/              schema.prisma, migrations/ e seed.ts
├── scripts/             db/ (verificação do seed, reset local, trava contra banco remoto), e2e/ (dados da E2E)
└── tests/               unit/, integration/, db/ (PostgreSQL real), supabase/ (Auth local) e support/
```

### Módulo de domínio

Todo módulo segue o mesmo formato; só existem os arquivos de que o domínio precisa:

| Arquivo                | Responsabilidade                                                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<dominio>.routes.ts`  | `Router` do Express com os controladores: validam a entrada (`parseInput`), chamam o serviço e formatam a resposta. Sem regras e sem Prisma (só tipos).                                   |
| `<dominio>.schemas.ts` | esquemas Zod da entrada e constantes de regra usadas na validação.                                                                                                                        |
| `<dominio>.service.ts` | regras de negócio, consultas Prisma, transações e auditoria. Recebe o escopo de `req.auth` como parâmetro; não importa o Express.                                                         |
| auxiliares do domínio  | arquivos com nome próprio quando a regra é grande ou reutilizada: `shift-rules.ts`, `roster-csv.ts`, `rosters.service.ts`, `dashboard.filters.ts`, `nps.ts`, `attribution.ts`, `xlsx.ts`. |

Não há camada de repositório: o serviço usa o Prisma diretamente (consultas tipadas e transações), como em todos os módulos.

Pontos específicos:

- **`auth`** concentra a autenticação e a autorização: `auth.middleware.ts` (`authenticate`, `requirePasswordChanged`, `requirePermission`, auditoria das negativas, `authOf` e `auditContextOf`), `permissions.ts` (matriz da Seção 6 e catálogo `ENDPOINTS`), `scope.ts` (escopo de setores, RN10), `password-policy.ts`, `auth.types.ts` e as rotas E04/E05 (`auth.routes.ts`, `auth.service.ts`).
- **`audit`** grava (`recordAudit`, na transação de cada operação) e consulta (E41) a trilha; os demais módulos importam `recordAudit` daqui.
- **`shifts`** inclui a importação de escala (E20, E21), que gera turnos com as mesmas regras do cadastro manual.
- **`dashboard.filters.ts`** é a parte comum ao dashboard e aos relatórios: resolução dos filtros contra o escopo e as condições SQL parametrizadas (`Prisma.sql`).
- Um módulo pode importar a regra de outro domínio quando ela pertence àquele domínio (por exemplo, `reports` usa os indicadores de `dashboard`, `public-survey` usa `nps.ts`); o que é genérico fica em `utils/`.

### Código compartilhado

| Pasta          | Conteúdo                                                                                                                                                                                                                                                                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/`         | `env.ts` (validação das variáveis com Zod; mensagens citam o nome, nunca o valor), `logger.ts`, `prisma.ts` (cliente com `@prisma/adapter-pg`, tipos e `AUTH_TRANSACTION_OPTIONS`) e `supabase.ts` (verificador de token e operações administrativas).                                                                                                                  |
| `middlewares/` | `request-logger.ts` (X-Request-Id, log sem corpo/IP), `rate-limit.ts` (por IP e por perfil) e `error-handler.ts` (404 `ROUTE_NOT_FOUND` e envelope de erro).                                                                                                                                                                                                            |
| `utils/`       | `errors.ts` (`HttpError`, `AuthorizationDeniedError`, `unauthenticated`, `serviceUnavailable`, violações de UNIQUE/EXCLUDE/gatilho), `validation.ts` (`parseInput`, `invalidField`, `validationError`, `idParamsSchema`, paginação e período RN25), `dates.ts` (fuso do hospital e `Clock`) e `idempotency.ts` (Idempotency-Key, hash canônico, token de manifestação). |

O ESLint impõe as camadas (RNF21): `*.service.ts` e `*.filters.ts` não importam `express`; `*.routes.ts` só importam tipos do Prisma; `$queryRawUnsafe` é proibido (RNF11).

### Fluxo de uma requisição

```text
requisição
  → requestLogger (pino-http: X-Request-Id, log sem corpo/IP)
  → helmet (HSTS, nosniff, Referrer-Policy, CSP) → cors (somente CORS_ORIGIN) → express.json (32 KB)
  → /api/v1 (routes.ts → routers dos módulos)
      rotas públicas: limite por IP → requirePermission(E01/E02/E03, público) → serviço
      rotas autenticadas: authenticate → limite 300/min por perfil
        → requirePasswordChanged (exceto E04 e E05) → requirePermission(Exx)
        → controlador → serviço (escopo de req.auth) → Prisma (transação + auditoria)
  → notFoundHandler (404 ROUTE_NOT_FOUND)
  → auditAuthorizationDenials (um AUTHORIZATION_DENIED por 403 FORBIDDEN/SECTOR_OUT_OF_SCOPE)
  → errorHandler (envelope de erro, sem stack trace)
```

### Composição e testes

- `createApp(deps)` recebe `env`, `logger`, `prisma`, `clock` e `auth: { verifier, admin }`; os testes injetam dublês (`tests/support/fake-supabase.ts`) e usam PostgreSQL real.
- `tests/support/` reúne o apoio dos testes: `app.ts` (aplicação de teste e dublês sem banco), `db.ts` (conexão e fixtures SQL), `auth-scenario.ts` (usuários de cada perfil), `api.ts` (chamadas autenticadas, CSV, relógio ajustável), `fake-supabase.ts` e `global-setup.ts` (cria e migra o banco de teste).
- `vitest.config.ts` define três projetos: `unidade-e-integracao` e `banco` (rodam no `npm test`) e `supabase` (`npm run test:supabase`, exige o Supabase local).

### Padrões de resposta

- Sucesso: `{ "data": ... }` (listas com `meta`: `page`, `pageSize`, `total`).
- Erro: `{ "error": { "code", "message", "details", "requestId" } }`, lançando `HttpError(status, code, message, details)`; toda resposta traz `X-Request-Id`.
- Códigos gerais: `ROUTE_NOT_FOUND` (404), `MALFORMED_JSON` (400), `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415), `RATE_LIMITED` (429, com `Retry-After`), `INTERNAL_ERROR` (500), `SERVICE_UNAVAILABLE` (503, banco ou Supabase Auth indisponível).
- Autenticação e usuários: `VALIDATION_ERROR` (400, com `details` por campo e sem ecoar valores), `UNAUTHENTICATED` (401), `ACCOUNT_DISABLED`, `PASSWORD_CHANGE_REQUIRED`, `FORBIDDEN`, `SECTOR_OUT_OF_SCOPE` (403), `NOT_FOUND` (404), `CONFLICT` (409), `SELF_MODIFICATION_FORBIDDEN`, `LAST_SUPERADMIN`, `USER_INACTIVE`, `INVALID_SCOPE`, `SECTOR_INACTIVE` (422).
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
- Comunicação: `lib/api-client.ts` (`apiRequest`, `apiDownload`), com o token no cabeçalho `Authorization`, sem cookies; em desenvolvimento, o Vite encaminha `/api` ao backend.
