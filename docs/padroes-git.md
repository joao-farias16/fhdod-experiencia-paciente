# Padrões de Git e colaboração (D04)

Baseado na Seção 13 (Tabela 25) da especificação.

## Branches

| Branch                     | Finalidade                      | Origem    |
| -------------------------- | ------------------------------- | --------- |
| `main`                     | versão publicada                | —         |
| `develop`                  | integração das etapas           | `main`    |
| `feature/<id>-<descricao>` | trabalho de uma etapa ou tarefa | `develop` |
| `fix/<id>-<descricao>`     | correção                        | `develop` |
| `docs/<descricao>`         | somente documentação            | `develop` |

Exemplo: `feature/ET01-repositorio-ambiente-kanban`. As branches de trabalho são excluídas após o merge.

## Commits

[Conventional Commits 1.0.0](https://www.conventionalcommits.org/pt-br/v1.0.0/) em português:

```text
<tipo>(<escopo opcional>): <descrição no imperativo>
```

Tipos aceitos: `feat`, `fix`, `docs`, `test`, `refactor`, `style`, `chore`, `ci`, `build`, `perf`. Escopos sugeridos: `backend`, `ci`, `repo`, `docs` (o escopo `frontend` deixou de se aplicar aqui: o frontend tem repositório próprio) e, a partir das próximas etapas, os módulos (`auth`, `pesquisas`, `ouvidoria`...).

Exemplos:

```text
chore(repo): configura workspaces, lint e formatação
feat(backend): adiciona rota de saúde GET /api/v1/health
ci: adiciona workflow com gitleaks, lint, testes e build
```

O hook `commit-msg` (husky + commitlint) rejeita mensagens fora do padrão. Ele é ativado pelo `npm ci`/`npm install` e funciona também no GitHub Desktop, desde que o Node.js esteja no PATH. Para testar uma mensagem sem commitar:

```bash
echo "feat(backend): exemplo" | npx --no -- commitlint
```

## Pull Requests e revisão

- Todo merge em `develop` e `main` ocorre por Pull Request, usando o modelo em `.github/pull_request_template.md`.
- O revisor é o outro integrante; ele confere requisito, segurança, dados, testes, camadas e interface.
- A CI precisa estar verde. Merge por **Squash and merge**.
- Conflitos: o autor atualiza a branch a partir de `develop` e roda `npm run check` antes de enviar.

## Quadro Kanban (GitHub Projects)

Quadro oficial: <https://github.com/users/joao-farias16/projects/1>, vinculado ao repositório.

| Status       | Significado                                                                 |
| ------------ | --------------------------------------------------------------------------- |
| Backlog      | planejado, ainda não priorizado (inclui as etapas futuras)                  |
| A fazer      | priorizado para a etapa atual                                               |
| Em andamento | em desenvolvimento — **no máximo 2 itens por pessoa**                       |
| Em revisão   | implementado e verificado pelo autor; aguardando PR/revisão                 |
| Em testes    | aguardando ou executando validação (por exemplo, a primeira execução da CI) |
| Concluído    | critério de aceitação verificado com evidência, CI aprovada e revisão feita |

Campos: **Etapa** (ET01–ET14) e **Responsável** (João ou Felipe). Cada etapa tem um card principal com subtarefas (sub-issues); cada subtarefa descreve objetivo, escopo, atividades, critérios de aceitação, evidências e dependências. Teste reprovado gera um item `fix/` no quadro.

### Prática registrada até agora

Situação conferida no GitHub em 05/11/2026: as etapas chegaram a `main` pelos PRs #29 a #35, todos abertos de `develop` para `main` e integrados com **merge commit** (não squash), sem revisão de aprovação registrada. As branches de trabalho mais recentes usaram também os prefixos `refactor/` e `feat/` (por exemplo, `feat/migracao-mysql`), que não constam da tabela acima.

## Proteção de branches — configuração pendente

Ainda **não configurada** (a API do GitHub responde "Branch not protected" para `main` e `develop`, e não há _rulesets_). Os pré-requisitos já existem: `develop` está publicada, a CI executa em push e PR, e o Felipe já é colaborador do repositório.

Passo a passo:

1. Em **Settings → Branches → Add branch protection rule** (ou _Rulesets_), para `main` e depois para `develop`:
   - _Require a pull request before merging_ → _Require approvals_: 1;
   - _Require status checks to pass before merging_ → marcar os jobs **Segredos (gitleaks)**, **API — formatação, lint, typecheck, banco MySQL, testes e build** e **Auditoria de dependências (npm audit)**; marcar _Require branches to be up to date_;
   - _Do not allow bypassing the above settings_ (opcional, recomendado);
   - deixar desmarcados _Allow force pushes_ e _Allow deletions_.
2. Em **Settings → General → Pull Requests**: habilitar _Allow squash merging_ e _Automatically delete head branches_.

Alternativa pelo GitHub CLI (para `main`; repetir trocando por `develop`):

```bash
gh api -X PUT repos/joao-farias16/fhdod-experiencia-paciente/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Segredos (gitleaks)",
      "API — formatação, lint, typecheck, banco MySQL, testes e build",
      "Auditoria de dependências (npm audit)"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 1 },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

Com `enforce_admins: true` e apenas uma aprovação exigida, o merge depende da aprovação do outro integrante (o Felipe já é colaborador). Os nomes das verificações acima são os que a CI publica hoje (conferidos nas verificações do commit `a5ff57b`); se o nome de um job mudar no `ci.yml`, a regra precisa ser atualizada.
