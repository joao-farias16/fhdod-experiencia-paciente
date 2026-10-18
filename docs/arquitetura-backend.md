# Arquitetura do backend (D03) — ET01 e ET02

Este documento descreve o que existe hoje na API e as convenções que as próximas etapas devem seguir. Ele será ampliado a cada etapa.

## Fluxo de uma requisição

```text
requisição
  → requestLogger (pino-http: X-Request-Id, log sem corpo/IP)
  → helmet (HSTS, nosniff, Referrer-Policy, CSP)
  → cors (somente CORS_ORIGIN)
  → express.json (limite de 32 KB)
  → /api/v1 (routes/v1.ts → módulos)
  → notFoundHandler (404 ROUTE_NOT_FOUND)
  → errorHandler (envelope de erro, sem stack trace)
```

## Composição

- `createApp(deps)` (`src/app.ts`) monta a aplicação a partir de dependências injetadas: `env`, `logger`, `prisma` (ET02) e `clock`. Na ET03 receberá também o verificador de token, permitindo testes sem Supabase (Seção 7). O Prisma é tipado pelo subconjunto usado (`Pick<PrismaClient, '$queryRaw'>` hoje), para que os testes HTTP injetem um dublê.
- `src/lib/prisma.ts` cria o Prisma Client 7 com o adaptador `@prisma/adapter-pg` a partir de `DATABASE_URL`. O cliente é gerado em `src/generated/prisma` (não versionado; `npm ci` o gera).
- `src/server.ts` lê `backend/.env` (se existir), valida as variáveis, cria o cliente Prisma, inicia o servidor e trata `SIGTERM`/`SIGINT` (fecha o servidor e desconecta o Prisma).
- `src/config/env.ts` valida as variáveis com Zod. Mensagens de erro citam o nome da variável, nunca o valor.

## Camadas (convenção a partir da ET02)

| Pasta                    | Responsabilidade                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `src/modules/<dominio>/` | rotas, controladores (sem regras e sem Prisma), serviços (regras e transações, sem Express), repositórios e esquemas Zod do domínio |
| `src/routes/`            | agregação das rotas por versão (`/api/v1`)                                                                                          |
| `src/middlewares/`       | middlewares transversais (logs, limites, erros e, na ET03, autenticação/autorização)                                                |
| `src/lib/`               | integrações técnicas (logger, Prisma; futuramente Supabase)                                                                         |
| `src/generated/prisma/`  | Prisma Client gerado (`prisma generate`); não versionado nem editado                                                                |
| `prisma/`                | `schema.prisma`, migrations versionadas e `seed.ts` (ver `docs/padroes-banco-de-dados.md`)                                          |
| `scripts/db/`            | utilitários de banco: verificação do seed, reinicialização local e proteção contra banco remoto                                     |
| `src/utils/`             | utilitários puros (erros, relógio)                                                                                                  |

## Padrões de resposta

- Sucesso: `{ "data": ... }` (listas terão `meta` com `page`, `pageSize` e `total`).
- Erro: `{ "error": { "code", "message", "details", "requestId" } }`, lançando `HttpError(status, code, message, details)`.
- Códigos já implementados: `ROUTE_NOT_FOUND` (404), `MALFORMED_JSON` (400), `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415), `RATE_LIMITED` (429, com `Retry-After`), `INTERNAL_ERROR` (500), `SERVICE_UNAVAILABLE` (503, banco indisponível).
- JSON em camelCase; instantes em ISO 8601 UTC.

## Rotas implementadas

| ID  | Rota                 | Acesso  | Limite    | Resposta                                                                                                                                                         |
| --- | -------------------- | ------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E43 | `GET /api/v1/health` | Público | 60/min/IP | 200 `{ data: { status, service, timestamp, uptimeSeconds } }`, `Cache-Control: no-store`; 503 `SERVICE_UNAVAILABLE` se `SELECT 1` falhar ou não responder em 2 s |

Desde a ET02, a rota executa `SELECT 1` pelo Prisma com limite de 2 s (RNF27).

## Logs

JSON estruturado (pino), com `service`, `req.id`, método, caminho (sem query string), status e tempo de resposta. Não registram corpo, IP, cabeçalhos nem dados pessoais; `authorization` e `cookie` são removidos caso apareçam. Em testes, o nível é `silent`.
