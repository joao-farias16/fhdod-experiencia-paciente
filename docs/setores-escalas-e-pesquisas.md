# Setores, escalas, pesquisas e pesquisa pública — ET04, ET05 e ET06

Referência técnica das etapas ET04 (RF12–RF24), ET05 (RF25–RF32) e ET06 (RF33–RF39) da especificação consolidada 1.1. Autenticação, matriz de permissões, escopo e auditoria seguem [`autenticacao-e-permissoes.md`](autenticacao-e-permissoes.md); as tabelas e restrições do banco, [`modelo-de-dados.md`](modelo-de-dados.md).

## Contratos (prefixo `/api/v1`)

Todas as rotas `/admin/*` exigem `Authorization: Bearer`, passam por `authenticate → limite 300/min → requirePasswordChanged → requirePermission(Exx)` e aplicam o escopo de setores no serviço (filtro fora do escopo → 403 `SECTOR_OUT_OF_SCOPE`; recurso fora do escopo → 404). Esquemas Zod estritos: campo desconhecido → 400.

| ID  | Rota                                      | Acesso               | Entrada                                                                                           | Respostas e efeitos                                                                                                                                           |
| --- | ----------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E10 | `GET /admin/sectors`                      | Todos adm. (escopo)  | `isActive`, `search`                                                                              | 200 setores com `activeTeams` e `activeSurveys`                                                                                                               |
| E11 | `POST /admin/sectors`                     | SA                   | `code` (`^[A-Z0-9_-]{2,20}$`), `name`, `description?`                                             | 201; 400; 409 código ou nome (sem distinguir caixa). `SECTOR_CREATED`                                                                                         |
| E12 | `PATCH /admin/sectors/:id`                | SA                   | `name?`, `description?`, `isActive?` (sem `code` → 400)                                           | 200; 404; 409. `SECTOR_UPDATED`, `SECTOR_DEACTIVATED`, `SECTOR_REACTIVATED`                                                                                   |
| E13 | `GET /admin/teams`                        | Todos adm. (escopo)  | `sectorId?`, `isActive?`                                                                          | 200 equipes com o setor                                                                                                                                       |
| E14 | `POST /admin/teams`                       | SA, AS               | `sectorId`, `code`, `name`                                                                        | 201; 403 escopo; 404; 409; 422 `SECTOR_INACTIVE`. `TEAM_CREATED`                                                                                              |
| E15 | `PATCH /admin/teams/:id`                  | SA, AS               | `name?`, `isActive?`                                                                              | 200; 404; 422 `SECTOR_INACTIVE` (reativar em setor inativo). `TEAM_*`                                                                                         |
| E16 | `GET /admin/journey-stages`               | SA, AS               | —                                                                                                 | 200 etapas ordenadas por posição                                                                                                                              |
| E17 | `GET /admin/shifts`                       | SA, AS               | `sectorId`, `from`, `to` (AAAA-MM-DD, até 62 dias), `teamId?`, `includeCancelled?`                | 200 turnos com `date`, `startTime`, `endTime`, `endsNextDay` no fuso local e instantes UTC; 400; 403                                                          |
| E18 | `POST /admin/shifts`                      | SA, AS               | `teamId`, `date`, `period` (`morning`, `afternoon`, `night`), `startTime`, `endTime` (HH:MM)      | 201; 400 duração; 404; 409 `SHIFT_OVERLAP`; 422 `TEAM_INACTIVE`, `SECTOR_INACTIVE`, `DATE_OUT_OF_RANGE`. `SHIFT_CREATED`                                      |
| E19 | `PATCH /admin/shifts/:id`                 | SA, AS               | `cancelled: true`, `reason` (5–300)                                                               | 200; 404; 409 `SHIFT_ALREADY_CANCELLED`. `SHIFT_CANCELLED`                                                                                                    |
| E20 | `POST /admin/rosters/import`              | SA, AS (10/h/perfil) | multipart, campo `file` (.csv, até 1 MB)                                                          | 201 `validated` ou `rejected` com erros por linha; 400 arquivo; 413 `FILE_TOO_LARGE`; 415 `UNSUPPORTED_FILE_TYPE`; 429. `ROSTER_IMPORT_*`                     |
| E21 | `POST /admin/rosters/imports/:id/confirm` | SA, AS (própria)     | —                                                                                                 | 200 `committed`; 404; 409 confirmada, expirada, rejeitada ou `SHIFT_OVERLAP`; 422 inativos. `ROSTER_IMPORT_COMMITTED`                                         |
| E22 | `GET /admin/surveys`                      | SA, AS               | `sectorId?`, `status?` (`draft`, `active`, `inactive`), `search?`, paginação                      | 200 lista com situação e `meta`                                                                                                                               |
| E23 | `GET /admin/surveys/:id`                  | SA, AS               | —                                                                                                 | 200 configuração, perguntas (`locked`), versões (número, data, autor, perguntas) e `links`; 404                                                               |
| E24 | `POST /admin/surveys`                     | SA, AS               | `sectorId`, `title`, `slug`, `introText?`, `thankYouMessage?`                                     | 201 rascunho com a pergunta geral padrão; 403; 409 slug; 422 `SECTOR_INACTIVE`. `SURVEY_CREATED`                                                              |
| E25 | `PATCH /admin/surveys/:id`                | SA, AS               | textos; `slug`, `sectorId`, `npsQuestionText` (antes da 1ª publicação); `isActive`; `questions[]` | 200; 422 `FIELD_LOCKED_AFTER_PUBLICATION`, `QUESTION_LOCKED`, `QUESTION_LIMIT_REACHED`, `NPS_QUESTION_REQUIRED`. `SURVEY_UPDATED`/`DEACTIVATED`/`REACTIVATED` |
| E26 | `POST /admin/surveys/:id/publish`         | SA, AS               | —                                                                                                 | 201 nova versão; 409 `NO_CHANGES_TO_PUBLISH`; 422 `SURVEY_INACTIVE`, `SECTOR_INACTIVE`. `FOR UPDATE` e instantâneos. `SURVEY_PUBLISHED`                       |
| E27 | `GET /admin/surveys/:id/qr`               | SA, AS               | —                                                                                                 | 200 `qrUrl`, `linkUrl`; 409 `SURVEY_NOT_PUBLISHED`                                                                                                            |
| E01 | `GET /public/surveys/:slug`               | Público (60/min/IP)  | slug kebab-case até 80                                                                            | 200 versão vigente por etapas (`Cache-Control: public, max-age=60`); 404 rascunho ou inexistente; 410 `SURVEY_UNAVAILABLE`                                    |
| E02 | `POST /public/responses`                  | Público (30/min/IP)  | `Idempotency-Key` (UUID v4); `surveyVersionId`, `origin`, `npsScore` 0–10, `answers[]` (até 10)   | 201 ou 200 (`Idempotent-Replayed: true`) com `responseId`, `submittedAt`, `lowScore` e token; 400; 404; 409 chave reutilizada ou versão expirada; 410         |

