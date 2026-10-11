# Plano e relatório de testes (D09)

O plano completo (T01–T42) está na Seção 12 da especificação. Este documento registra somente execuções reais. Cada registro informa data, commit, ambiente, executor, resultado e evidência.

## ET01 — Execução de 10/10/2026

- **Executor:** Claude Code (agente), a pedido de João Vitor Farias da Silva.
- **Commit:** nenhum — alterações ainda não commitadas na branch local `feature/ET01-repositorio-ambiente-kanban` (base `bf620ea`). Repetir e registrar o hash após o commit.
- **Ambiente:** Windows 11; Node.js 22.22.3 (instalado) e Node.js 24.21.0 (binário portátil, só para verificação); npm 10.9.8; Git 2.49.0.

### Ambiente verificado

| Item                | Situação                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| Node.js / npm / Git | 22.22.3 / 10.9.8 / 2.49.0                                                                      |
| GitHub CLI          | 2.102.0, autenticado como `joao-farias16` (escopos `repo`, `project`, `workflow`)              |
| Docker              | instalado, mas o serviço estava parado (não necessário na ET01)                                |
| Repositório remoto  | público, apenas `main` (sem proteção), 1 commit; Felipe ainda não é colaborador                |
| GitHub Projects     | quadro nº 1 já existente com os 6 status e os campos Etapa e Responsável                       |
| Supabase            | 1 projeto ativo (sa-east-1, PostgreSQL 17, plano free), schema `public` vazio — sem alterações |

### Resultados

| Verificação                     | Comando / procedimento                                                                                                                                         | Resultado                                                                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Formatação                      | `npm run format:check`                                                                                                                                         | Aprovado — "All matched files use Prettier code style!"                             |
| Lint                            | `npm run lint` (`--max-warnings=0`)                                                                                                                            | Aprovado — 0 problemas                                                              |
| Regras de lint de segurança     | arquivos de prova com `any`, `$queryRawUnsafe` e `dangerouslySetInnerHTML` (removidos depois)                                                                  | Aprovado — as 3 regras acusaram erro                                                |
| Typecheck                       | `npm run typecheck`                                                                                                                                            | Aprovado — sem erros nos dois módulos                                               |
| Testes do backend               | `npm run test -w backend`                                                                                                                                      | Aprovado — 3 arquivos, 24 testes                                                    |
| Cobertura do backend            | `npm run test:coverage -w backend`                                                                                                                             | 93,8% instruções, 85,4% ramos                                                       |
| Testes do frontend              | `npm run test -w frontend`                                                                                                                                     | Aprovado — 4 arquivos, 18 testes                                                    |
| Build                           | `npm run build`                                                                                                                                                | Aprovado — JS do frontend 356 KB (112 KB gzip, abaixo do limite de 250 KB do RNF26) |
| Rota de saúde (build)           | `node dist/server.js` + `curl /api/v1/health`                                                                                                                  | Aprovado — 200, `{"data":{"status":"ok",...}}`, HSTS, nosniff, CSP, `X-Request-Id`  |
| Rota inexistente                | `curl /api/v1/xyz`                                                                                                                                             | Aprovado — 404 `ROUTE_NOT_FOUND` com `requestId`                                    |
| Variável de ambiente ausente    | iniciar sem `CORS_ORIGIN`                                                                                                                                      | Aprovado — encerra com código 1 e mensagem citando a variável                       |
| Modo desenvolvimento            | `tsx src/server.ts` e `vite` com proxy `/api`                                                                                                                  | Aprovado — saúde respondida diretamente e pelo proxy do Vite                        |
| Logs sem dados pessoais         | inspeção do log JSON                                                                                                                                           | Aprovado — apenas id, método, caminho, status e tempo                               |
| Clone limpo (Node 22)           | cópia somente dos arquivos versionáveis + `npm ci` + `npm run check`                                                                                           | Aprovado — formatação, lint, typecheck, 42 testes e builds                          |
| Clone limpo (Node 24.21.0)      | mesma cópia, `npm ci` + `npm run check` + saúde com o build                                                                                                    | Aprovado                                                                            |
| Segredos (arquivos a versionar) | `gitleaks dir` 8.30.1 sobre todos os arquivos versionáveis (cópia sem itens ignorados)                                                                         | Aprovado — "no leaks found"                                                         |
| Segredos (histórico)            | `gitleaks git`                                                                                                                                                 | Aprovado — 1 commit, "no leaks found"                                               |
| `.gitignore`                    | `git check-ignore -v` em `.env`, `.env.*`, `.claude/settings.local.json`, `.mcp.json`, `dist/`, `coverage/`, `node_modules/`, `.vscode/settings.json`, `*.pem` | Aprovado — todos ignorados; `.env.example` e `.vscode/extensions.json` versionados  |
| Dependências                    | `npm install` / `npm audit`                                                                                                                                    | Aprovado — 0 vulnerabilidades                                                       |
| Mensagens de commit             | `commitlint` com "atualiza readme" e "chore(repo): configura base da ET01"                                                                                     | Aprovado — 1ª rejeitada, 2ª aceita                                                  |

### Pendente (depende de ações do responsável)

- Primeira execução da CI no GitHub Actions — ainda **não executada**.
- Clone do repositório remoto após o merge, com hash do commit.
- Proteção de `main` e `develop` (ver `docs/padroes-git.md`).
