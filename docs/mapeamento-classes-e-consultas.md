# Mapeamento de classes e consultas (D07) — ET02

Correspondência entre os modelos do Prisma Client (TypeScript) e as tabelas do PostgreSQL, e as consultas representativas da Seção 8. Modelo completo: [`modelo-de-dados.md`](modelo-de-dados.md).

## Uso do cliente no backend

```ts
import { createPrismaClient } from './lib/prisma.js'; // Prisma 7 + @prisma/adapter-pg

const prisma = createPrismaClient(env.DATABASE_URL);
const app = createApp({ env, logger, prisma }); // createApp(deps) recebe o Prisma (Seção 7)
```

- O cliente é gerado em `backend/src/generated/prisma` (`import { PrismaClient, Prisma } from '../generated/prisma/client.js'`).
- Hoje o backend usa o Prisma só na verificação de saúde (E43: `SELECT 1` com limite de 2 s → 503 `SERVICE_UNAVAILABLE`). Os repositórios dos módulos entram a partir da ET03, seguindo `docs/arquitetura-backend.md` (controladores sem Prisma; serviços com transações).
- Testes HTTP sem banco injetam um dublê tipado como `Pick<PrismaClient, '$queryRaw'>`; os testes em `tests/db` usam o cliente real.

## Modelos × tabelas

| Modelo Prisma           | Tabela                     | Relações principais no cliente                                                                                                                 |
| ----------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `Hospital`              | `hospitals`                | `profiles`, `sectors`, `journeyStages`                                                                                                         |
| `Profile`               | `profiles`                 | `hospital`, `sectorLinks`, `createdBy`/`created`, `deactivatedBy`/`deactivated`, autorias (`shiftsCreated`, `versionsPublished`, `auditLogs`…) |
| `Sector`                | `sectors`                  | `teams`, `shifts`, `surveyConfigs`, `responses`, `manifestations`, `profileLinks`                                                              |
| `ProfileSector`         | `profile_sectors`          | `profile` (cascade), `sector`, `createdBy`                                                                                                     |
| `Team`                  | `teams`                    | `sector`, `shifts`, `responses`                                                                                                                |
| `Shift`                 | `shifts`                   | `sector`, `team` (FK composta `teamId`+`sectorId`), `import`, `createdBy`, `cancelledBy`                                                       |
| `ShiftImport`           | `shift_imports`            | `uploadedBy`, `committedBy`, `shifts`                                                                                                          |
| `SurveyConfig`          | `survey_configs`           | `sector`, `questions`, `versions`, `currentVersion`, `createdBy`, `updatedBy`                                                                  |
| `JourneyStage`          | `journey_stages`           | `hospital`, `questions`, `versionQuestions`                                                                                                    |
| `Question`              | `questions`                | `surveyConfig`, `journeyStage`, `versionQuestions`                                                                                             |
| `SurveyVersion`         | `survey_versions`          | `surveyConfig` (FK composta `surveyConfigId`+`sectorId`), `questions`, `responses`, `publishedBy`, `currentOf`                                 |
| `SurveyVersionQuestion` | `survey_version_questions` | `surveyVersion`, `question`, `journeyStage`, `answers`                                                                                         |
| `Response`              | `responses`                | `surveyVersion` (FK composta com `sectorId`), `sector`, `shift`, `team` (composta), `answers`, `manifestations` (no máximo uma)                |
| `ResponseAnswer`        | `response_answers`         | `response` (composta, cascade), `surveyVersionQuestion` (composta com versão e tipo)                                                           |
| `Manifestation`         | `manifestations`           | `response` (composta com `sectorId`), `sector`, `updatedBy`, `contact`, `notes`                                                                |
| `ManifestationContact`  | `manifestation_contacts`   | `manifestation` (PK = FK, cascade)                                                                                                             |
| `ManifestationNote`     | `manifestation_notes`      | `manifestation` (cascade), `author`                                                                                                            |
| `AuditLog`              | `audit_logs`               | `actorProfile`, `sector`; `id` é `bigint` (`BigInt` no TypeScript)                                                                             |

Enums do TypeScript (`UserRole`, `QuestionType`, `ResponseOrigin`, `AttributionStatus`, `ShiftPeriod`, `ShiftSource`, `ImportStatus`, `ManifestationType`, `ManifestationStatus`, `ManifestationPriority`, `ManifestationEventKind`) mapeiam os enums do banco em `snake_case` (`@@map`). Campos: `camelCase` no cliente, `snake_case` no banco (`@map`), por exemplo `npsScore` ↔ `nps_score`.

