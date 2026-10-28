# Arquitetura do backend (D03) — ET01 a ET06

Este documento descreve o que existe hoje na API e as convenções que as próximas etapas devem seguir. Ele será ampliado a cada etapa.

## Fluxo de uma requisição

```text
requisição
  → requestLogger (pino-http: X-Request-Id, log sem corpo/IP)
  → helmet (HSTS, nosniff, Referrer-Policy, CSP)
  → cors (somente CORS_ORIGIN)
  → express.json (limite de 32 KB)
  → /api/v1 (routes/v1.ts → módulos)
      rotas autenticadas (ET03): authenticate → limite 300/min por perfil
        → requirePasswordChanged (exceto E04 e E05) → requirePermission(Exx)
        → controlador → serviço (escopo de req.auth) → Prisma (transação + auditoria)
      rotas públicas (ET06): limite por IP → requirePermission(E01/E02, público) → serviço
  → notFoundHandler (404 ROUTE_NOT_FOUND)
  → auditAuthorizationDenials (um AUTHORIZATION_DENIED por 403 FORBIDDEN/SECTOR_OUT_OF_SCOPE)
  → errorHandler (envelope de erro, sem stack trace)
```

Autenticação, matriz de permissões, escopo e auditoria estão detalhados em [`autenticacao-e-permissoes.md`](autenticacao-e-permissoes.md).

## Composição

- `createApp(deps)` (`src/app.ts`) monta a aplicação a partir de dependências injetadas: `env`, `logger`, `prisma` (ET02), `clock` e, desde a ET03, `auth: { verifier, admin }` — o verificador de token (`TokenVerifier`) e as operações administrativas do Supabase Auth (`AuthAdmin`). Os testes injetam dublês (`tests/fake-supabase.ts`) e usam PostgreSQL real (Seção 7 e Seção 12).
- `src/lib/supabase.ts` implementa as duas interfaces com o supabase-js e a chave secreta (somente no servidor, sem sessão persistida): `auth.getUser`, `auth.admin.createUser`, `updateUserById` (senha e `ban_duration`) e `deleteUser` (compensação).
- `src/lib/prisma.ts` cria o Prisma Client 7 com o adaptador `@prisma/adapter-pg` a partir de `DATABASE_URL`. O cliente é gerado em `src/generated/prisma` (não versionado; `npm ci` o gera).
- `src/server.ts` lê `backend/.env` (se existir), valida as variáveis, cria o cliente Prisma e a integração com o Supabase Auth, inicia o servidor e trata `SIGTERM`/`SIGINT` (fecha o servidor e desconecta o Prisma).
- `src/config/env.ts` valida as variáveis com Zod. Mensagens de erro citam o nome da variável, nunca o valor.

## Camadas (convenção a partir da ET02)

| Pasta                    | Responsabilidade                                                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/modules/<dominio>/` | rotas, controladores (sem regras e sem Prisma), serviços (regras e transações, sem Express), repositórios e esquemas Zod do domínio                                    |
| `src/routes/`            | agregação das rotas por versão (`/api/v1`)                                                                                                                             |
| `src/middlewares/`       | middlewares transversais: logs, limites por IP e por perfil, erros, `authenticate`, `requirePasswordChanged`, `requirePermission` e auditoria de negativas             |
| `src/services/`          | serviços transversais sem Express: auditoria (`recordAudit`, catálogo, HMAC do IP) e escopo de setores (`resolveSectorFilter`, `sectorWhere`, `assertResourceInScope`) |
| `src/lib/`               | integrações técnicas (logger, Prisma, Supabase Auth)                                                                                                                   |
| `src/generated/prisma/`  | Prisma Client gerado (`prisma generate`); não versionado nem editado                                                                                                   |
| `prisma/`                | `schema.prisma`, migrations versionadas e `seed.ts` (ver `docs/padroes-banco-de-dados.md`)                                                                             |
| `scripts/db/`            | utilitários de banco: verificação do seed, reinicialização local e proteção contra banco remoto                                                                        |
| `src/utils/`             | utilitários puros (erros, relógio, validação Zod com detalhes por campo, datas no fuso do hospital)                                                                    |

Módulos da ET03: `modules/auth` (tipos, matriz de permissões, política de senhas, perfil da requisição), `modules/me` (E04, E05), `modules/users` (E06–E09) e `modules/audit-logs` (E41). ET04: `modules/sectors` (E10–E12), `modules/teams` (E13–E16), `modules/shifts` (E17–E19 e `shift-rules.ts`, regras de duração e fuso) e `modules/rosters` (E20, E21; leitura do CSV em `roster-csv.ts`, multer só em memória). ET05: `modules/surveys` (E22–E27). ET06: `modules/public-survey` (E01, E02). Serviços transversais novos: `services/attribution.service.ts` (RF24), `services/idempotency.ts` (RN13 e token de manifestação) e `services/nps.ts` (RN03, RN05); `utils/prisma-errors.ts` reconhece violações de UNIQUE, EXCLUDE e gatilhos em corridas. Detalhes: [`setores-escalas-e-pesquisas.md`](setores-escalas-e-pesquisas.md). O ESLint impõe as camadas (RNF21): arquivos `*.service.ts` e `src/services/` não importam `express`; `*.routes.ts`/`*.controller.ts` só importam tipos do Prisma.

## Padrões de resposta

- Sucesso: `{ "data": ... }` (listas terão `meta` com `page`, `pageSize` e `total`).
- Erro: `{ "error": { "code", "message", "details", "requestId" } }`, lançando `HttpError(status, code, message, details)`.
- Códigos já implementados: `ROUTE_NOT_FOUND` (404), `MALFORMED_JSON` (400), `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415), `RATE_LIMITED` (429, com `Retry-After`), `INTERNAL_ERROR` (500), `SERVICE_UNAVAILABLE` (503, banco ou Supabase Auth indisponível).
- ET03: `VALIDATION_ERROR` (400, com `details` por campo e sem ecoar valores), `UNAUTHENTICATED` (401), `ACCOUNT_DISABLED`, `PASSWORD_CHANGE_REQUIRED`, `FORBIDDEN`, `SECTOR_OUT_OF_SCOPE` (403), `NOT_FOUND` (404), `CONFLICT` (409, e-mail), `SELF_MODIFICATION_FORBIDDEN`, `LAST_SUPERADMIN`, `USER_INACTIVE`, `INVALID_SCOPE`, `SECTOR_INACTIVE` (422).
- ET04–ET06: `EMPTY_FILE`, `TOO_MANY_ROWS`, `ENCODING_INVALID`, `IDEMPOTENCY_KEY_INVALID` (400), `SHIFT_OVERLAP`, `SHIFT_ALREADY_CANCELLED`, `IMPORT_ALREADY_COMMITTED`, `IMPORT_EXPIRED`, `IMPORT_REJECTED`, `NO_CHANGES_TO_PUBLISH`, `SURVEY_NOT_PUBLISHED`, `IDEMPOTENCY_KEY_REUSED`, `SURVEY_VERSION_OUTDATED` (409), `SURVEY_UNAVAILABLE` (410), `FILE_TOO_LARGE` (413), `UNSUPPORTED_FILE_TYPE` (415), `TEAM_INACTIVE`, `DATE_OUT_OF_RANGE`, `FIELD_LOCKED_AFTER_PUBLICATION`, `QUESTION_LOCKED`, `QUESTION_LIMIT_REACHED`, `NPS_QUESTION_REQUIRED`, `SURVEY_INACTIVE` (422).
- JSON em camelCase; instantes em ISO 8601 UTC.

