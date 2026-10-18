# Verificação do seed — 2026-10-18T00:14:11Z

- Banco: `postgresql://localhost:5433/fhdod` (PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2))
- Comando: `npm run db:seed:verify -w backend`

| Verificação                                                                       | Esperado | Obtido | Resultado |
| --------------------------------------------------------------------------------- | -------- | ------ | --------- |
| Hospitais                                                                         | 1        | 1      | APROVADO  |
| Setores                                                                           | 6        | 6      | APROVADO  |
| Equipes                                                                           | 18       | 18     | APROVADO  |
| Setores sem exatamente 3 equipes                                                  | 0        | 0      | APROVADO  |
| Etapas da jornada                                                                 | 4        | 4      | APROVADO  |
| Pesquisas                                                                         | 6        | 6      | APROVADO  |
| Pesquisas com versão vigente                                                      | 6        | 6      | APROVADO  |
| Versões publicadas                                                                | 7        | 7      | APROVADO  |
| Versões do Pronto Atendimento (v1 e v2)                                           | 2        | 2      | APROVADO  |
| Versões substituídas (v1 do PA)                                                   | 1        | 1      | APROVADO  |
| Perguntas                                                                         | 43       | 43     | APROVADO  |
| Perguntas gerais (nps), uma por pesquisa                                          | 6        | 6      | APROVADO  |
| Perguntas das versões                                                             | 49       | 49     | APROVADO  |
| Usuários de demonstração                                                          | 6        | 6      | APROVADO  |
| Usuários fora de @example.com                                                     | 0        | 0      | APROVADO  |
| Perfis distintos                                                                  | 5        | 5      | APROVADO  |
| Turnos (rodízio de 3 períodos × 150 dias × 6 setores + reforços do PA)            | > 2.700  | 2764   | APROVADO  |
| Dias locais distintos com turnos                                                  | 150      | 150    | APROVADO  |
| Turnos de reforço do PA (sobreposição entre equipes)                              | > 0      | 64     | APROVADO  |
| Turnos cancelados                                                                 | 12       | 12     | APROVADO  |
| Respostas                                                                         | 2400     | 2400   | APROVADO  |
| Respostas ambíguas (todas no PA)                                                  | > 0      | 76     | APROVADO  |
| Respostas ambíguas fora do PA                                                     | 0        | 0      | APROVADO  |
| Respostas atribuídas a turno e equipe                                             | > 0      | 1618   | APROVADO  |
| Respostas por link (not_qr_origin)                                                | > 0      | 699    | APROVADO  |
| Respostas com setor diferente do setor da versão                                  | 0        | 0      | APROVADO  |
| Notas específicas de outra versão                                                 | 0        | 0      | APROVADO  |
| low_score incoerente com as notas                                                 | 0        | 0      | APROVADO  |
| Manifestações                                                                     | 180      | 180    | APROVADO  |
| Manifestações com contato fictício (40%)                                          | 72       | 72     | APROVADO  |
| Manifestações não anônimas                                                        | 72       | 72     | APROVADO  |
| Contatos em manifestações anônimas                                                | 0        | 0      | APROVADO  |
| Contatos fora do padrão fictício (nome, telefone 5190000NNNN, e-mail example.com) | 0        | 0      | APROVADO  |
| Protocolos no formato FHD-AAAA-NNNNNN                                             | 180      | 180    | APROVADO  |
| Manifestações cuja nota baixa diverge da resposta                                 | 0        | 0      | APROVADO  |
| Tokens de manifestação consumidos                                                 | 180      | 180    | APROVADO  |
| Manifestações sem evento de criação na linha do tempo                             | 0        | 0      | APROVADO  |
| Arquivadas sem nota de motivo                                                     | 0        | 0      | APROVADO  |
| Registros de auditoria                                                            | 0        | 0      | APROVADO  |

## Respostas por setor

| Item        | Total |
| ----------- | ----- |
| AMBULATORIO | 480   |
| IMAGEM      | 240   |
| INTERNACAO  | 480   |
| MATERNIDADE | 360   |
| PA          | 600   |
| UTI         | 240   |

## Respostas por status de atribuição

| Item          | Total |
| ------------- | ----- |
| ambiguous     | 76    |
| attributed    | 1618  |
| no_shift      | 7     |
| not_qr_origin | 699   |

## Respostas por origem

| Item    | Total |
| ------- | ----- |
| link    | 699   |
| qr_code | 1701  |

## Respostas por versão do PA

| Item | Total |
| ---- | ----- |
| v1   | 399   |
| v2   | 201   |

## Manifestações por tipo

| Item       | Total |
| ---------- | ----- |
| complaint  | 108   |
| compliment | 32    |
| suggestion | 40    |

## Manifestações por status

| Item      | Total |
| --------- | ----- |
| archived  | 17    |
| forwarded | 29    |
| in_review | 37    |
| received  | 27    |
| resolved  | 70    |

## Contatos por canal

| Item              | Total |
| ----------------- | ----- |
| somente e-mail    | 24    |
| somente telefone  | 24    |
| telefone e e-mail | 24    |

## Linha do tempo por tipo de evento

| Item             | Total |
| ---------------- | ----- |
| actions_updated  | 70    |
| created          | 180   |
| note             | 54    |
| priority_changed | 11    |
| status_changed   | 285   |

## Outras contagens

| Item                | Total |
| ------------------- | ----- |
| response_answers    | 9350  |
| manifestation_notes | 600   |
| profile_sectors     | 4     |
| shift_imports       | 0     |
| shifts              | 2764  |

## NPS geral do conjunto (consulta da Seção 8)

Total 2400; promotores 1427; passivos 575; detratores 398; NPS 42.9.

## Impressão digital (md5 por tabela)

| Tabela                   | md5                                |
| ------------------------ | ---------------------------------- |
| hospitals                | `d9e8c0c1e5ea12ad352d53b4885fc279` |
| sectors                  | `bbe50ef5e3561b458dd78f3098d1a30d` |
| teams                    | `5a2bbb340bd2b05f6fefa714474e2b2b` |
| journey_stages           | `8d3581b958528c7145d6caf5bd936f89` |
| profiles                 | `a03e8aef5e75d86aa51bb007ab4fbfcf` |
| profile_sectors          | `4d83a2fc0a0da86387b0fa0b963779d8` |
| survey_configs           | `a8f0f14bc659d6ce6b5de2586bf96f41` |
| questions                | `dccbe251e592d8f598e36c96f2d737ce` |
| survey_versions          | `9b70c62cfe00e33c4d96f3c0a30515b3` |
| survey_version_questions | `841bcd89b9ef7cc44d826355fefd3375` |
| shifts                   | `5d2aad7cb3c64e1d114657f33bd5b345` |
| responses                | `126abd119103846f2cf4ec07f2c3d09d` |
| response_answers         | `4be77f71cd0383ee40c0a53f48ea0b5e` |
| manifestations           | `92095ec060be3c76ee0f047892b598b2` |
| manifestation_contacts   | `37c3f748701711881e70f9b5d932cfa0` |
| manifestation_notes      | `9fd039a8ae7447c0ef7f7d8441d17949` |

**Resultado: APROVADO**
