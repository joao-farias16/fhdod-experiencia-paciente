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
- Links da aplicação publicada, da documentação da API (Swagger) e do Figma serão adicionados quando existirem (ET12 e ET13).

## Estado atual

**ET01 — Repositório, ambiente e Kanban**: integrada em `develop`.
**ET02 — Modelo de dados**: implementada localmente na branch `feature/ET02-modelo-dados` (aguardando commit, push, CI remota e revisão).

| Implementado (ET01 e ET02)                                                            | Reservado para etapas futuras                                |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Monorepo com npm workspaces (`backend`, `frontend`)                                   | Autenticação Supabase, perfis e permissões (ET03)            |
| API Express 5 com `GET /api/v1/health` (com `SELECT 1`), segurança, logs e erros      | Endpoints de negócio das etapas ET03–ET10                    |
| **ET02:** Prisma 7, 18 tabelas, 5 migrations, CHECK/EXCLUDE/gatilhos, RLS, seed e T32 | Backup e retenção (scripts), OpenAPI                         |
| Frontend React 19 com página inicial, página 404 e situação da API                    | Setores, equipes, turnos e importação CSV (ET04)             |
| ESLint, Prettier, TypeScript strict, Vitest, commitlint                               | Pesquisas, versões e QR Code (ET05); pesquisa pública (ET06) |
| CI no GitHub Actions (gitleaks, lint, typecheck, testes, build, saúde, `npm audit`)   | Manifestações e Ouvidoria (ET07); dashboard (ET08)           |
| `.gitignore`, `.env.example` fictícios e varredura de segredos                        | Relatórios Excel (ET09); TV Wall (ET10)                      |
| Quadro Kanban com os cards da ET01 e o backlog das etapas                             | OpenAPI/Swagger, E2E com Playwright, publicação (ET11–ET12)  |

Desde a ET02, a API conecta-se ao PostgreSQL pelo Prisma; a rota de saúde responde 503 se o banco não responder em 2 s.

## Tecnologias

| Camada    | Tecnologias (versões instaladas)                                                                                                                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend  | React 19.3, TypeScript 5.9, Vite 8, Tailwind CSS 4.3, React Router 8, TanStack Query 5, Lucide React                                                 |
| Backend   | Node.js 24 LTS (alvo), Express 5.3, TypeScript 5.9, Zod 4, helmet, cors, express-rate-limit, pino / pino-http                                        |
| Banco     | PostgreSQL 17 (Supabase CLI local), Prisma 7.10.1 (`@prisma/client`, `@prisma/adapter-pg`, `pg`), `@faker-js/faker` 10 no seed, Supabase CLI 2.121.0 |
| Qualidade | ESLint 10 + typescript-eslint (strictTypeChecked), Prettier 3, Vitest 5, React Testing Library, Supertest, commitlint + husky                        |
| CI        | GitHub Actions, gitleaks 8.30.1, `npm audit`                                                                                                         |
| Previstas | Supabase Auth (cliente), React Hook Form, Recharts, qrcode.react, multer, csv-parse, ExcelJS, OpenAPI 3.1 + Swagger UI, Playwright + axe             |

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
│   │   ├── lib/logger.ts        logger JSON (pino)
│   │   ├── middlewares/         requestId/logs, rate limit, 404 e erros
│   │   ├── modules/health/      E43 — GET /api/v1/health
│   │   ├── routes/v1.ts         agregador das rotas /api/v1
│   │   └── utils/               HttpError e relógio injetável
│   ├── prisma/                  schema.prisma, migrations/ (5) e seed.ts
│   ├── scripts/db/              verificação do seed, reset local e proteção contra banco remoto
│   ├── tests/                   unit/, integration/ (Supertest) e db/ (PostgreSQL real, T32)
│   ├── prisma.config.ts         configuração do Prisma CLI (DIRECT_URL)
│   └── .env.example
├── frontend/                    Interface (React 19 + Vite)
│   ├── src/
│   │   ├── app/                 provedores, roteador e rotas
│   │   ├── components/          layout comum
│   │   ├── features/            home, health (situação da API), not-found
│   │   ├── lib/                 env, cliente HTTP e formatação pt-BR
│   │   ├── styles/              Tailwind e tokens visuais
│   │   └── test/                configuração dos testes
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