## Rotas implementadas

| ID  | Rota                                          | Acesso              | Limite          | Resposta                                                                                                                                                         |
| --- | --------------------------------------------- | ------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E43 | `GET /api/v1/health`                          | Público             | 60/min/IP       | 200 `{ data: { status, service, timestamp, uptimeSeconds } }`, `Cache-Control: no-store`; 503 `SERVICE_UNAVAILABLE` se `SELECT 1` falhar ou não responder em 2 s |
| E04 | `GET /api/v1/me`                              | Autenticado         | 300/min/perfil  | 200 perfil, setores e permissões; 401; 403 `ACCOUNT_DISABLED`                                                                                                    |
| E05 | `POST /api/v1/me/password`                    | Autenticado         | 5/15 min/perfil | 204; 400; 401; 429                                                                                                                                               |
| E06 | `GET /api/v1/admin/users`                     | SA                  | 300/min/perfil  | 200 lista paginada (até 100)                                                                                                                                     |
| E07 | `POST /api/v1/admin/users`                    | SA                  | 300/min/perfil  | 201 usuário + senha temporária; 400; 409; 422                                                                                                                    |
| E08 | `PATCH /api/v1/admin/users/:id`               | SA                  | 300/min/perfil  | 200; 400; 404; 422 `SELF_MODIFICATION_FORBIDDEN`/`LAST_SUPERADMIN`                                                                                               |
| E09 | `POST /api/v1/admin/users/:id/reset-password` | SA                  | 300/min/perfil  | 200 senha temporária; 404; 422                                                                                                                                   |
| E10 | `GET /api/v1/admin/sectors`                   | Todos adm. (escopo) | 300/min/perfil  | 200 setores com contagens                                                                                                                                        |
| E41 | `GET /api/v1/admin/audit-logs`                | SA                  | 300/min/perfil  | 200 eventos em ordem decrescente, até 100 por página; 400 período inválido                                                                                       |

Desde as ET04–ET06 também existem E01, E02 e E11–E27 (setores, equipes, etapas, turnos, importação de escala e pesquisas), com contratos em [`setores-escalas-e-pesquisas.md`](setores-escalas-e-pesquisas.md#contratos-prefixo-apiv1).

Contratos completos da ET03: [`autenticacao-e-permissoes.md`](autenticacao-e-permissoes.md#contratos-prefixo-apiv1).

Desde a ET02, a rota executa `SELECT 1` pelo Prisma com limite de 2 s (RNF27).

## Logs

JSON estruturado (pino), com `service`, `req.id`, método, caminho (sem query string), status e tempo de resposta. Não registram corpo, IP, cabeçalhos nem dados pessoais; `authorization` e `cookie` são removidos caso apareçam. Em testes, o nível é `silent`. Falhas de compensação no Supabase Auth são registradas apenas com a operação e o erro técnico.