`questions[]` do E25: item sem `id` inclui pergunta específica (exige `text` e `journeyStageId`); item com `id` altera `text`, `journeyStageId` (somente se nunca publicada), `position` e `isActive`. Tipo e obrigatoriedade são definidos pelo sistema.

## Regras de negócio aplicadas

- **RN11 — exclusão lógica.** Setores, equipes e pesquisas são desativados (`is_active`, `deactivated_at`); turnos são cancelados com motivo; nada é apagado pela aplicação.
- **RF15 — setor desativado.** E01/E02 → 410; turno manual e confirmação de importação → 422 `SECTOR_INACTIVE`; na pré-validação vira erro de linha.
- **RN20 — turnos.** Horas locais convertidas para UTC (`localDateTimeToInstant`, robusto a horário de verão); fim menor ou igual ao início termina no dia seguinte; duração de 1 a 24 horas; sem sobreposição na mesma equipe entre turnos não cancelados (verificação no serviço e `EXCLUDE` no banco, que decide corridas). Janela de datas: de 30 dias antes a 180 dias depois de hoje.
- **RN19 — importação.** Tudo ou nada: a pré-validação grava só `shift_imports` (linhas em `staged_rows`), nunca turnos; a confirmação revalida escopo, setores, equipes e sobreposições e insere todos os turnos numa única transação, em até 30 minutos.
- **RN07/RN08/RF24 — atribuição.** No E02, com origem `qr_code`, consulta turnos não cancelados do setor com `starts_at <= instante < ends_at` e equipe ativa (`LIMIT 2`): nenhum → `no_shift`; um → `attributed` (turno, equipe e período); vários → `ambiguous`; origem `link` → `not_qr_origin`. O instante é o do envio (relógio do servidor), e a resposta é sempre gravada. Não há vínculo com profissionais.
- **RN01/RN02/RN17/RN27 — perguntas.** Uma pergunta geral (0–10, obrigatória, criada automaticamente e nunca desativada) por pesquisa; específicas de 1 a 5, opcionais, no máximo 10 ativas; pergunta publicada não muda texto, tipo nem etapa (desativa-se e cria-se outra); setor, slug e texto da pergunta geral ficam imutáveis após a primeira publicação (serviço e gatilhos do banco).
- **RN06/RN15 — versões.** A publicação cria a versão `n+1` com instantâneos de título, introdução, agradecimento, setor e perguntas ativas (pergunta geral primeiro; específicas por etapa e posição); a anterior recebe `superseded_at`. Respostas guardam a versão exibida.
- **RN26 — versão substituída.** Aceita respostas por 24 horas se pesquisa e setor estiverem ativos; depois, 409 `SURVEY_VERSION_OUTDATED`.
- **RN13 — idempotência.** `request_hash` = SHA-256 do JSON canônico (chaves ordenadas, respostas por `questionId`). Mesma chave e mesmo conteúdo → registro original (200 e `Idempotent-Replayed: true`); conteúdo diferente → 409 `IDEMPOTENCY_KEY_REUSED`; envios concorrentes resolvidos pela restrição `UNIQUE` de `idempotency_key`.
- **RN05 — nota baixa.** `lowScore` = NPS de 0 a 6 ou alguma específica 1 ou 2 (`services/nps.ts`, que também traz `computeNps`, idêntico ao `ROUND` do PostgreSQL).
- **Token de manifestação.** `base64url(HMAC-SHA256(MANIFESTATION_TOKEN_SECRET, responseId))`, não armazenado; validade em `manifestation_token_expires_at` (60 minutos). O consumo (E03) é da ET07.

