# Evidências da ET02 — Modelo de dados

Execuções reais de 17/10/2026 (horário de Brasília; os arquivos registram o instante em UTC, já em 18/10/2026). Sem commit associado: as alterações estão na branch local `feature/ET02-modelo-dados` (base `develop` em `0d8755e`), aguardando o commit do responsável.

**Ambiente:** Windows 11; Node.js 22.22.3; npm 10.9.8; Docker 29.8.2; Supabase CLI 2.121.0 (PostgreSQL 17.11, imagem `supabase/postgres:17.11.0.004`); Prisma 7.10.1. Banco de desenvolvimento `postgres` e banco de testes `fhdod_test`, ambos no Supabase local (`127.0.0.1:54322`). **Executor:** Claude Code (agente), a pedido de João Vitor Farias da Silva. Nenhuma operação foi feita no Supabase remoto.

| Arquivo                                                                    | Conteúdo                                                                                                  |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [`t32-resultado.json`](t32-resultado.json)                                 | resultado de cada cenário do T32: operação, mecanismo, SQLSTATE, restrição, mensagem, estado antes/depois |
| [`t32-mutacao.txt`](t32-mutacao.txt)                                       | controle negativo: sem os mecanismos, os 6 cenários do T32 falham                                         |
| [`backend-testes-saida.txt`](backend-testes-saida.txt)                     | saída detalhada (verbose) dos 80 testes do backend                                                        |
| [`backend-testes-junit.xml`](backend-testes-junit.xml)                     | relatório JUnit do Vitest (80 testes, 0 falhas, 0 ignorados; nome da máquina anonimizado)                 |
| [`seed-verificacao-execucao-1.md`](seed-verificacao-execucao-1.md)         | contagens e coerência do seed — 1ª execução (Supabase local)                                              |
| [`seed-verificacao-execucao-2.md`](seed-verificacao-execucao-2.md)         | 2ª execução após `npm run db:reset` — impressões digitais idênticas à 1ª                                  |
| [`seed-verificacao-postgres17-ci.md`](seed-verificacao-postgres17-ci.md)   | seed em PostgreSQL 17 puro (simulação da CI) — impressões digitais idênticas                              |
| [`ci-simulada-postgres17.txt`](ci-simulada-postgres17.txt)                 | passos de banco da CI em contêiner `postgres:17`: validate, deploy, diff, seed, verificação e testes      |
| [`consultas-representativas.txt`](consultas-representativas.txt)           | consultas da Seção 8 executadas no banco semeado (NPS, Ouvidoria, atribuição, planos)                     |
| [`supabase-local-auth-e-data-api.txt`](supabase-local-auth-e-data-api.txt) | login das contas de demonstração, cadastro público bloqueado, Data API desligada, RLS e privilégios       |

## Relatório do T32 — Integridade referencial (Tabela 23; RNF18)

- **Nível:** integração (banco), PostgreSQL 17.11 real; SQL puro pelo driver `pg`, sem validação da aplicação.
- **Comando:** `npm run test -w backend` (projeto Vitest `banco`, arquivo `tests/db/t32-integridade-referencial.test.ts`), com `TEST_DATABASE_URL=postgresql://…@127.0.0.1:54322/fhdod_test`.
- **Procedimento por cenário:** cria registros válidos; consulta o estado inicial; executa a operação inválida dentro de um `SAVEPOINT`; confere SQLSTATE e nome da restrição/gatilho; consulta o estado final; executa um controle positivo (a operação válida equivalente é aceita). Tudo numa transação desfeita (ROLLBACK).
- **Execução final:** 18/10/2026 00:33:10 UTC — **6 de 6 cenários APROVADOS**.

