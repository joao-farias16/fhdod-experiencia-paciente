# Manifestações, Ouvidoria, dashboard e relatórios Excel — ET07, ET08 e ET09

Documento técnico das etapas ET07 (E03, E35–E40, TL10, TL12, TL13), ET08 (E28–E33, TL03, TL04) e
ET09 (E34, TL14). Fonte oficial: _Especificação de Requisitos FHDOD_ v1.1 (RF40–RF67, RN03–RN05,
RN10, RN12–RN14, RN21–RN23, RN25, RN29; Seções 4.3, 6, 8, 9 e 10).

## Contratos (prefixo `/api/v1`)

| ID  | Método e rota                                  | Acesso                            | Resumo                                                                                                                                                                                                                                         |
| --- | ---------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E03 | `POST /public/manifestations`                  | Público, `Idempotency-Key`, token | 201 `{ protocol, receivedAt }`; 200 com `Idempotent-Replayed` na repetição; 400 validação; 403 `MANIFESTATION_TOKEN_INVALID`; 409 `MANIFESTATION_ALREADY_EXISTS` ou `IDEMPOTENCY_KEY_REUSED`; 422 `MANIFESTATION_TOKEN_EXPIRED`; 10/min por IP |
| E35 | `GET /ouvidoria/manifestations`                | OU (escopo)                       | filtros `status`, `type`, `priority`, `sectorIds` (listas separadas por vírgula), `from`, `to`, `protocol`, `hasContact`, `sort`, `page`, `pageSize` (até 100); trecho de 120 caracteres e `hasContact`                                        |
| E36 | `GET /ouvidoria/manifestations/:id`            | OU (escopo)                       | texto, resposta vinculada, linha do tempo ordenada e `allowedTransitions`; sem contato; auditada (`MANIFESTATION_VIEWED`)                                                                                                                      |
| E37 | `PATCH /ouvidoria/manifestations/:id`          | OU (escopo)                       | `updatedAt` + `status`/`priority`/`actionsTaken` (+ `note`); 409 `STALE_RESOURCE`; 422 `INVALID_STATUS_TRANSITION`, `ACTIONS_REQUIRED`, `NOTE_REQUIRED`; eventos e auditoria `MANIFESTATION_UPDATED`                                           |
| E38 | `POST /ouvidoria/manifestations/:id/notes`     | OU (escopo)                       | `content` 1–2.000; 201 com autor e data; auditoria `MANIFESTATION_NOTE_ADDED`                                                                                                                                                                  |
| E39 | `GET /ouvidoria/manifestations/:id/contact`    | OU (escopo)                       | 200 com `no-store` e texto de finalidade; 404 sem contato; auditoria `MANIFESTATION_CONTACT_VIEWED` a cada consulta (gravada antes da leitura)                                                                                                 |
| E40 | `DELETE /ouvidoria/manifestations/:id/contact` | OU (escopo)                       | corpo `{ reason: holder_request \| return_completed \| other }`; 204; 404; evento `contact_deleted`; auditoria `MANIFESTATION_CONTACT_DELETED`                                                                                                 |
| E28 | `GET /dashboard/summary`                       | Todos adm. (escopo; VI suprimido) | NPS, contagens e percentuais, distribuição 0–10, manifestações por tipo, cobertura; `compare=previous_period`                                                                                                                                  |
| E29 | `GET /dashboard/sectors`                       | idem                              | NPS e n por setor do escopo, ordenados por NPS; sem respostas ao final                                                                                                                                                                         |
| E30 | `GET /dashboard/shifts`                        | idem                              | por período de turno, só atribuídas; `meta.coverage`                                                                                                                                                                                           |
| E31 | `GET /dashboard/teams`                         | idem                              | por equipe, só atribuídas; `meta.coverage`                                                                                                                                                                                                     |
| E32 | `GET /dashboard/trends`                        | idem                              | série sem lacunas; `granularity` `day` (≤ 31 dias), `week` (≤ 180) ou `month`; padrão: a mais fina permitida                                                                                                                                   |
| E33 | `GET /dashboard/questions`                     | idem                              | por pergunta: n, média (2 casas), distribuição 1–5 e % de notas 4 e 5; `journeyStageId`                                                                                                                                                        |
| E34 | `GET /reports/export`                          | por tipo (abaixo)                 | `.xlsx` como anexo, `no-store`; 422 `EXPORT_TOO_LARGE`; 429 (10 a cada 10 min por perfil); auditoria `REPORT_EXPORTED`                                                                                                                         |

