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

**Etapa concluída localmente: ET01 — Repositório, ambiente e Kanban** (aguardando commit, push, CI remota e revisão).

| Implementado na ET01                                                                | Reservado para etapas futuras                                |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Monorepo com npm workspaces (`backend`, `frontend`)                                 | Modelo de dados, migrations Prisma e seed (ET02)             |
| API Express 5 com `GET /api/v1/health`, segurança, logs e erros padronizados        | Autenticação Supabase, perfis e permissões (ET03)            |
| Frontend React 19 com página inicial, página 404 e situação da API                  | Setores, equipes, turnos e importação CSV (ET04)             |
| ESLint, Prettier, TypeScript strict, Vitest, commitlint                             | Pesquisas, versões e QR Code (ET05); pesquisa pública (ET06) |
| CI no GitHub Actions (gitleaks, lint, typecheck, testes, build, saúde, `npm audit`) | Manifestações e Ouvidoria (ET07); dashboard (ET08)           |
| `.gitignore`, `.env.example` fictícios e varredura de segredos                      | Relatórios Excel (ET09); TV Wall (ET10)                      |
| Quadro Kanban com os cards da ET01 e o backlog das etapas                           | OpenAPI/Swagger, E2E com Playwright, publicação (ET11–ET12)  |

A API ainda **não** se conecta ao banco de dados; por isso a rota de saúde não executa `SELECT 1` (isso entra na ET02).

## Tecnologias

| Camada    | Tecnologias (versões instaladas)                                                                                                                                  |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend  | React 19.3, TypeScript 5.9, Vite 8, Tailwind CSS 4.3, React Router 8, TanStack Query 5, Lucide React                                                              |
| Backend   | Node.js 24 LTS (alvo), Express 5.3, TypeScript 5.9, Zod 4, helmet, cors, express-rate-limit, pino / pino-http                                                     |
| Qualidade | ESLint 10 + typescript-eslint (strictTypeChecked), Prettier 3, Vitest 5, React Testing Library, Supertest, commitlint + husky                                     |
| CI        | GitHub Actions, gitleaks 8.30.1, `npm audit`                                                                                                                      |
| Previstas | PostgreSQL 17 (Supabase) e Prisma, Supabase Auth, React Hook Form, Recharts, qrcode.react, multer, csv-parse, ExcelJS, OpenAPI 3.1 + Swagger UI, Playwright + axe |

As bibliotecas da linha "Previstas" fazem parte da especificação, mas só serão instaladas na etapa que as utilizar, para não manter dependências sem uso.

## Pré-requisitos

- **Node.js 24 LTS** (versão em `.nvmrc`; a CI usa Node 24). O projeto também foi verificado com Node 22.12+.
- **npm 10+** (instalado com o Node.js).
- **Git**.
- A partir da ET02: Docker e Supabase CLI para o banco local.

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
│   ├── tests/                   unit/ e integration/ (Vitest + Supertest)
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
├── docs/                        documentação técnica
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

O `npm ci` instala as dependências dos dois módulos e ativa o hook `commit-msg` (husky) que valida as mensagens de commit.

## Variáveis de ambiente

Cada módulo tem um `.env.example` com valores fictícios. Copie e ajuste:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

| Módulo   | Variável            | Uso na ET01                                                                   |
| -------- | ------------------- | ----------------------------------------------------------------------------- |
| backend  | `NODE_ENV`          | `development`, `test` ou `production`                                         |
| backend  | `PORT`              | porta da API (padrão `3333`)                                                  |
| backend  | `CORS_ORIGIN`       | **obrigatória**; origens permitidas separadas por vírgula (HTTPS em produção) |
| backend  | `LOG_LEVEL`         | nível do pino (padrão `info`)                                                 |
| backend  | `TRUST_PROXY`       | número de proxies confiáveis (Render = `1`)                                   |
| frontend | `VITE_API_BASE_URL` | base da API (padrão `/api/v1`, encaminhado pelo Vite ao backend)              |
| frontend | `VITE_APP_ENV`      | `development`, `test` ou `production`                                         |

As demais variáveis da Tabela 15 (`DATABASE_URL`, `SUPABASE_SECRET_KEY`, `MANIFESTATION_TOKEN_SECRET` etc.) aparecem comentadas nos exemplos e só serão lidas nas etapas correspondentes. A API valida as variáveis na inicialização e não sobe se alguma for inválida.

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
| `npm run test -w backend`          | somente testes do backend                                         |
| `npm run test -w frontend`         | somente testes do frontend                                        |
| `npm run test:coverage -w backend` | cobertura do backend (também disponível no frontend)              |
| `npm run build`                    | build do backend (`backend/dist`) e do frontend (`frontend/dist`) |

Regras de lint relevantes para segurança: `any` explícito proibido (RNF20), `$queryRawUnsafe` proibido (RNF11), `dangerouslySetInnerHTML` proibido (Seção 10).

## Integração contínua

O workflow [`.github/workflows/ci.yml`](.github/workflows/ci.yml) roda em push e pull request para `main` e `develop`:

1. **Segredos** — gitleaks no histórico completo;
2. **Qualidade** — `npm ci`, formatação, lint, typecheck, testes, build e verificação de `GET /api/v1/health` com o build do backend, em Node 24;
3. **Dependências** — `npm audit --audit-level=high`.

PostgreSQL 17, `prisma migrate deploy` e `migrate diff` serão incluídos na ET02, quando houver migrations.

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

## Branches e colaboração

- `main`: versão publicada; `develop`: integração. Ambas protegidas (Pull Request, CI aprovada e aprovação do outro integrante).
- Trabalho em `feature/<id>-<descricao>`, `fix/<id>-<descricao>` ou `docs/<descricao>`, sempre a partir de `develop`.
- Commits no padrão **Conventional Commits** em português (`feat`, `fix`, `docs`, `test`, `refactor`, `style`, `chore`, `ci`, `build`, `perf`), validados pelo commitlint.
- No quadro, no máximo **2 itens "Em andamento" por pessoa**.

Detalhes e passo a passo das proteções: [`docs/padroes-git.md`](docs/padroes-git.md). Arquitetura da API: [`docs/arquitetura-backend.md`](docs/arquitetura-backend.md).