## CSV de escala (Seção 4.3)

```text
setor_codigo;equipe_codigo;data;turno;hora_inicio;hora_fim
PA;EQUIPE-A;28/10/2026;MANHA;07:00;19:00
PA;EQUIPE-B;28/10/2026;NOITE;19:00;07:00
```

UTF-8 (com ou sem BOM), separador `;`, até 1 MB e 2.000 linhas de dados. Erros de arquivo: `FILE_TOO_LARGE` (413), `UNSUPPORTED_FILE_TYPE` (415; também para .xlsx renomeado), `EMPTY_FILE`, `TOO_MANY_ROWS`, `ENCODING_INVALID` (400). Erros de linha (`line`, `column`, `code`, `message`): `CSV_HEADER_INVALID`, `FIELD_REQUIRED`, `DATE_INVALID`, `DATE_OUT_OF_RANGE`, `TIME_INVALID`, `DURATION_INVALID`, `PERIOD_INVALID`, `SECTOR_NOT_FOUND`, `SECTOR_INACTIVE`, `SECTOR_OUT_OF_SCOPE`, `TEAM_NOT_FOUND`, `TEAM_INACTIVE`, `OVERLAP_IN_FILE`, `OVERLAP_EXISTING`. A TL07 oferece o modelo para baixar.

## Interface