Filtros comuns de E28–E34 (Seção 4.3): `from` e `to` (AAAA-MM-DD, inclusivos no fuso
America/Sao_Paulo, padrão últimos 30 dias, até 366 dias, `from > to` → 400), `sectorIds`,
`surveyId`, `period` (`morning`, `afternoon`, `night`), `teamIds` e `origin` (`qr_code`, `link`).
Campos desconhecidos → 400. Setor, pesquisa ou equipe fora do escopo → 403 `SECTOR_OUT_OF_SCOPE`
(auditado como `AUTHORIZATION_DENIED`).

Permissão do E34 por tipo (Tabela 13): `responses` e `indicators` → SA, AS e GE; `manifestations`
→ somente OU. O tipo é lido antes da validação completa para que um perfil sem permissão receba 403.

## Regras aplicadas

- **Token de manifestação (RN22, Seção 4.3):** `base64url(HMAC-SHA256(MANIFESTATION_TOKEN_SECRET,
responseId))`, comparado com `timingSafeEqual`; validade em `manifestation_token_expires_at`
  (60 min) e uso único por `UPDATE ... WHERE manifestation_token_used_at IS NULL` na mesma transação
  da manifestação, do contato e do evento `created`. Ordem dos erros: token inválido (403) →
  já existente (409) → expirado (422).
- **Idempotência do E03 (RN13):** `request_hash` = SHA-256 do JSON canônico do corpo validado;
  envios concorrentes com a mesma chave devolvem o protocolo original (testado com 5 envios).
- **Anonimato (RF42, RN12):** `anonymous` é `true` por padrão; `anonymous: true` com contato → 400;
  não anônima exige nome, telefone (10–11 dígitos, máscara removida) ou e-mail e `consent: true`.
  O aceite grava `consent_given_at` e a versão `v1` do texto de finalidade.
- **Status (RN23):** recebida → em análise/arquivada; em análise → encaminhada/concluída/arquivada;
  encaminhada → em análise/concluída; concluída e arquivada → em análise. Concluir exige
  providências com 10+ caracteres (as já gravadas ou as enviadas); arquivar exige nota; reabrir
  limpa `resolved_at`. Concorrência otimista pelo `updatedAt` exato (milissegundos).
- **NPS (RN03, RF51):** calculado no SQL com o `ROUND` da Seção 8; a tendência soma as contagens por
  dia local e usa `computeNps`, idêntico ao SQL (T05).
- **Cortes por turno e equipe (RN14, RF57):** usam só respostas `attributed`; a cobertura é calculada
  sobre o recorte **sem** os filtros de turno e equipe, para que confira com o banco.
- **Supressão (RN21):** para o Visualizador, grupos com 1 a 4 respostas têm valores **e** n nulos e
  `suppressed: true` (indicadores, distribuição, cobertura, manifestações, setores, turnos, equipes,
  pontos da tendência e perguntas). Grupo com 0 respostas não é suprimido (não há o que esconder).
- **Relatórios (RF63–RF67, RN29):** nome `fhdod_<tipo>_<AAAAMMDD>-<AAAAMMDD>_gerado-<AAAAMMDDHHmm>.xlsx`
  (horário local); cabeçalho congelado em negrito; números como número, datas como data com formato
  `dd/mm/yyyy hh:mm` no horário de Brasília, booleanos como "Sim"/"Não", vazios em branco; aba sem
  linhas recebe "Nenhum registro encontrado para os filtros aplicados."; contatos nunca lidos.

## Decisões onde a especificação não detalha