Comportamentos que o cliente não enxerga, mas o banco aplica (o backend deve tratar os erros): CHECKs, `EXCLUDE` de turnos, gatilhos de imutabilidade e anonimato e o protocolo gerado por `next_manifestation_protocol()` (o campo `protocol` é opcional na criação).

## Consultas representativas (Seção 8)

Todas parametrizadas com `$queryRaw`. Foram executadas no banco local semeado (data de referência 17/10/2026); saída real em [`evidencias/ET02/consultas-representativas.txt`](evidencias/ET02/consultas-representativas.txt).

### NPS do recorte (E28 e relatório de indicadores)

```sql
SELECT COUNT(*) AS total,
  COUNT(*) FILTER (WHERE nps_score >= 9)      AS promoters,
  COUNT(*) FILTER (WHERE nps_score IN (7, 8)) AS passives,
  COUNT(*) FILTER (WHERE nps_score <= 6)      AS detractors,
  ROUND(100.0 * (COUNT(*) FILTER (WHERE nps_score >= 9)
                 - COUNT(*) FILTER (WHERE nps_score <= 6)) / NULLIF(COUNT(*), 0), 1) AS nps
FROM responses
WHERE submitted_at >= $from AND submitted_at < $to_exclusive
  AND sector_id = ANY($sector_ids::uuid[]);
```

Resultado real (17/09 a 16/10/2026, 6 setores): total 587, NPS 43,1. Recorte sem respostas: total 0 e NPS nulo (RF60). Índices: `responses_submitted_at_idx` e `responses_sector_id_submitted_at_idx` (o plano usou o primeiro).

### Lista da Ouvidoria (E35), sem ler o contato

```sql
SELECT m.id, m.protocol, m.received_at, s.name AS sector, m.type, m.status, m.priority,
       left(m.description, 120) AS excerpt,
       EXISTS (SELECT 1 FROM manifestation_contacts c WHERE c.manifestation_id = m.id) AS has_contact
FROM manifestations m JOIN sectors s ON s.id = m.sector_id
WHERE m.sector_id = ANY($sector_ids::uuid[])
  AND m.status = ANY($status::manifestation_status[])
  AND m.received_at >= $from AND m.received_at < $to_exclusive
ORDER BY m.received_at DESC LIMIT $page_size OFFSET $offset;
```

Índices: `manifestations_status_received_at_idx`, `manifestations_sector_id_received_at_idx`; a existência do contato usa a PK de `manifestation_contacts`.

### Setores da TV Wall (E42)

Mesma agregação por setor com `HAVING COUNT(*) >= 5` e `LIMIT 8` (RN21). Executada: 6 setores com n de 62 a 134 nos últimos 30 dias.

### Atribuição a turno (RF24, RN07)

```sql
SELECT sh.id, sh.team_id, sh.period
FROM shifts sh JOIN teams t ON t.id = sh.team_id AND t.is_active
WHERE sh.sector_id = $sector_id AND sh.cancelled_at IS NULL
  AND sh.starts_at <= $instant AND $instant < sh.ends_at
LIMIT 2;  -- 0 linhas: no_shift; 1: attributed; 2: ambiguous
```

Executada no PA: segunda-feira 12/10/2026 às 08:00 → 1 turno (`attributed`); às 11:00 → 2 turnos (reforço; `ambiguous`). Índice `shifts_sector_id_starts_at_ends_at_idx` (com 2.764 turnos o planejador preferiu varredura sequencial; o índice passa a valer com o crescimento da tabela). O gatilho `responses_shift_coherence` garante, na gravação, que a resposta atribuída é coerente com o turno.

### Relatório de respostas (E34)

Junção de `responses`, `sectors`, `survey_versions`, `survey_configs` e `teams` (LEFT JOIN, pois equipe é opcional) com `LIMIT 50001` para detectar o excesso da RN29. Executada: 2.400 linhas.

### Regras de leitura

- **Nenhuma consulta analítica ou de relatório lê `manifestation_contacts`**; a lista da Ouvidoria só testa a existência (RN12).
- Recortes por turno e equipe usam apenas `attribution_status = 'attributed'` (RN14), apoiados pelos índices parciais `responses_team_id_submitted_at_idx` e `responses_shift_period_submitted_at_idx`.
- `computeNps` (ET08) deve reproduzir o `ROUND` do PostgreSQL: `nps10 = sinal(P − D) × (2 × |P − D| × 1000 + N) ÷ (2N)`.
