# Mapeamento de classes e consultas (D07)

Correspondência entre o código TypeScript (repositórios e tipos) e as tabelas do MySQL, e as consultas representativas da Seção 8. Modelo completo: [`modelo-de-dados.md`](modelo-de-dados.md). Padrões: [`padroes-banco-de-dados.md`](padroes-banco-de-dados.md).

> Até a Etapa 2 este documento descrevia os modelos do Prisma Client sobre PostgreSQL. Desde a **Etapa 3** não há ORM: cada domínio tem um repositório com SQL parametrizado para MySQL 8.4.

## Acesso ao banco no backend

```ts
import { createDatabase } from './lib/database.js'; // pool mysql2 (UTC, READ COMMITTED)
import { sql } from './lib/sql.js'; // template parametrizado

const db = createDatabase(env); // DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME…
const app = createApp({ env, logger, db, auth }); // createApp(deps) recebe o banco (Seção 7)

// Num repositório: valores viram parâmetros `?`, nunca texto concatenado.
const rows = await db.query<{ id: string }>(sql`SELECT id FROM sectors WHERE code = ${code}`);
await db.transaction(async (tx) => {
  await tx.execute(sql`UPDATE sectors SET name = ${name} WHERE id = ${id}`);
});
```

| Peça                                                   | Arquivo                   | Papel                                                                                                                      |
| ------------------------------------------------------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `Database` / `Queryable`                               | `src/lib/database.ts`     | pool, `query` (SELECT), `execute` (INSERT/UPDATE/DELETE), `transaction`, `ping` (E43), `close`; erros de indisponibilidade |
| `sql`, `sql.list`, `sql.json`, `sql.join`, `sql.empty` | `src/lib/sql.ts`          | montagem de SQL parametrizado, listas para `IN`, JSON e filtros opcionais; `containsPattern` para buscas `LIKE`            |
| Tipos de domínio                                       | `src/lib/domain-types.ts` | ENUMs (`UserRole`, `ShiftPeriod`, `ManifestationStatus`…) e `JsonValue`                                                    |
| `<domínio>.repository.ts`                              | `src/modules/<domínio>/`  | todo o SQL do domínio; converte linhas `snake_case` em objetos `camelCase`                                                 |

Conversões do driver: `DATETIME(3)` ↔ `Date` (UTC), `BOOLEAN` → `boolean`, `JSON` → objeto, `COUNT`/`SUM` → número (`toNumber`). Os serviços recebem `Database`/`Queryable`; os testes sem banco usam um dublê (`databaseStub`) e os testes em `tests/db` usam o pool real.

## Repositórios × tabelas

| Repositório                                               | Tabelas                                                                                                    | Consultas principais                                                                                 |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `auth/auth.repository.ts`                                 | `profiles` (credenciais), `auth_sessions`, `profile_sectors`                                               | login, sessão + perfil + escopo por requisição, rotação/revogação de sessões, troca de hash          |
| `users/users.repository.ts`                               | `profiles`, `profile_sectors`, `sectors`                                                                   | lista paginada (E06), perfil com setores, vínculos, bloqueio `FOR UPDATE` do alvo e dos SA (RN24)    |
| `audit/audit.repository.ts`                               | `audit_logs`, `profiles`                                                                                   | inserção (`recordAudit`), consulta E41, última redefinição                                           |
| `sectors/sectors.repository.ts`                           | `sectors`, `teams`, `survey_configs`                                                                       | setores com contagens de equipes/pesquisas ativas (E10), unicidade de código e nome (`LOWER`)        |
| `teams/teams.repository.ts`                               | `teams`, `sectors`, `journey_stages`                                                                       | equipes com setor (E13), etapas (E16), bloqueio da equipe para cadastrar turnos                      |
| `shifts/shifts.repository.ts`                             | `shifts`, `shift_imports`, `teams`, `sectors`                                                              | escala do setor (E17), sobreposição, inserção em lote (até 2.000), importação com `FOR UPDATE` (E21) |
| `surveys/surveys.repository.ts`                           | `survey_configs`, `questions`, `survey_versions`, `survey_version_questions`                               | resumo e detalhe com versões (E22/E23), publicação (E26), escopo da pesquisa                         |
| `public-survey/public-survey.repository.ts`               | `survey_configs`, `survey_versions`, `survey_version_questions`, `responses`, `response_answers`, `shifts` | versão vigente (E01), envio idempotente (E02), atribuição a turno (RF24)                             |
| `manifestations/manifestations.repository.ts`             | `manifestations`, `manifestation_contacts`, `manifestation_notes`, `responses`                             | registro (E03), lista/detalhe (E35/E36), concorrência otimista (E37), notas, contato (E39/E40)       |
| `dashboard/dashboard.service.ts` + `dashboard.filters.ts` | `responses`, `response_answers`, `survey_versions`, `sectors`, `teams`, `manifestations`                   | agregações E28–E33 (SQL de contagem com o template `sql`)                                            |
| `reports/reports.service.ts`                              | as mesmas do dashboard e da Ouvidoria                                                                      | planilhas do E34 com `LIMIT 50001` (RN29)                                                            |