| Tema                                 | Decisão adotada                                                                                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Período padrão da lista da Ouvidoria | RN25 vale também para E35: últimos 30 dias por `received_at`; a tela permite ampliar até 366 dias.                                                   |
| Tamanho de `actionsTaken`            | 1 a 2.000 caracteres (mesmo limite da descrição e das notas).                                                                                        |
| Status igual ao atual no E37         | 422 `INVALID_STATUS_TRANSITION` ("já está neste status").                                                                                            |
| Ordem dos eventos de uma alteração   | providências → prioridade → nota → status, com milissegundos consecutivos para preservar a ordem na linha do tempo.                                  |
| Manifestações por tipo no E28        | manifestações das respostas do recorte (mesmos filtros), não pela data de recebimento.                                                               |
| Semanas do E32                       | blocos de 7 dias a partir de `from` (o último pode ser menor); meses do calendário recortados pelo período.                                          |
| Setores no E29                       | setores ativos do escopo sempre aparecem; inativos só quando têm respostas no período.                                                               |
| Título por pergunta no E33           | agrupamento por pergunta (`question_id`), pois o texto publicado é imutável (RN17); título da pesquisa = o da versão mais recente do recorte (RN15). |
| Filtro por pesquisa na interface     | exibido só para perfis que consultam pesquisas (SA, AS — E22); a API aceita `surveyId` de todos os perfis com o escopo verificado.                   |
| Tela inicial da Ouvidoria            | continua `/painel` (RF01 não define outra); a Ouvidoria tem o item próprio no menu.                                                                  |
| Exportação na tela do painel (RF62)  | botões para os tipos permitidos ao perfil (respostas e indicadores); manifestações ficam na TL14.                                                    |
| `includeText` em outros tipos        | 400 (filtro exclusivo do relatório de manifestações).                                                                                                |
| Auditoria do E03                     | não auditado: a criação pública não está no catálogo da Seção 10 (consultas, alterações, notas e contato da Ouvidoria estão).                        |

## Interface

- **TL10/TL11 (`/p/:slug`):** após o envio, nota baixa (RN05) mostra em destaque "Quer contar o que
  aconteceu?" com **Registrar manifestação** e **Não, obrigado**; sem nota baixa, a ação secundária
  "Deixar um elogio, sugestão ou reclamação". O formulário (tipo, descrição com contador,
  "Enviar sem me identificar" como padrão, contato com finalidade e aceite) fica só em memória; o
  retorno automático de 30 s pausa enquanto a pessoa escreve e a inatividade de 3 min + 60 s apaga
  tudo. A confirmação mostra o protocolo.
- **TL12 (`/ouvidoria/manifestacoes`):** filtros e tabela com protocolo, data, setor, tipo, status,
  prioridade, trecho e "Contato: Sim/Não".
- **TL13 (`/ouvidoria/manifestacoes/:id`):** relato, avaliação vinculada, tratamento (só as
  transições permitidas), notas, linha do tempo, contato por ação explícita e eliminação com
  confirmação e motivo; 409 oferece "Recarregar a versão atual".
- **TL03 (`/painel`) e TL04 (`/painel/setores/:sectorId`):** filtros em uma linha acima dos gráficos,
  refletidos na URL; cartões sempre com o n; distribuição 0–10 com valores e percentuais escritos;
  tendência em SVG com dica por mouse/foco e tabela alternativa; setores, perguntas por etapa,
  turnos, equipes e cobertura; "menos de 5 respostas" para o VI; atualização ao filtrar, pelo botão
  **Atualizar** e a cada 60 s com a aba visível (TanStack Query pausa em segundo plano).
- **TL14 (`/relatorios`):** tipos conforme a permissão, filtros comuns e, para a Ouvidoria, status,
  tipo e **Incluir textos**.

Os gráficos são de série única (uma cor da marca, `#1D4ED8`, contraste 6,7:1 com o branco), sem
legenda, com valores escritos e tabela alternativa — nenhuma informação apenas por cor (RNF08).
Não foi adicionada biblioteca de gráficos.

## Testes

| Teste | Nível e arquivo                                                                                                  |
| ----- | ---------------------------------------------------------------------------------------------------------------- |
| T07   | integração `backend/tests/db/t07-t10-manifestacao-publica.test.ts`; componente `ManifestationForm.test.tsx`; E2E |
| T08   | integração (padrão anônimo; anônima com contato → 400); componente; E2E                                          |
| T09   | integração (só e-mail, só telefone, sem aceite, 9 dígitos); componente; E2E                                      |
| T10   | integração do E03 (mesma chave, corpo diferente, 5 concorrentes)                                                 |
| T18   | integração `t18-t19-ouvidoria.test.ts`; componente `ombudsman.test.tsx`; E2E                                     |
| T19   | integração; componente; E2E                                                                                      |
| T05   | integração `t36-t37-dashboard.test.ts` (E28 = `computeNps` com (4,3,3) e (1,15,0)); unidade da ET06              |
| T11   | integração (E02 → E28 + 1); componente `dashboard.test.tsx` (60 s e Atualizar); E2E                              |
| T36   | integração (E28, E29, E32, E33, comparação, filtro vazio, VI com 4 e 5 respostas)                                |
| T37   | integração (00:00 e 23:59:59 locais, 366/367 dias, from > to, turno e equipe, escopo)                            |
| T20   | integração `t20-t21-exportacao.test.ts` (três tipos e vazio abertos com ExcelJS); E2E (download do `.xlsx`)      |
| T21   | integração (matriz por perfil, auditoria, 11ª exportação → 429, 50.001 linhas → 422)                             |

