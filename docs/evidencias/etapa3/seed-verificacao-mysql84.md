# Verificação do seed — 2026-11-05T22:17:59Z

- Banco: `mysql://127.0.0.1:33306/fhdod_wb` (MySQL 8.4.13)
- Comando: `npm run db:seed:verify`

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
| Turnos (rodízio de 3 períodos × 150 dias × 6 setores + reforços do PA)            | > 2.700  | 2765   | APROVADO  |
| Dias locais distintos com turnos                                                  | 150      | 150    | APROVADO  |
| Turnos de reforço do PA (sobreposição entre equipes)                              | > 0      | 65     | APROVADO  |
| Turnos cancelados                                                                 | 12       | 12     | APROVADO  |
| Respostas                                                                         | 2400     | 2400   | APROVADO  |
| Respostas ambíguas (todas no PA)                                                  | > 0      | 80     | APROVADO  |
| Respostas ambíguas fora do PA                                                     | 0        | 0      | APROVADO  |
| Respostas atribuídas a turno e equipe                                             | > 0      | 1612   | APROVADO  |
| Respostas por link (not_qr_origin)                                                | > 0      | 705    | APROVADO  |
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
| attributed    | 1612  |
| not_qr_origin | 705   |
| no_shift      | 3     |
| ambiguous     | 80    |

## Respostas por origem

| Item    | Total |
| ------- | ----- |
| qr_code | 1695  |
| link    | 705   |

## Respostas por versão do PA

| Item | Total |
| ---- | ----- |
| v1   | 385   |
| v2   | 215   |

## Manifestações por tipo

| Item       | Total |
| ---------- | ----- |
| compliment | 35    |
| complaint  | 103   |
| suggestion | 42    |

## Manifestações por status

| Item      | Total |
| --------- | ----- |
| received  | 37    |
| in_review | 41    |
| forwarded | 19    |
| resolved  | 69    |
| archived  | 14    |

## Contatos por canal

| Item              | Total |
| ----------------- | ----- |
| somente e-mail    | 24    |
| somente telefone  | 24    |
| telefone e e-mail | 24    |

## Linha do tempo por tipo de evento

| Item             | Total |
| ---------------- | ----- |
| created          | 180   |
| status_changed   | 265   |
| priority_changed | 12    |
| actions_updated  | 69    |
| note             | 47    |

## Outras contagens

| Item                | Total |
| ------------------- | ----- |
| response_answers    | 9330  |
| manifestation_notes | 573   |
| profile_sectors     | 4     |
| shift_imports       | 0     |
| shifts              | 2765  |

## NPS geral do conjunto (consulta da Seção 8)

Total 2400; promotores 1424; passivos 577; detratores 399; NPS 42.7.

## Impressão digital (md5 por tabela)

| Tabela                   | md5                                |
| ------------------------ | ---------------------------------- |
| hospitals                | `c751369d1d81228dfa148ef5fea25a7e` |
| sectors                  | `994978ec1e192027406d7b08b76ddd23` |
| teams                    | `a43f962ac37e3aba30bda1394462eb1e` |
| journey_stages           | `ce2b3b58ca8b4077ddd066e6e730f06c` |
| profiles                 | `7a0750f76888b55ff0b7d973d2eaea1d` |
| profile_sectors          | `d892822e1011f81e670d96fda4c46770` |
| survey_configs           | `6475a2873359a26c812bd3dc79f4d64d` |
| questions                | `e2727a6e7881bd216d23e102707952ff` |
| survey_versions          | `15805927109b20c8d815109d370bcdda` |
| survey_version_questions | `b3f5089316d411c3b41828f885e8d5c1` |
| shifts                   | `77cfc1a03aec6dcdcf1792267e7bd869` |
| responses                | `ca73c512db67d3946ef11642d0984313` |
| response_answers         | `ed57900ae922039826f1118c73edcc3c` |
| manifestations           | `40490d34e0f3598659c9933de09ea0b3` |
| manifestation_contacts   | `2bdc84df9b89d4842485975c21297d10` |
| manifestation_notes      | `8f0e468373c7f8ac0c55242e3afcbb21` |

**Resultado: APROVADO**