Comportamentos que o código não reimplementa, mas o banco aplica (a API traduz os erros): CHECKs, gatilhos de sobreposição de turnos, imutabilidade e anonimato, e o protocolo gerado pelo gatilho (`protocol` é omitido no `INSERT` e lido em seguida).

## Consultas representativas (Seção 8)

Todas parametrizadas (`?` preenchidos pelo driver). Executadas no MySQL 8.4 com o seed de demonstração (referência 05/11/2026).

### NPS do recorte (E28 e relatório de indicadores)

```sql
SELECT COUNT(r.id) AS total,
       COUNT(CASE WHEN r.nps_score >= 9 THEN 1 END)      AS promoters,
       COUNT(CASE WHEN r.nps_score IN (7, 8) THEN 1 END) AS passives,
       COUNT(CASE WHEN r.nps_score <= 6 THEN 1 END)      AS detractors
FROM responses r
JOIN sectors s ON s.id = r.sector_id
JOIN survey_versions sv ON sv.id = r.survey_version_id
WHERE s.hospital_id = ? AND r.submitted_at >= ? AND r.submitted_at < ?
  AND r.sector_id IN (?, ?, …);
```

O NPS e os percentuais são calculados na API a partir das contagens com aritmética inteira (`computeNps`, `percentOf` e `roundedRatio` em `nps.ts`), reproduzindo exatamente o `ROUND` com metade afastando-se de zero (RF51) — sem depender da precisão de divisão `DECIMAL` do MySQL. No seed de demonstração: total 2.400, NPS 42,7. Índices: `responses_submitted_at_idx` e `responses_sector_id_submitted_at_idx`.

### Série por dia local (E32)

O banco agrupa por **hora UTC** (`DATE_FORMAT(r.submitted_at, '%Y-%m-%dT%H:00:00Z')`) e a API soma as horas por dia local (America/Sao_Paulo): os deslocamentos do fuso são de horas inteiras, então o resultado é exato e não depende das tabelas de fuso horário do servidor.

### Lista da Ouvidoria (E35), sem ler o contato

```sql
SELECT m.id, m.protocol, m.received_at, s.id AS sector_id, s.name AS sector_name, m.type, m.status,
       m.priority, m.description, (mc.manifestation_id IS NOT NULL) AS has_contact
FROM manifestations m
JOIN sectors s ON s.id = m.sector_id
JOIN responses r ON r.id = m.response_id
JOIN survey_versions sv ON sv.id = r.survey_version_id
LEFT JOIN manifestation_contacts mc ON mc.manifestation_id = m.id
WHERE s.hospital_id = ? AND m.received_at >= ? AND m.received_at < ?
  AND m.sector_id IN (…) AND m.status IN (…)
ORDER BY m.received_at DESC, m.id DESC
LIMIT ? OFFSET ?;
```

Só a chave do contato é lida (existência); nome, telefone e e-mail só em `findContact` (E39, auditado antes). `priority DESC` e `status ASC` ordenam pela posição no `ENUM`, como no PostgreSQL. Índices: `manifestations_status_received_at_idx`, `manifestations_sector_id_received_at_idx`.

### Atribuição a turno (RF24, RN07)

```sql
SELECT sh.id, sh.team_id, sh.period
FROM shifts sh JOIN teams t ON t.id = sh.team_id
WHERE sh.sector_id = ? AND sh.cancelled_at IS NULL
  AND sh.starts_at <= ? AND sh.ends_at > ? AND t.is_active
LIMIT 2;  -- 0 linhas: no_shift; 1: attributed; 2: ambiguous
```

O gatilho `responses_before_insert` (regra `responses_shift_coherence`) garante, na gravação, que a resposta atribuída é coerente com o turno.

### Resultados por pergunta (E33)

Agrupa as notas por pergunta, etapa e pesquisa com `COUNT`, `SUM` e contagens por nota; o título é o da versão mais recente do recorte, lido numa segunda consulta com `(survey_config_id, version_number) IN ((?, ?), …)`. A média (duas casas) e o percentual de notas 4 e 5 são calculados na API.

### Relatório de respostas (E34)

Junção de `responses`, `sectors`, `survey_versions` e `teams` (LEFT JOIN) com `LIMIT 50001` para detectar o excesso da RN29 (422 `EXPORT_TOO_LARGE`).

### Regras de leitura

- **Nenhuma consulta analítica ou de relatório lê `manifestation_contacts`**; a lista da Ouvidoria só testa a existência (RN12).
- Recortes por turno e equipe usam apenas `attribution_status = 'attributed'` (RN14), apoiados pelos índices `responses_team_id_submitted_at_idx` e `responses_shift_period_submitted_at_idx`.
- Escopo de setores aplicado na própria consulta (`IN (…)` com os setores do escopo; lista vazia não retorna nada).