| #   | Cenário                               | Operação inválida                                                                                    | Mecanismo que rejeitou                                                                                                          | SQLSTATE | Estado antes → depois                                           | Controle positivo                                                       | Resultado    |
| --- | ------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------ |
| 1   | Pergunta de outra versão              | nota de resposta da v1 com a pergunta específica da v2                                               | FK composta `response_answers_svq_version_type_fkey` (e `response_answers_response_id_survey_version_id_fkey` ao informar a v2) | 23503    | notas da resposta 0 → 0                                         | pergunta da própria versão aceita (0 → 1)                               | **APROVADO** |
| 2   | Setor divergente                      | resposta da versão do setor A com `sector_id` do setor B                                             | FK composta `responses_survey_version_id_sector_id_fkey`                                                                        | 23503    | respostas da versão 1 → 1; respostas no setor B 0               | resposta com o setor da versão aceita                                   | **APROVADO** |
| 3   | Contato em manifestação anônima       | `INSERT` em `manifestation_contacts` para manifestação `is_anonymous`                                | gatilho `manifestation_contacts_not_anonymous`                                                                                  | 23000    | contatos 0 → 0; manifestação continua anônima                   | manifestação não anônima aceita contato                                 | **APROVADO** |
| 4   | Sobreposição de turnos                | turno 13:00–19:00 UTC da equipe A1, que já tem 10:00–16:00                                           | `EXCLUDE` `shifts_no_overlap_per_team`                                                                                          | 23P01    | turnos ativos da equipe 1 → 1                                   | outra equipe no mesmo horário, turno cancelado e turno contíguo aceitos | **APROVADO** |
| 5   | Exclusão física de setor referenciado | `DELETE FROM sectors` de setor com equipes, turnos, pesquisa e resposta                              | FK `ON DELETE RESTRICT` (`teams_sector_id_fkey` foi a primeira verificada)                                                      | 23503    | setor 1, equipes 2, turnos 1, respostas 1, pesquisas 1 → iguais | —                                                                       | **APROVADO** |
| 6   | Atualização de versão publicada       | `UPDATE survey_versions` de `title`, `thank_you_message`, `version_number`, `published_at`; `DELETE` | gatilhos `survey_versions_immutable` e `survey_versions_no_delete`                                                              | 23000    | título "Pesquisa de teste" → igual                              | `superseded_at` preenchido uma vez; segunda alteração rejeitada         | **APROVADO** |

**Controle negativo (mutação):** num banco descartável (`fhdod_mutacao`), após `migrate deploy`, foram removidos os seis mecanismos; o mesmo teste falhou nos 6 cenários com "O banco aceitou uma operação inválida" ([`t32-mutacao.txt`](t32-mutacao.txt)). Isso comprova que a aprovação depende das restrições do banco, não da aplicação. O banco descartável foi excluído em seguida.

## Seed — contagens reais

Verificadas por `npm run db:seed:verify -w backend` (consultas ao banco), com `SEED_REFERENCE_DATE=2026-10-17`:

| Conjunto                           | Esperado (PDF)          | Obtido                                                                             |
| ---------------------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| Hospitais                          | 1                       | 1                                                                                  |
| Setores / equipes                  | 6 / 18                  | 6 / 18 (3 por setor)                                                               |
| Etapas da jornada                  | 4                       | 4                                                                                  |
| Pesquisas / versões                | 6, PA com v1 e v2       | 6 / 7 (PA: v1 com 399 respostas, v2 com 201)                                       |
| Turnos                             | 150 dias, reforço no PA | 2.764 em 150 dias locais; 64 reforços no PA; 12 cancelados                         |
| Respostas                          | 2.400                   | 2.400 (attributed 1.618; not_qr_origin 699; ambiguous 76, todas no PA; no_shift 7) |
| Manifestações                      | 180                     | 180                                                                                |
| Com contato fictício               | 40%                     | 72 (40%); 0 contatos em manifestações anônimas                                     |
| Usuários de demonstração           | 6 @example.com          | 6 (5 perfis distintos), todos com conta no Supabase Auth local                     |
| Notas específicas / linha do tempo | —                       | 9.350 / 600                                                                        |

Todas as verificações de coerência resultaram em 0 divergências (setor × versão, notas × versão, `low_score`, nota baixa da manifestação, protocolos, tokens consumidos, eventos de criação, arquivadas com motivo).