Contas de demonstração (somente no ambiente local, senha = `SEED_DEMO_PASSWORD` do seu `.env`): `superadmin@`, `admin.setor@`, `gestao@`, `gestao.setores@`, `ouvidoria@` e `visualizador@example.com`.

## Variáveis de ambiente

Cada módulo tem um `.env.example` com valores fictícios. Copie e ajuste:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

| Módulo   | Variável                              | Uso                                                                           |
| -------- | ------------------------------------- | ----------------------------------------------------------------------------- |
| backend  | `NODE_ENV`                            | `development`, `test` ou `production`                                         |
| backend  | `PORT`                                | porta da API (padrão `3333`)                                                  |
| backend  | `CORS_ORIGIN`                         | **obrigatória**; origens permitidas separadas por vírgula (HTTPS em produção) |
| backend  | `LOG_LEVEL`                           | nível do pino (padrão `info`)                                                 |
| backend  | `TRUST_PROXY`                         | número de proxies confiáveis (Render = `1`)                                   |
| backend  | `DATABASE_URL`                        | **obrigatória** (ET02); API → PostgreSQL (nuvem: pooler transação, 6543)      |
| backend  | `DIRECT_URL`                          | Prisma Migrate (nuvem: pooler sessão, 5432)                                   |
| backend  | `TEST_DATABASE_URL`                   | testes de banco (somente servidor local)                                      |
| backend  | `SEED_*`                              | senha das contas de demonstração, trava de banco remoto e data de referência  |
| backend  | `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | seed (contas de demonstração); autenticação a partir da ET03                  |
| frontend | `VITE_API_BASE_URL`                   | base da API (padrão `/api/v1`, encaminhado pelo Vite ao backend)              |
| frontend | `VITE_APP_ENV`                        | `development`, `test` ou `production`                                         |

As demais variáveis da Tabela 15 (`PUBLIC_APP_URL`, `MANIFESTATION_TOKEN_SECRET`, `AUDIT_IP_SECRET` e as `VITE_SUPABASE_*`) aparecem comentadas nos exemplos e só serão lidas nas etapas correspondentes. A API valida as variáveis na inicialização e não sobe se alguma for inválida.

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

## Qualidade: lint, typecheck, testes e build

| Comando                            | O que faz                                                         |
| ---------------------------------- | ----------------------------------------------------------------- |
| `npm run check`                    | executa todos os passos abaixo em sequência (igual à CI)          |
| `npm run format:check`             | verifica a formatação (Prettier); `npm run format` corrige        |
| `npm run lint`                     | ESLint sem avisos tolerados; `npm run lint:fix` corrige           |
| `npm run typecheck`                | TypeScript nos dois módulos                                       |
| `npm test`                         | testes dos dois módulos (Vitest)                                  |
| `npm run test -w backend`          | testes do backend: unidade, integração e banco real (T32)         |
| `npm run test:db -w backend`       | somente os testes com PostgreSQL (`TEST_DATABASE_URL`)            |
| `npm run test -w frontend`         | somente testes do frontend                                        |
| `npm run test:coverage -w backend` | cobertura do backend (também disponível no frontend)              |
| `npm run build`                    | build do backend (`backend/dist`) e do frontend (`frontend/dist`) |

Regras de lint relevantes para segurança: `any` explícito proibido (RNF20), `$queryRawUnsafe` proibido (RNF11), `dangerouslySetInnerHTML` proibido (Seção 10).

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

## Branches e colaboração

- `main`: versão publicada; `develop`: integração. Ambas protegidas (Pull Request, CI aprovada e aprovação do outro integrante).
- Trabalho em `feature/<id>-<descricao>`, `fix/<id>-<descricao>` ou `docs/<descricao>`, sempre a partir de `develop`.
- Commits no padrão **Conventional Commits** em português (`feat`, `fix`, `docs`, `test`, `refactor`, `style`, `chore`, `ci`, `build`, `perf`), validados pelo commitlint.
- No quadro, no máximo **2 itens "Em andamento" por pessoa**.

Detalhes e passo a passo das proteções: [`docs/padroes-git.md`](docs/padroes-git.md). Arquitetura da API: [`docs/arquitetura-backend.md`](docs/arquitetura-backend.md).
