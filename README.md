# FHDOD — Sistema de Gestão da Experiência do Paciente

Aplicação web para digitalizar a coleta, a organização e a análise da experiência de pacientes e acompanhantes da **Fundação Hospitalar Dr. Oswaldo Diesel**: pesquisa pública por setor acessada por QR Code ou link, dashboard com NPS e filtros, módulo de Ouvidoria, relatórios Excel e TV Wall com indicadores agregados.

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
**ET07, ET08 e ET09 — Manifestações e Ouvidoria, dashboard e relatórios Excel**: implementadas localmente na branch `feature` (criada de `develop`; aguardando commit, push, CI remota e revisão; ver [limitações](#limitações-conhecidas-e-pendências)).

| Implementado (ET01 a ET09)                                                                     | Reservado para etapas futuras                            |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Monorepo com npm workspaces (`backend`, `frontend`)                                            | TV Wall (E42, TL15, ET10)                                |
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
| Testes E2E com Playwright (T12, administração, pesquisa pública, escalas, Ouvidoria e painel)  |                                                          |
| `.gitignore`, `.env.example` fictícios e varredura de segredos; quadro Kanban com as etapas    |                                                          |

Desde a ET02, a API conecta-se ao PostgreSQL pelo Prisma; a rota de saúde responde 503 se o banco não responder em 2 s.

## Tecnologias

| Camada    | Tecnologias (versões instaladas)                                                                                                                                                                                  |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend  | React 19.3, TypeScript 5.9, Vite 8, Tailwind CSS 4.3, React Router 8, TanStack Query 5, React Hook Form 7, supabase-js 2 (sessão), Lucide React, qrcode.react 4 (QR Code em SVG/PNG)                              |
| Backend   | Node.js 24 LTS (alvo), Express 5.3, TypeScript 5.9, Zod 4, supabase-js 2 (Supabase Auth), helmet, cors, express-rate-limit, pino / pino-http, multer 2 e csv-parse 7 (escala CSV), ExcelJS 4.4 (relatórios .xlsx) |
| Banco     | PostgreSQL 17 (Supabase CLI local), Prisma 7.10.1 (`@prisma/client`, `@prisma/adapter-pg`, `pg`), `@faker-js/faker` 10 no seed, Supabase CLI 2.121.0                                                              |
| Qualidade | ESLint 10 + typescript-eslint (strictTypeChecked), Prettier 3, Vitest 5, React Testing Library, Supertest, Playwright 1.63 (E2E), jsqr (T02), commitlint + husky                                                  |
| CI        | GitHub Actions, gitleaks 8.30.1, `npm audit`                                                                                                                                                                      |
| Previstas | Recharts, ExcelJS, OpenAPI 3.1 + Swagger UI, axe                                                                                                                                                                  |

As bibliotecas da linha "Previstas" fazem parte da especificação, mas só serão instaladas na etapa que as utilizar, para não manter dependências sem uso.

## Pré-requisitos

- **Node.js 24 LTS** (versão em `.nvmrc`; a CI usa Node 24). O projeto também foi verificado com Node 22.12+.
- **npm 10+** (instalado com o Node.js).
- **Git**.
- **Docker** (Docker Desktop no Windows) para o banco local. O Supabase CLI vem como dependência de desenvolvimento (`npx supabase`).

## Estrutura de pastas

```text
fhdod-experiencia-paciente/
├── backend/                     API REST (Express 5 + TypeScript)
│   ├── src/
│   │   ├── app.ts               createApp(deps): middlewares, rotas e erros
│   │   ├── server.ts            inicialização, leitura do .env e encerramento gracioso
│   │   ├── config/env.ts        validação das variáveis de ambiente (Zod)
│   │   ├── lib/                 logger JSON (pino), Prisma e Supabase Auth (chave secreta)
│   │   ├── middlewares/         requestId/logs, rate limit, autenticação, autorização, 404 e erros
│   │   ├── modules/             health (E43), auth, me (E04–E05), users (E06–E09), audit-logs (E41),
│   │   │                        sectors (E10–E12), teams (E13–E16), shifts (E17–E19), rosters (E20–E21),
│   │   │                        surveys (E22–E27) e public-survey (E01–E02)
│   │   ├── services/            auditoria, escopo de setores, atribuição a turno, idempotência e NPS
│   │   ├── routes/v1.ts         agregador das rotas /api/v1
│   │   └── utils/               HttpError, relógio, validação e datas
│   ├── prisma/                  schema.prisma, migrations/ (5) e seed.ts
│   ├── scripts/                 db/ (seed, reset local, proteção contra banco remoto) e e2e/ (dados dos testes E2E)
│   ├── tests/                   unit/, integration/, db/ (PostgreSQL real: T05, T12–T17, T22–T26, T32 e pesquisa pública) e supabase/ (Auth local)
│   ├── prisma.config.ts         configuração do Prisma CLI (DIRECT_URL)
│   └── .env.example
├── frontend/                    Interface (React 19 + Vite)
│   ├── src/
│   │   ├── app/                 provedores, roteador e rotas
│   │   ├── components/          layout comum e componentes de interface (ui/)
│   │   ├── features/            home, health, not-found, auth (TL01, TL02), users (TL16), audit (TL17), admin,
│   │   │                        structure (TL05–TL07), surveys (TL08) e public-survey (TL09, TL11)
│   │   ├── lib/                 env, cliente HTTP e formatação pt-BR
│   │   ├── styles/              Tailwind e tokens visuais
│   │   └── test/                configuração e apoio dos testes
│   ├── e2e/                     testes ponta a ponta (Playwright)
│   └── .env.example
├── supabase/config.toml         ambiente local (PostgreSQL 54322, Auth 54321, Data API desligada)
├── docs/                        documentação técnica e evidencias/
├── .github/                     CI e modelo de Pull Request
├── eslint.config.js             ESLint único para os dois módulos
├── tsconfig.base.json           opções TypeScript compartilhadas
└── package.json                 workspaces e scripts gerais
```

## Instalação local

```bash
git clone https://github.com/joao-farias16/fhdod-experiencia-paciente.git
cd fhdod-experiencia-paciente
npm ci
```

O `npm ci` instala as dependências dos dois módulos, gera o Prisma Client e ativa o hook `commit-msg` (husky) que valida as mensagens de commit.

### Banco de dados local (ET02)

Com o Docker em execução:

```bash
npm run db:start                      # Supabase CLI: PostgreSQL 54322, Auth 54321, Studio 54323
npx supabase status -o env            # copie SECRET_KEY para SUPABASE_SECRET_KEY no backend/.env
npm run db:migrate                    # aplica as migrations versionadas
npm run db:seed                       # dados fictícios determinísticos
npm run db:seed:verify -w backend     # confere as contagens no banco
```

`npm run db:reset` recria o banco **local** (migrations + seed) e recusa URLs remotas. Detalhes: [`docs/padroes-banco-de-dados.md`](docs/padroes-banco-de-dados.md), [`docs/modelo-de-dados.md`](docs/modelo-de-dados.md) e [`docs/mapeamento-classes-e-consultas.md`](docs/mapeamento-classes-e-consultas.md).

Contas de demonstração (somente no ambiente local, senha = `SEED_DEMO_PASSWORD` do seu `.env`): `superadmin@`, `admin.setor@`, `gestao@`, `gestao.setores@`, `ouvidoria@` e `visualizador@example.com`. Entre em `http://localhost:5173/login` (TL01); o superadministrador vai para a gestão de usuários (TL16).

O seed também publica as pesquisas dos 6 setores fictícios. A pesquisa pública abre sem login, por exemplo em `http://localhost:5173/p/pronto-atendimento?origem=qr` (como pelo QR Code) ou `?origem=link`.

> **Windows — "ports are not available" ao iniciar o Supabase.** Se `npm run db:start` falhar com `bind: An attempt was made to access a socket in a way forbidden by its access permissions` nas portas 54321–54323, o Windows reservou essa faixa (veja com `netsh interface ipv4 show excludedportrange protocol=tcp`). Em um terminal **como administrador**, execute `net stop winnat` e `net start winnat` e tente de novo.

## Variáveis de ambiente

Cada módulo tem um `.env.example` com valores fictícios. Copie e ajuste:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

| Módulo   | Variável                              | Uso                                                                                                             |
| -------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| backend  | `NODE_ENV`                            | `development`, `test` ou `production`                                                                           |
| backend  | `PORT`                                | porta da API (padrão `3333`)                                                                                    |
| backend  | `CORS_ORIGIN`                         | **obrigatória**; origens permitidas separadas por vírgula (HTTPS em produção)                                   |
| backend  | `LOG_LEVEL`                           | nível do pino (padrão `info`)                                                                                   |
| backend  | `TRUST_PROXY`                         | número de proxies confiáveis (Render = `1`)                                                                     |
| backend  | `DATABASE_URL`                        | **obrigatória** (ET02); API → PostgreSQL (nuvem: pooler transação, 6543)                                        |
| backend  | `DIRECT_URL`                          | Prisma Migrate (nuvem: pooler sessão, 5432)                                                                     |
| backend  | `TEST_DATABASE_URL`                   | testes de banco (somente servidor local)                                                                        |
| backend  | `SEED_*`                              | senha das contas de demonstração, trava de banco remoto e data de referência                                    |
| backend  | `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | **obrigatórias** (ET03): validação do token e administração das contas; seed                                    |
| backend  | `AUDIT_IP_SECRET`                     | HMAC do IP na auditoria (opcional local; obrigatória em produção, 32+)                                          |
| backend  | `PUBLIC_APP_URL`                      | base dos links e do QR Code `/p/<slug>` (padrão local `http://localhost:5173`; HTTPS e obrigatória em produção) |
| backend  | `MANIFESTATION_TOKEN_SECRET`          | HMAC do token devolvido por E02 (opcional local; obrigatória em produção, 32+)                                  |
| backend  | `SUPABASE_PUBLISHABLE_KEY`            | somente `npm run test:supabase`                                                                                 |
| frontend | `VITE_API_BASE_URL`                   | base da API (padrão `/api/v1`, encaminhado pelo Vite ao backend)                                                |
| frontend | `VITE_APP_ENV`                        | `development`, `test` ou `production`                                                                           |
| frontend | `VITE_SUPABASE_URL`                   | URL do Supabase (local: `http://127.0.0.1:54321`)                                                               |
| frontend | `VITE_SUPABASE_PUBLISHABLE_KEY`       | chave **publicável** do Supabase (a secreta é recusada pela interface)                                          |

Todas as variáveis da Tabela 15 já são lidas pela API. Sem `MANIFESTATION_TOKEN_SECRET` local, a API usa um segredo aleatório válido enquanto estiver rodando. Valores locais do Supabase: `npx supabase status -o env` (`API_URL`, `SECRET_KEY`, `PUBLISHABLE_KEY`). A API valida as variáveis na inicialização e não sobe se alguma for inválida.

**Nunca versione arquivos `.env`.** Variáveis `VITE_*` vão para o navegador: não coloque segredos no frontend.

## Execução

Em dois terminais:

```bash
npm run dev:backend    # API em http://localhost:3333 (recarrega ao salvar)
npm run dev:frontend   # Interface em http://localhost:5173
```

Em desenvolvimento, o Vite encaminha `/api` para `http://localhost:3333`, então o frontend acessa a API sem configuração extra de CORS.

Para executar a API a partir do build: `npm run build -w backend` e depois `npm run start -w backend`.

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
| Saúde                         | E43 `GET /health`                                                                                        | [`docs/arquitetura-backend.md`](docs/arquitetura-backend.md)                               |
| Perfil, usuários e auditoria  | E04–E09, E41                                                                                             | [`docs/autenticacao-e-permissoes.md`](docs/autenticacao-e-permissoes.md)                   |
| Setores, equipes e etapas     | E10–E12 `/admin/sectors`, E13–E15 `/admin/teams`, E16 `/admin/journey-stages`                            | [`docs/setores-escalas-e-pesquisas.md`](docs/setores-escalas-e-pesquisas.md)               |
| Turnos e importação de escala | E17–E19 `/admin/shifts`, E20 `POST /admin/rosters/import`, E21 `POST /admin/rosters/imports/:id/confirm` | [`docs/setores-escalas-e-pesquisas.md`](docs/setores-escalas-e-pesquisas.md)               |
| Pesquisas                     | E22–E25 `/admin/surveys`, E26 `POST /admin/surveys/:id/publish`, E27 `GET /admin/surveys/:id/qr`         | [`docs/setores-escalas-e-pesquisas.md`](docs/setores-escalas-e-pesquisas.md)               |
| Pesquisa pública (sem login)  | E01 `GET /public/surveys/:slug`, E02 `POST /public/responses` (cabeçalho `Idempotency-Key` com UUID v4)  | [`docs/setores-escalas-e-pesquisas.md`](docs/setores-escalas-e-pesquisas.md)               |
| Manifestação (sem login)      | E03 `POST /public/manifestations` (`Idempotency-Key` e token devolvido por E02)                          | [`docs/manifestacoes-dashboard-relatorios.md`](docs/manifestacoes-dashboard-relatorios.md) |
| Ouvidoria                     | E35–E38 `/ouvidoria/manifestations[/:id[/notes]]`, E39–E40 `/ouvidoria/manifestations/:id/contact`       | [`docs/manifestacoes-dashboard-relatorios.md`](docs/manifestacoes-dashboard-relatorios.md) |
| Dashboard                     | E28–E33 `/dashboard/summary`, `/sectors`, `/shifts`, `/teams`, `/trends`, `/questions`                   | [`docs/manifestacoes-dashboard-relatorios.md`](docs/manifestacoes-dashboard-relatorios.md) |
| Relatórios Excel              | E34 `GET /reports/export?type=` `responses`, `indicators` ou `manifestations`                            | [`docs/manifestacoes-dashboard-relatorios.md`](docs/manifestacoes-dashboard-relatorios.md) |

A especificação OpenAPI/Swagger (`/api/docs`) ainda não existe (prevista para a ET11/ET12).

## Qualidade: lint, typecheck, testes e build

| Comando                            | O que faz                                                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                    | executa todos os passos abaixo em sequência (igual à CI)                                                                    |
| `npm run format:check`             | verifica a formatação (Prettier); `npm run format` corrige                                                                  |
| `npm run lint`                     | ESLint sem avisos tolerados; `npm run lint:fix` corrige                                                                     |
| `npm run typecheck`                | TypeScript nos dois módulos                                                                                                 |
| `npm test`                         | testes dos dois módulos (Vitest)                                                                                            |
| `npm run test -w backend`          | testes do backend: unidade, integração e banco real (T32, T12–T26, T07–T11, T18–T21, T36, T37)                              |
| `npm run test:db -w backend`       | somente os testes com PostgreSQL (`TEST_DATABASE_URL`)                                                                      |
| `npm run test:supabase -w backend` | T12, T13 e T16 contra o Supabase Auth local (`npm run db:start`)                                                            |
| `npm run test:e2e -w frontend`     | Playwright com Chrome instalado (Supabase local; banco de teste): T12, administração, pesquisa pública, escalas e ET07–ET09 |
| `npm run test -w frontend`         | somente testes do frontend                                                                                                  |
| `npm run test:coverage -w backend` | cobertura do backend (também disponível no frontend)                                                                        |
| `npm run build`                    | build do backend (`backend/dist`) e do frontend (`frontend/dist`)                                                           |

Regras de lint relevantes para segurança: `any` explícito proibido (RNF20), `$queryRawUnsafe` proibido (RNF11), `dangerouslySetInnerHTML` proibido (Seção 10).

Os testes de banco usam `TEST_DATABASE_URL` (somente servidor local; o banco é criado e migrado automaticamente). Para usar outro PostgreSQL local sem editar o `.env`, defina a variável na linha de comando, por exemplo `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/fhdod_test npm run test -w backend` com um contêiner `postgres:17`. Se o Vitest do frontend acusar `Timeout waiting for worker to respond` em máquina sobrecarregada, rode `npx vitest run --maxWorkers=2` dentro de `frontend/`.

## Integração contínua

O workflow [`.github/workflows/ci.yml`](.github/workflows/ci.yml) roda em push e pull request para `main` e `develop`:

1. **Segredos** — gitleaks no histórico completo;
2. **Qualidade** — `npm ci`, serviço PostgreSQL 17, validação do schema, `prisma migrate deploy` em banco vazio, `prisma migrate diff --exit-code`, seed com verificação das contagens, formatação, lint, typecheck, testes (inclusive com banco real), build e verificação de `GET /api/v1/health` com o build do backend, em Node 24;
3. **Dependências** — `npm audit --audit-level=high`.

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
- [x] E2E administrativo (`frontend/e2e/escalas-e-pesquisas.spec.ts`: TL05, TL07 com turno noturno, TL06) aprovado com Supabase local
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

Detalhes das três etapas: [`docs/manifestacoes-dashboard-relatorios.md`](docs/manifestacoes-dashboard-relatorios.md). Evidências: [`docs/evidencias/ET07/`](docs/evidencias/ET07/), [`ET08/`](docs/evidencias/ET08/), [`ET09/`](docs/evidencias/ET09/) e [`docs/plano-e-relatorio-de-testes.md`](docs/plano-e-relatorio-de-testes.md).

## Limitações conhecidas e pendências

- **E2E com Supabase Auth executado em 28/10/2026:** 23/23 aprovados (`t12-autenticacao`, `administracao`, `escalas-e-pesquisas`, `pesquisa-publica` e `manifestacoes-painel-relatorios`). Se `npm run db:start` acusar porta proibida, conferir `netsh interface ipv4 show excludedportrange protocol=tcp` e liberar a faixa (ver [banco local](#banco-de-dados-local-et02)). A execução sobrescreve as capturas versionadas das etapas anteriores em `docs/evidencias/`; restaure-as com `git restore` se não quiser atualizá-las.
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

Detalhes e passo a passo das proteções: [`docs/padroes-git.md`](docs/padroes-git.md). Arquitetura da API: [`docs/arquitetura-backend.md`](docs/arquitetura-backend.md).
