# Arquitetura do backend (D03) — versão inicial da ET01

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

- `createApp(deps)` (`src/app.ts`) monta a aplicação a partir de dependências injetadas: `env`, `logger` e `clock`. Nas próximas etapas receberá também o cliente Prisma e o verificador de token, permitindo testes sem Supabase (Seção 7).
- `src/server.ts` lê `backend/.env` (se existir), valida as variáveis, inicia o servidor e trata `SIGTERM`/`SIGINT`.
- `src/config/env.ts` valida as variáveis com Zod. Mensagens de erro citam o nome da variável, nunca o valor.

## Camadas (convenção a partir da ET02)

| Pasta                    | Responsabilidade                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `src/modules/<dominio>/` | rotas, controladores (sem regras e sem Prisma), serviços (regras e transações, sem Express), repositórios e esquemas Zod do domínio |
| `src/routes/`            | agregação das rotas por versão (`/api/v1`)                                                                                          |
| `src/middlewares/`       | middlewares transversais (logs, limites, erros e, na ET03, autenticação/autorização)                                                |
| `src/lib/`               | integrações técnicas (logger; futuramente Prisma e Supabase)                                                                        |
| `src/utils/`             | utilitários puros (erros, relógio)                                                                                                  |

## Padrões de resposta

- Sucesso: `{ "data": ... }` (listas terão `meta` com `page`, `pageSize` e `total`).
- Erro: `{ "error": { "code", "message", "details", "requestId" } }`, lançando `HttpError(status, code, message, details)`.
- Códigos já implementados: `ROUTE_NOT_FOUND` (404), `MALFORMED_JSON` (400), `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415), `RATE_LIMITED` (429, com `Retry-After`), `INTERNAL_ERROR` (500).
- JSON em camelCase; instantes em ISO 8601 UTC.

## Rotas implementadas

| ID  | Rota                 | Acesso  | Limite    | Resposta                                                                                 |
| --- | -------------------- | ------- | --------- | ---------------------------------------------------------------------------------------- |
| E43 | `GET /api/v1/health` | Público | 60/min/IP | 200 `{ data: { status, service, timestamp, uptimeSeconds } }`, `Cache-Control: no-store` |

Na ET02, a rota passará a executar `SELECT 1` com limite de 2 s e responder 503 `SERVICE_UNAVAILABLE` em caso de falha.

## Logs

JSON estruturado (pino), com `service`, `req.id`, método, caminho (sem query string), status e tempo de resposta. Não registram corpo, IP, cabeçalhos nem dados pessoais; `authorization` e `cookie` são removidos caso apareçam. Em testes, o nível é `silent`.