| Tela | Rota                                       | Perfis           | Conteúdo                                                                                                        |
| ---- | ------------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------- |
| TL05 | `/admin/setores`                           | SA; AS (equipes) | setores com contagens; cadastro, edição, desativação e reativação; equipes do setor selecionado                 |
| TL06 | `/admin/turnos`                            | SA, AS           | escala por dia (setor, equipe, intervalo, cancelados), cadastro manual e cancelamento com motivo                |
| TL07 | `/admin/escalas/importar`                  | SA, AS           | envio do CSV, modelo, resumo por equipe, erros por linha e confirmação                                          |
| TL08 | `/admin/pesquisas`, `/admin/pesquisas/:id` | SA, AS           | lista com situação; editor de dados e perguntas, publicação, histórico, link, QR Code (PNG/SVG) e cartaz A4     |
| TL09 | `/p/:slug?origem=qr\|link`                 | Público          | pergunta geral 0–10 (duas linhas no celular), etapas 1–5 opcionais, "Etapa X de Y", Voltar, Enviar, inatividade |
| TL11 | `/p/:slug`                                 | Público          | agradecimento da versão e Concluir; volta ao início em 30 segundos                                              |

A pesquisa pública fica num pedaço de JavaScript próprio, sem o cliente do Supabase. As respostas em andamento ficam na memória e em `sessionStorage` (`fhdod:pesquisa:<slug>`), apagadas ao concluir ou após 3 min + 60 s sem interação ("Você ainda está aí?"). A `Idempotency-Key` é criada no primeiro clique em Enviar e mantida até o sucesso (nova chave se a resposta mudar); há até 3 reenvios automáticos (1, 2 e 4 s) em falha de rede, 502, 503 ou 504. A confirmação só aparece depois do 201/200. O protocolo e a oferta de manifestação (TL10, RF40–RF43) pertencem à ET07.

## Testes

| Teste | Arquivos                                                                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T22   | `backend/tests/db/t22-t23-importacao-escala.test.ts`; `frontend/src/features/structure/structure.test.tsx`; `frontend/e2e/escalas-e-pesquisas.spec.ts` |
| T23   | `backend/tests/db/t22-t23-importacao-escala.test.ts`; `frontend/src/features/structure/structure.test.tsx`                                             |
| T24   | `backend/tests/db/t24-setores-equipes-turnos.test.ts`; `frontend/src/features/structure/structure.test.tsx`                                            |
| T25   | `backend/tests/db/t25-atribuicao.test.ts`                                                                                                              |
| T26   | `backend/tests/db/t26-pesquisas.test.ts`; `frontend/src/features/surveys/SurveyEditorPage.test.tsx`                                                    |
| T02   | `backend/tests/db/t26-pesquisas.test.ts` (URLs exatas); `frontend/e2e/escalas-e-pesquisas.spec.ts` (decodificação com jsqr)                            |
| T01   | `backend/tests/db/publica-e01-e02.test.ts`; `frontend/e2e/pesquisa-publica.spec.ts`                                                                    |
| T03   | `backend/tests/db/publica-e01-e02.test.ts`; `frontend/src/features/public-survey/PublicSurveyPage.test.tsx`; `frontend/e2e/pesquisa-publica.spec.ts`   |
| T04   | `backend/tests/db/publica-e01-e02.test.ts`                                                                                                             |
| T05   | `backend/tests/unit/regras-escala-pesquisa.test.ts`; `backend/tests/db/publica-e01-e02.test.ts` (SQL da Seção 8)                                       |
| T06   | `backend/tests/db/publica-e01-e02.test.ts`                                                                                                             |
| T10   | `backend/tests/db/publica-e01-e02.test.ts`; `frontend/src/features/public-survey/PublicSurveyPage.test.tsx`                                            |
| T27   | `frontend/src/features/public-survey/PublicSurveyPage.test.tsx`; `frontend/e2e/pesquisa-publica.spec.ts`                                               |
| T28   | `frontend/src/features/public-survey/PublicSurveyPage.test.tsx`; `frontend/e2e/pesquisa-publica.spec.ts`                                               |

T14 e T15 também passaram a chamar as rotas reais E13, E16, E17, E22 e E23. Resultados das execuções: [`plano-e-relatorio-de-testes.md`](plano-e-relatorio-de-testes.md).