T14 e T15 também passaram a chamar as rotas reais de E28, E29, E33, E34 e E35 (as rotas-sonda da
ET03 foram removidas).

## Supabase e Figma

- **Local:** Supabase CLI (`npm run db:start`), PostgreSQL 54322 com os bancos `postgres`
  (desenvolvimento, seed) e `fhdod_test` (testes). As ET07–ET09 **não criaram migrations**: as
  tabelas `manifestations`, `manifestation_contacts`, `manifestation_notes`, os gatilhos e a
  sequência do protocolo já existiam desde a ET02.
- **Remoto:** um único projeto (`mowxlbpwhcsurjpcrpra`, "FHDOD - Experiência do Paciente",
  sa-east-1, PostgreSQL 17, plano gratuito). Em 28/10/2026 a consulta somente leitura mostrou
  **0 tabelas no esquema `public` e 0 migrations**: o esquema nunca foi publicado. A causa é de
  processo, não de código: a aplicação das migrations na nuvem pertence à ET12 (Tabela 27), o
  `supabase/` local não está vinculado ao projeto (`supabase link` nunca foi executado) e as
  variáveis locais apontam para `127.0.0.1`. Não há evidência que classifique o projeto como
  desenvolvimento ou homologação — pela Tabela 26 ele é o banco **de publicação**. Por isso nada foi
  alterado remotamente.
- **Para publicar (ET12, com autorização):** `DATABASE_URL`/`DIRECT_URL` do pooler no ambiente do
  Render, `npx prisma migrate deploy` (as 5 migrations), seed somente com `SEED_ALLOW_REMOTE` e dados
  fictícios, Data API desligada e `MANIFESTATION_TOKEN_SECRET`/`AUDIT_IP_SECRET` com 32+ caracteres.
- **Figma (28/10/2026):** arquivo `sistema-hospital`
  ([link](https://www.figma.com/design/kcRMvRhHs8IYRfsZkv1BLZ/sistema-hospital)). Todo o conteúdo fica
  na página **Page 1**, organizado em seções:
  - **Componentes FHDOD:** cores do `styles/index.css` (Tailwind) como variáveis `FHDOD — Cores`,
    estilos de texto em Inter (Tabela 22), ícones Lucide usados no frontend e componentes com
    variantes — Botão, Campo (texto e seleção), Aviso, Etiqueta, Item de menu, Marca FHDOD, Cartão de
    indicador, Opção da escala, Caixa de seleção, Opção de rádio, Rodapé e Paginação.
  - **Acesso, usuários e auditoria (ET03):** TL01 Login, TL02 Troca obrigatória de senha, TL16
    Gestão de usuários, TL17 Auditoria e Acesso não permitido.
  - **Estrutura, escalas e pesquisas (ET04 e ET05):** TL05 Setores e equipes, TL06 Escala e turnos,
    TL07 Importação de escalas, TL08 Pesquisas (lista), TL08 Configuração de pesquisa e TL08 Cartaz
    A4 do QR Code.
  - **Público — início, pesquisa e manifestação (ET01, ET06 e ET07):** Início, Página não
    encontrada, TL09 Pesquisa pública (pergunta geral, perguntas da etapa e pesquisa indisponível),
    TL10 Manifestação e TL11 Confirmação (oferta após nota baixa e protocolo); TL09 a TL11 no
    formato de celular.
  - **Indicadores, Ouvidoria e relatórios (ET07, ET08 e ET09):** TL03 Dashboard geral, TL04
    Dashboard por setor, TL12 Lista de manifestações, TL13 Detalhes da manifestação e TL14
    Exportação de relatórios.
  - Os frames seguem a nomenclatura da Seção 11 (`TLxx – Nome – Dispositivo – Estado`), com textos,
    campos, botões e ícones editáveis e somente dados fictícios. O QR Code das telas da TL08 é um
    desenho ilustrativo, não um código válido. Diálogos (novo usuário, senha temporária e
    confirmações) não têm frames próprios.
  - **Etapas futuras:** a TL15 TV Wall (ET10) ainda não foi implementada no frontend e não tem tela
    no Figma.
  - **Pendente:** revisão cruzada das telas no Figma, feita na revisão de cada etapa (Tabela 27).
