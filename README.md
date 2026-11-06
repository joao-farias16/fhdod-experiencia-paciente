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
**Etapa 2 do novo cronograma — Separação definitiva do backend e do frontend**: integrada em `develop` (PR #34). A API fica na raiz do repositório; o frontend é mantido em repositório próprio (veja [Organização do repositório](#organização-do-repositório)).
**Etapa 3 do novo cronograma — Migração completa do banco para MySQL**: integrada em `develop` e `main` (PR #35, 05/11/2026; CI aprovada em ambas as branches). Prisma, Supabase (PostgreSQL e Auth) e PostgreSQL foram **substituídos por MySQL 8.4 LTS** com SQL parametrizado (driver `mysql2`, sem ORM) e **autenticação própria** (bcrypt + JWT + sessões no banco). Rotas, contratos JSON, códigos HTTP e permissões foram preservados; foram acrescentados os endpoints de login, renovação e logout (E44–E46), antes feitos pelo frontend direto no Supabase Auth. Detalhes: [`database/README.md`](database/README.md), [`docs/modelo-de-dados.md`](docs/modelo-de-dados.md) e [`docs/autenticacao-e-permissoes.md`](docs/autenticacao-e-permissoes.md).

Todas as etapas acima chegaram a `main` por Pull Request (#29 a #35). Situação conferida no GitHub em 05/11/2026: a CI do último commit (`a5ff57b`) passou em `main` e em `develop`; os PRs não têm revisão de aprovação registrada; `main` e `develop` **não têm proteção de branch** configurada (veja [`docs/padroes-git.md`](docs/padroes-git.md)).

| Implementado (ET01 a ET09)                                                                      | Reservado para etapas futuras                            |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| API na raiz; frontend em repositório próprio (comunicação só por HTTP)                          | TV Wall (E42, TL15, ET10)                                |
| **ET03:** autenticação, E04–E10 e E41, matriz da Seção 6, escopo e auditoria                    | Conferência das telas com o Figma (revisão)              |
| **ET03:** telas de login, troca de senha, usuários e auditoria (TL01, TL02, TL16, TL17)         |                                                          |
| **ET04:** setores, equipes, etapas, turnos e importação de escala CSV (E10–E21; TL05–TL07)      | Backup e retenção (scripts), OpenAPI/Swagger (ET11–ET12) |
| **ET04:** atribuição de avaliações a turno e equipe (RF24)                                      | E2E com axe em todas as telas (ET11)                     |
| **ET05:** pesquisas, perguntas, versões imutáveis, link, QR Code e cartaz (E16, E22–E27; TL08)  | Publicação na nuvem (ET12)                               |
| **ET06:** pesquisa pública por link/QR Code com envio idempotente (E01, E02; TL09, TL11)        |                                                          |
| **ET07:** manifestação após a avaliação, anonimato, contato e protocolo (E03; TL10)             |                                                          |
| **ET07:** Ouvidoria: lista, detalhe, status, notas e contato auditado (E35–E40; TL12, TL13)     |                                                          |
| **ET08:** painel geral e por setor com filtros, supressão e comparação (E28–E33; TL03, TL04)    |                                                          |
| **ET09:** relatórios Excel de respostas, indicadores e manifestações (E34; TL14)                |                                                          |
| API Express 5 com `GET /api/v1/health` (com `SELECT 1`), segurança, logs e erros                |                                                          |
| **Etapa 3:** MySQL 8.4, 21 tabelas, 5 migrations SQL, CHECK, gatilhos, seed, T32 e auth própria |                                                          |
| ESLint, Prettier, TypeScript strict, Vitest, commitlint                                         |                                                          |
| CI no GitHub Actions (gitleaks, lint, typecheck, testes, build, saúde, `npm audit`)             |                                                          |
| Testes E2E com Playwright (no repositório do frontend; dados preparados por `e2e:fixture`)      |                                                          |
| `.gitignore`, `.env.example` fictícios e varredura de segredos; quadro Kanban com as etapas     |                                                          |

Desde a Etapa 3, a API conecta-se ao **MySQL** por um pool do `mysql2` (SQL puro e parametrizado, sem ORM); a rota de saúde responde 503 se o banco não responder em 2 s. Até a Etapa 2 o projeto usava Prisma + PostgreSQL (Supabase) e Supabase Auth — esse histórico está nos documentos das etapas e em `docs/evidencias/`.

## Tecnologias

| Camada    | Tecnologias (versões instaladas)                                                                                                                                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend   | Node.js 24 LTS (alvo), Express 5.3, TypeScript 5.9, Zod 4, bcryptjs 3 (hash de senhas), JWT HS256 (node:crypto), helmet, cors, express-rate-limit, pino / pino-http, multer 2 e csv-parse 7 (escala CSV), ExcelJS 4.4 (relatórios .xlsx) |
| Banco     | **MySQL 8.4 LTS** (administrável pelo MySQL Workbench), driver `mysql2` 3 (pool, SQL parametrizado, sem ORM), migrations SQL versionadas em `database/`, `@faker-js/faker` 10 no seed de demonstração                                    |
| Qualidade | ESLint 10 + typescript-eslint (strictTypeChecked), Prettier 3, Vitest 5, Supertest, commitlint + husky                                                                                                                                   |
| CI        | GitHub Actions, gitleaks 8.30.1, `npm audit`                                                                                                                                                                                             |
| Previstas | Recharts, OpenAPI 3.1 + Swagger UI, axe                                                                                                                                                                                                  |

As bibliotecas da linha "Previstas" fazem parte da especificação, mas só serão instaladas na etapa que as utilizar, para não manter dependências sem uso.

## Pré-requisitos

- **Node.js 24 LTS** (versão em `.nvmrc`; a CI usa Node 24). O projeto também foi verificado com Node 22.12+.
- **npm 10+** (instalado com o Node.js).
- **Git**.
- **MySQL Server 8.4 LTS** (recomendado; 8.0.16 ou mais recente também atende) e, para administrar, o **MySQL Workbench**. Alternativa: Docker com a imagem `mysql:8.4`.

## Organização do repositório

Desde a **Etapa 2 do novo cronograma (separação definitiva)**, este repositório é **dedicado à API (backend)**, que fica na raiz: há um único `package.json`, com as dependências e os scripts da API (endereço local `http://localhost:3333`; documentação neste README e em [`docs/`](docs/)). A interface web não faz parte deste repositório: é mantida em repositório próprio, com dependências, configurações, documentação e CI próprias.

A API e o frontend se comunicam **somente por HTTP**: o frontend chama os endpoints `/api/v1` (inclusive o login, `POST /api/v1/auth/login`), e a API libera a origem do frontend pelo CORS (`CORS_ORIGIN`). O frontend não importa código da API nem acessa o banco.

## Estrutura de pastas

O backend é organizado **por domínio** (`auth`, `users`, `audit`, `sectors`, `shifts`, `surveys`, `public-survey`, `manifestations`, `dashboard`, `reports`), com uma camada pequena de código compartilhado. Detalhes e convenções: [`docs/arquitetura.md`](docs/arquitetura.md).

```text
fhdod-experiencia-paciente/      repositório da API (backend na raiz)
├── src/
│   ├── server.ts                inicialização do processo (.env, ambiente, pool MySQL, HTTP)
│   ├── app.ts                   createApp(deps): middlewares globais, CORS, /api/v1, 404 e erros
│   ├── routes.ts                agregador de /api/v1 (cadeias pública, autenticada e /admin)
│   ├── lib/                     infraestrutura: env, logger, database (pool mysql2), sql (template
│   │                            parametrizado) e domain-types (ENUMs do modelo)
│   ├── middlewares/             request-logger, rate-limit e error-handler (inclui o 404)
│   ├── modules/<domínio>/       *.routes.ts (rotas e controladores), *.schemas.ts (Zod),
│   │                            *.service.ts (regras e transações), *.repository.ts (SQL)
│   └── utils/                   funções puras: errors, validation, dates, idempotency
├── database/                    banco MySQL: create_database.sql, schema.sql (gerado),
│                                migrations/, seeds/, seguranca/ e README (MySQL Workbench)
├── scripts/                     db/ (migrations, seed, verificação, reset local, primeiro admin) e
│                                e2e/ (dados fictícios da E2E executada pelo repositório do frontend)
├── tests/                       unit/, integration/, db/ (MySQL real) e support/
├── certs/ca.pem                 certificado público da autoridade (CA) do MySQL na nuvem (usado
│                                via DB_SSL_CA; não é segredo)
├── docs/                        documentação técnica e evidencias/ (por etapa)
├── .github/                     CI da API e modelo de Pull Request
├── package.json · package-lock.json   dependências e scripts da API
├── tsconfig.json · tsconfig.build.json · vitest.config.ts
├── eslint.config.js · .prettierrc.json · commitlint.config.js · .husky/
├── .env.example                 variáveis da API (o .env real não é versionado)
└── README.md
```

`dist/` (builds), `coverage/`, `playwright-report/`, `test-results/` e `database/seeds/gerado/` (seed exportado) são gerados e não versionados.

## Instalação da API

```bash
git clone https://github.com/joao-farias16/fhdod-experiencia-paciente.git
cd fhdod-experiencia-paciente
npm ci
cp .env.example .env      # depois preencha DB_USER, DB_PASSWORD e JWT_SECRET
```

O `npm ci` instala as dependências da API e ativa o hook `commit-msg` (husky) que valida as mensagens de commit. Não há cliente gerado nem passo de "generate".

### Banco de dados MySQL (Etapa 3)

Passo a passo completo, inclusive pelo **MySQL Workbench**: [`database/README.md`](database/README.md). Resumo pela linha de comando, na raiz do repositório (MySQL rodando e `.env` preenchido):

```bash
npm run db:create          # cria o banco DB_NAME (utf8mb4_0900_as_cs), se não existir
npm run db:migrate         # aplica database/migrations/*.sql pendentes
npm run db:migrate:status  # aplicadas, pendentes e conferência de checksum
npm run db:seed            # dados fictícios de demonstração (exige SEED_DEMO_PASSWORD)
npm run db:seed:verify     # confere as contagens no banco
```

Pelo **MySQL Workbench**: execute `database/create_database.sql`, depois `database/schema.sql` (todas as tabelas, chaves, índices, restrições e gatilhos) e, para uma instalação real, `database/seeds/001_dados_base.sql` seguido de `npm run db:create-admin` (primeiro superadministrador). O seed de demonstração também pode ser gerado como `.sql` para importar no Workbench: `npm run db:seed:export`.

`npm run db:reset` apaga e recria o banco **local** (migrations + seed) e recusa servidor remoto. Detalhes: [`docs/padroes-banco-de-dados.md`](docs/padroes-banco-de-dados.md), [`docs/modelo-de-dados.md`](docs/modelo-de-dados.md) e [`docs/mapeamento-classes-e-consultas.md`](docs/mapeamento-classes-e-consultas.md).

Contas de demonstração (somente no ambiente local, senha = `SEED_DEMO_PASSWORD` do seu `.env`): `superadmin@`, `admin.setor@`, `gestao@`, `gestao.setores@`, `ouvidoria@` e `visualizador@example.com`. O login é feito em `POST /api/v1/auth/login` (usado pelo frontend, mantido em repositório próprio).

O seed também publica as pesquisas dos 6 setores fictícios. Na API, a pesquisa pública responde sem login, por exemplo em `GET http://localhost:3333/api/v1/public/surveys/pronto-atendimento` (E01).

## Variáveis de ambiente da API

O `.env` fica na **raiz** do repositório (copiado de `.env.example`, que tem só valores fictícios).

| Variável                       | Uso                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                     | `development`, `test` ou `production`                                                                                                 |
| `PORT`                         | porta da API (padrão `3333`)                                                                                                          |
| `CORS_ORIGIN`                  | **obrigatória**; origens do frontend permitidas, separadas por vírgula (local `http://localhost:5173`; HTTPS em produção)             |
| `LOG_LEVEL`                    | nível do pino (padrão `info`)                                                                                                         |
| `TRUST_PROXY`                  | número de proxies confiáveis (Render = `1`)                                                                                           |
| `DB_HOST`, `DB_PORT`           | servidor MySQL (padrão `localhost:3306`)                                                                                              |
| `DB_USER`, `DB_PASSWORD`       | **`DB_USER` obrigatória**; senha obrigatória em produção (use o usuário de privilégio mínimo de `database/seguranca/usuarios.sql`)    |
| `DB_NAME`                      | nome do banco (padrão `fhdod`)                                                                                                        |
| `DB_CONNECTION_LIMIT`          | tamanho do pool de conexões (padrão `10`)                                                                                             |
| `DB_SSL`, `DB_SSL_CA`          | TLS para o MySQL na nuvem (`true`) e **caminho** do certificado da autoridade (PEM), se o provedor exigir (ex.: `certs/ca.pem`)       |
| `TEST_DB_NAME`, `TEST_DB_*`    | banco dos testes (padrão `fhdod_test`; recriado a cada `npm test`; somente servidor local e nunca igual a `DB_NAME`)                  |
| `JWT_SECRET`                   | **obrigatória** (Etapa 3): assinatura HS256 dos tokens de acesso, 32+ caracteres, somente no backend                                  |
| `JWT_ACCESS_TOKEN_TTL_SECONDS` | validade do token de acesso (padrão `3600`)                                                                                           |
| `REFRESH_TOKEN_TTL_DAYS`       | validade da sessão sem renovação (padrão `7`)                                                                                         |
| `BCRYPT_ROUNDS`                | custo do bcrypt (padrão `12`; mínimo `10` em produção)                                                                                |
| `SEED_*`                       | senha das contas de demonstração, trava de servidor remoto e data de referência                                                       |
| `AUDIT_IP_SECRET`              | HMAC do IP na auditoria e nas sessões (opcional local; obrigatória em produção, 32+)                                                  |
| `PUBLIC_APP_URL`               | endereço do frontend: base dos links e do QR Code `/p/<slug>` (padrão local `http://localhost:5173`; HTTPS e obrigatória em produção) |
| `MANIFESTATION_TOKEN_SECRET`   | HMAC do token devolvido por E02 (opcional local; obrigatória em produção, 32+)                                                        |

Sem `MANIFESTATION_TOKEN_SECRET` local, a API usa um segredo aleatório válido enquanto estiver rodando. A API valida as variáveis na inicialização e não sobe se alguma for inválida (as mensagens nunca mostram os valores). As antigas `DATABASE_URL`, `DIRECT_URL`, `TEST_DATABASE_URL` e `SUPABASE_*` não são mais lidas.

**Nunca versione arquivos `.env`** (o `.gitignore` só aceita `.env.example`). `JWT_SECRET` e as senhas existem somente na API.

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
| Autenticação (Etapa 3)        | E44 `POST /auth/login`, E45 `POST /auth/refresh`, E46 `POST /auth/logout`                                | [`docs/autenticacao-e-permissoes.md`](docs/autenticacao-e-permissoes.md)                   |
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

| Comando                 | O que faz                                                                                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`         | formatação, lint, typecheck, conferência do `schema.sql`, testes e build em sequência                                                                                             |
| `npm run format:check`  | verifica a formatação (Prettier); `npm run format` corrige                                                                                                                        |
| `npm run lint`          | ESLint sem avisos tolerados (inclui as regras de camadas e de SQL parametrizado); `npm run lint:fix` corrige                                                                      |
| `npm run typecheck`     | TypeScript (`src`, `tests`, `scripts`)                                                                                                                                            |
| `npm test`              | projetos `unidade-e-integracao` e `banco`: unidade, integração e MySQL real (T32, T12–T26, T07–T11, T18–T21, T36, T37)                                                            |
| `npm run test:db`       | somente o projeto `banco` (MySQL, banco `TEST_DB_NAME` recriado e migrado automaticamente)                                                                                        |
| `npm run test:coverage` | cobertura da API                                                                                                                                                                  |
| `npm run build`         | build da API em `dist/` (`npm start` executa o build)                                                                                                                             |
| `npm run db:*`          | banco: `create`, `migrate`, `migrate:status`, `migration:new`, `schema`, `schema:check`, `seed`, `seed:export`, `seed:verify`, `reset`, `create-admin` (ver `database/README.md`) |
| `npm run dev:no-watch`  | API sem recarga automática (usado pela E2E do frontend, em repositório próprio; no dia a dia, prefira `npm run dev`)                                                              |
| `npm run e2e:fixture`   | cria/encerra os dados fictícios da E2E do frontend no banco de teste (acionado pela E2E do frontend)                                                                              |

Regras de lint relevantes para segurança: `any` explícito proibido (RNF20); em `src/`, SQL montado por interpolação de template literal em `query`/`execute` é proibido — use o template `sql` parametrizado (RNF11); rotas não importam a camada de banco (RNF21).

Os testes de banco usam `TEST_DB_*` (cada variável vazia usa a `DB_*` correspondente; o banco padrão é `fhdod_test`). O banco de testes é **apagado e recriado** a cada execução — por isso só é aceito servidor local e nunca o mesmo `DB_NAME`. Para usar um MySQL em Docker sem editar o `.env`: `docker run -d --name fhdod-mysql-test -p 127.0.0.1:33306:3306 -e MYSQL_ROOT_PASSWORD=senha mysql:8.4` e `TEST_DB_PORT=33306 TEST_DB_USER=root TEST_DB_PASSWORD=senha npm test`.

## Integração contínua

O workflow [`.github/workflows/ci.yml`](.github/workflows/ci.yml) roda em push e pull request para `main` e `develop`:

1. **Segredos** — gitleaks no histórico completo;
2. **API** — `npm ci` na raiz, serviço **MySQL 8.4**, conferência do `database/schema.sql`, `db:create` + `db:migrate` em banco vazio, importação do `schema.sql` num banco novo (mesmo fluxo do Workbench), seed com verificação das contagens, formatação, lint, typecheck, testes (inclusive com MySQL real), build e verificação de `GET /api/v1/health` e do login com o build, em Node 24;
3. **Dependências** — `npm audit --audit-level=high` com o `package.json` e o `package-lock.json` da raiz (API).

## Publicação e infraestrutura

O repositório **não contém configuração de hospedagem da API** (nenhum `Dockerfile`, `render.yaml`, `Procfile` ou workflow de deploy); a publicação oficial está prevista para a ET12. O que existe hoje:

- **Build e execução:** `npm ci`, `npm run build` e `npm start` (`node dist/server.js`), com Node.js 24 (`.nvmrc`; `engines` aceita 22.12+). A API escuta em `PORT` e expõe tudo sob `/api/v1`.
- **Exigências de produção** (validadas na inicialização, `src/lib/env.ts`): `NODE_ENV=production`, `CORS_ORIGIN` e `PUBLIC_APP_URL` com `https://`, `DB_PASSWORD` preenchida, `AUDIT_IP_SECRET`, `MANIFESTATION_TOKEN_SECRET` e `JWT_SECRET` com 32+ caracteres e `BCRYPT_ROUNDS` ≥ 10. Atrás de proxy reverso, ajuste `TRUST_PROXY`.
- **Banco na nuvem:** `DB_SSL=true` (TLS 1.2+ com verificação do certificado) e `DB_SSL_CA=certs/ca.pem` quando o provedor usa autoridade própria. O certificado foi adicionado em `a5ff57b` (e o `*.pem` saiu do `.gitignore`); o provedor e o servidor a que ele corresponde **não estão registrados no repositório**. Banco criado por `database/create_database.sql` + `npm run db:migrate` (ou `schema.sql`), usuário `fhdod_app` de `database/seguranca/usuarios.sql`, seed base e `npm run db:create-admin`.
- **Frontend:** repositório próprio ([`fhdod-frontend`](https://github.com/joao-farias16/fhdod-frontend)), com `vercel.json` (fallback de SPA). Para a integração, o endereço público do frontend vai em `CORS_ORIGIN` e `PUBLIC_APP_URL` da API, e o da API em `VITE_API_URL` do frontend.

## ET01 — Repositório, ambiente e Kanban

Critério de conclusão (Tabela 27): estrutura, CI, proteções e serviços sem cobrança; **um clone limpo passa no lint e no typecheck**.

- [x] Estrutura inicial, frontend e backend executáveis, rota de saúde
- [x] Lint, typecheck, testes e builds passando localmente (inclusive em cópia limpa, com Node 22 e Node 24)
- [x] `.gitignore`, `.env.example` e varredura de segredos sem achados
- [x] Workflow de CI preparado
- [x] Quadro Kanban configurado com os cards da ET01
- [x] Commit, push e Pull Request (PR #29)
- [x] CI executada no GitHub (execuções aprovadas em `main` e `develop`)
- [x] Felipe incluído como colaborador do repositório
- [ ] Proteção de `main` e `develop` — **não configurada** (conferido em 05/11/2026)
- [ ] Revisão do Felipe (nenhuma aprovação registrada nos PRs)

Evidências: [`docs/plano-e-relatorio-de-testes.md`](docs/plano-e-relatorio-de-testes.md).

## ET02 — Modelo de dados

Critério de conclusão (Tabela 27): migrations, seed; **contagens do seed e T32 aprovados**.

> Implementada com Prisma 7 + PostgreSQL; na Etapa 3 o mesmo modelo (tabelas, chaves, restrições e gatilhos) foi recriado em MySQL 8.4 — ver [`docs/modelo-de-dados.md`](docs/modelo-de-dados.md).

- [x] Prisma 7 configurado e integrado ao backend (`DATABASE_URL`, saúde com `SELECT 1`)
- [x] 18 tabelas, 11 enums, FKs compostas, CHECK, UQ parciais, EXCLUDE, gatilhos, sequência do protocolo
- [x] RLS sem políticas e privilégios de `anon`/`authenticated` revogados; Data API desligada no ambiente local
- [x] 5 migrations reconstroem o banco vazio; `migrate diff` sem diferenças (Supabase local e PostgreSQL 17 puro)
- [x] Seed determinístico com contagens verificadas no banco (1/6/18/4/6/2.400/180/72/6)
- [x] T32 com os 6 cenários aprovados contra PostgreSQL real (e teste de mutação comprovando a detecção); repetido contra MySQL 8.4 na Etapa 3
- [x] Commit, push e Pull Request (integrado em `main`)
- [ ] Revisão do Felipe
- ~~Data API do projeto Supabase remoto desligada no painel e migrations aplicadas na nuvem~~ (obsoleto desde a Etapa 3: o banco passou a ser MySQL)

Evidências: [`docs/evidencias/ET02/`](docs/evidencias/ET02/) e [`docs/plano-e-relatorio-de-testes.md`](docs/plano-e-relatorio-de-testes.md).

## ET03 — Autenticação e permissões

Critério de conclusão (Tabela 27): **E04–E09, E41, TL01, TL02, TL16, TL17; T12–T17**.

> Implementada com Supabase Auth; na Etapa 3 substituída por autenticação própria (bcrypt, JWT e sessões no MySQL), com as mesmas regras de acesso.

- [x] Login no Supabase Auth, validação do token a cada requisição, perfil/escopo/permissões no E04, logout com revogação
- [x] E05 (troca de senha), E06–E09 (usuários, escopo, desativação, redefinição assistida com senha temporária CSPRNG)
- [x] E41 (auditoria) e auditoria na mesma transação das operações; negativas de autorização auditadas
- [x] Matriz da Seção 6 no backend; escopo por setor nas consultas (403/404)
- [x] TL01, TL02, TL16 e TL17 integradas à API
- [x] T12–T17 executados (integração com PostgreSQL real, Supabase Auth local, componentes e E2E); na Etapa 3, a parte da API foi repetida contra MySQL com a autenticação própria
- [x] Commit, push e Pull Request (PR #30, integrado em `main`)
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
- [x] E2E administrativo (`e2e/escalas-e-pesquisas.spec.ts`, hoje no repositório do frontend: TL05, TL07 com turno noturno, TL06) aprovado com Supabase local (antes da Etapa 3)
- [x] Commit, push e Pull Request (integrado em `main`)
- [ ] Revisão do João (responsável da etapa: Felipe)

## ET05 — Pesquisas

Critério de conclusão (Tabela 27): **E16, E22–E27, TL08; T02, T26**.

- [x] Criação em rascunho com a pergunta geral automática; edição de textos; perguntas específicas com etapa, ordem e ativação
- [x] Bloqueios: setor, slug e pergunta geral após a 1ª publicação; pergunta publicada imutável; limite de 10 específicas ativas
- [x] Publicação de versões imutáveis com instantâneos, histórico com autor, desativação e reativação; 409 sem alterações
- [x] Link e QR Code com `origem=qr`/`origem=link`, exportação PNG e SVG e cartaz A4 (TL08)
- [x] T26 aprovado na integração; URLs exatas do T02 verificadas na integração
- [x] T02 no E2E: TL08 publicada; os arquivos PNG e SVG baixados decodificam (jsqr) para a URL exata com `origem=qr`, que abre a pesquisa e registra a resposta
- [ ] Leitura do cartaz com a câmera de um celular (parte manual do T02) — **não executada**
- [x] Commit, push e Pull Request (integrado em `main`)
- [ ] Revisão do Felipe

## ET06 — Pesquisa pública

Critério de conclusão (Tabela 27): **E01, E02, TL09, TL11; T01, T03–T06, T10, T27, T28**.

- [x] Acesso sem login nem cookies por link ou QR Code; 404 para rascunho ou inexistente e 410 para inativa
- [x] Pergunta geral 0–10 obrigatória, específicas 1–5 opcionais com "Limpar resposta", "Etapa X de Y", Voltar e recarga preservadas
- [x] Validação no frontend e no backend; envio idempotente (`Idempotency-Key`, `request_hash`, UNIQUE) e reenvios automáticos (1, 2 e 4 s)
- [x] Confirmação somente após 201/200, com o agradecimento da versão; limpeza das chaves `fhdod:*` ao concluir e após 3 min + 60 s
- [x] T01, T03, T04, T05, T06, T10, T27 e T28 aprovados (integração, componentes e E2E da pesquisa pública em 1440 e 360 px)
- [x] Commit, push e Pull Request (integrado em `main`)
- [ ] Revisão do João (responsável da etapa: Felipe)

Detalhes das três etapas: [`docs/setores-escalas-e-pesquisas.md`](docs/setores-escalas-e-pesquisas.md). Evidências: [`docs/evidencias/ET04-ET06/`](docs/evidencias/ET04-ET06/) e [`docs/plano-e-relatorio-de-testes.md`](docs/plano-e-relatorio-de-testes.md).

## ET07 — Manifestações e Ouvidoria

Critério de conclusão (Tabela 27): **E03, E35–E40, TL10, TL12, TL13; T07–T09, T18, T19**.

- [x] E03: token HMAC de 60 min e uso único, idempotência, anonimato padrão, contato segregado com aceite, protocolo `FHD-AAAA-NNNNNN`
- [x] E35–E40: lista com filtros e trecho, detalhe com linha do tempo (sem contato), transições da RN23, `updatedAt`, notas, contato auditado com `no-store` e eliminação com motivo
- [x] TL10 (oferta após nota baixa ou ação secundária, formulário e protocolo), TL12 e TL13
- [x] T07, T08, T09, T10 (E03), T18 e T19 aprovados (integração, componentes e E2E)
- [x] Commit, push e Pull Request (PR #31, integrado em `main`)
- [ ] Conferência com o Figma; revisão do Felipe

## ET08 — Dashboard

Critério de conclusão (Tabela 27): **E28–E33, TL03, TL04; T05, T11, T36, T37**.

- [x] E28–E33 com filtros comuns, escopo, comparação, cobertura, série sem lacunas e supressão para o VI (RN21)
- [x] TL03 (`/painel`) e TL04 (`/painel/setores/:sectorId`) com filtros na URL, n em todo indicador, tabela alternativa e atualização a cada 60 s
- [x] T05, T11, T36 e T37 aprovados (integração, componentes e E2E); T15 repetido contra o E28 real
- [x] Commit, push e Pull Request (PR #31, integrado em `main`)
- [ ] Conferência com o Figma; revisão do João (responsável da etapa: Felipe)

## ET09 — Excel

Critério de conclusão (Tabela 27): **E34, TL14; T20, T21**.

- [x] E34 com ExcelJS: respostas, indicadores (iguais a E28/E29/E32/E33) e manifestações (`includeText` só para a Ouvidoria; contato nunca)
- [x] Células tipadas, datas `dd/mm/aaaa hh:mm`, cabeçalho congelado, nome padronizado, arquivo vazio válido; 50.000 linhas (422), 10 em 10 min (429) e auditoria
- [x] TL14 (`/relatorios`) e exportação pelo painel (RF62)
- [x] T20 e T21 aprovados (arquivos abertos com ExcelJS na integração; download no E2E)
- [x] Commit, push e Pull Request (PR #31, integrado em `main`)
- [ ] Abertura manual no Excel e no LibreOffice (RF63) — **não executada**; revisão do Felipe

Detalhes das três etapas: [`docs/manifestacoes-dashboard-relatorios.md`](docs/manifestacoes-dashboard-relatorios.md). Evidências: [`docs/evidencias/ET07-ET09/`](docs/evidencias/ET07-ET09/) e [`docs/plano-e-relatorio-de-testes.md`](docs/plano-e-relatorio-de-testes.md).

## Etapa 3 — Migração para MySQL

Critério de conclusão: backend somente com MySQL, sem Prisma nem Supabase; autenticação própria; tabelas, relacionamentos e restrições recriados; SQL importável no MySQL Workbench; funcionalidades preservadas; testes, CI e documentação atualizados.

- [x] MySQL 8.4 LTS com pool `mysql2`, UTC, READ COMMITTED, transações com nova tentativa em deadlock e 503 para banco indisponível
- [x] `database/`: criação do banco, 5 migrations versionadas (tabelas, chaves e índices, relacionamentos, CHECK e gatilhos), `schema.sql` gerado, seeds, usuários de privilégio mínimo e README do Workbench
- [x] Camada de repositórios por domínio (`*.repository.ts`) com SQL parametrizado; serviços e rotas preservados
- [x] Autenticação própria: E44 login, E45 renovação rotativa com detecção de reutilização, E46 logout; bcrypt; sessões revogadas na troca/redefinição de senha
- [x] Seed de demonstração no MySQL (e exportável para o Workbench) com verificação das contagens aprovada
- [x] 731 testes aprovados contra MySQL 8.4 (unidade, integração e banco), lint, typecheck e build
- [x] CI com serviço MySQL 8.4; Prisma, Supabase e PostgreSQL removidos de dependências, scripts e configurações
- [x] Frontend (repositório [`fhdod-frontend`](https://github.com/joao-farias16/fhdod-frontend)) usando E44–E46 no lugar do Supabase Auth (commit `1587f99` daquele repositório: `auth-client.ts` chama `/auth/login`, `/auth/refresh` e `/auth/logout`)
- [ ] Nova execução da E2E do frontend contra a API em MySQL — **resultado não registrado neste repositório**
- [x] Commit, push e Pull Request (PR #35); CI com MySQL 8.4 aprovada no GitHub Actions
- [ ] Revisão do Felipe

## Limitações conhecidas e pendências

- **Frontend:** o login, a renovação de sessão e o logout ficam na API (E44–E46; contratos em [`docs/autenticacao-e-permissoes.md`](docs/autenticacao-e-permissoes.md)), e o repositório do frontend já os utiliza. Não há, neste repositório, registro de uma execução da E2E do frontend contra a API em MySQL.
- **Publicação:** sem configuração de deploy da API no repositório e sem endereço público documentado (ET12). Veja [Publicação e infraestrutura](#publicação-e-infraestrutura).
- **Governança do repositório:** proteção de `main`/`develop` e revisão obrigatória por PR ainda não configuradas.
- **Dados antigos:** o banco Supabase remoto estava vazio (0 tabelas em 28/10/2026; pausado em 05/11/2026) e o PostgreSQL local só tinha dados fictícios do seed, que o MySQL recria. Caso surjam dados reais em PostgreSQL, o procedimento de exportação e importação está em [`database/README.md`](database/README.md#migração-de-dados-de-um-banco-postgresql-antigo).
- **Figma (28/10/2026):** o arquivo `sistema-hospital` reúne, na página Page 1, os componentes visuais e as telas das etapas implementadas (ET01 a ET09). A TL15 (TV Wall, ET10) ainda não tem tela.
- **`npm audit`:** avisos moderados já existentes antes da Etapa 3 (ExcelJS 4.4 → `uuid` 8, GHSA-w5hq-g745-h8pq, que só afeta `v3`/`v5`/`v6` com `buf`; e `minimatch` nas ferramentas de lint). A CI falha somente em alta ou crítica.
- **OpenAPI/Swagger, axe e T35/T39** continuam previstos para etapas futuras.

## Branches e colaboração

- `main`: versão publicada; `develop`: integração. O fluxo combinado é Pull Request, CI aprovada e aprovação do outro integrante; a proteção de branch que obrigaria isso no GitHub **ainda não está configurada**.
- Trabalho em `feature/<id>-<descricao>`, `fix/<id>-<descricao>` ou `docs/<descricao>`, sempre a partir de `develop`.
- Commits no padrão **Conventional Commits** em português (`feat`, `fix`, `docs`, `test`, `refactor`, `style`, `chore`, `ci`, `build`, `perf`), validados pelo commitlint.
- No quadro, no máximo **2 itens "Em andamento" por pessoa**.

Detalhes e passo a passo das proteções: [`docs/padroes-git.md`](docs/padroes-git.md). Arquitetura da API e comunicação com o frontend: [`docs/arquitetura.md`](docs/arquitetura.md).
