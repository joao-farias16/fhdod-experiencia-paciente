# Autenticação, permissões e auditoria — ET03

Referência técnica da ET03 (Tabela 27: **E04–E09, E41, TL01, TL02, TL16, TL17; T12–T17**). Requisitos: RF01–RF11, RN10, RN11, RN16, RN18, RN24, RN25 e RN28; Seções 6, 9 e 10 da especificação.

## Visão geral

```text
Navegador ── supabase-js (chave publicável) ──► Supabase Auth  (login, renovação, signOut)
    │
    └── Authorization: Bearer <access token> ──► API /api/v1 ──► Prisma ──► PostgreSQL
                                                   │
                                                   └── supabase-js (chave secreta, só no servidor):
                                                       auth.getUser, admin.createUser/updateUserById/deleteUser
```

- **Senhas** existem somente no Supabase Auth. A aplicação nunca as grava, registra em log ou audita.
- **Cadastro público desligado** (`supabase/config.toml`: `[auth] enable_signup = false`); contas são criadas somente pelo SA (E07).
- **Recuperação de acesso** é a redefinição assistida pelo SA (RF03). Não há recuperação por e-mail (RF73, fora do MVP).

## Cadeia de middlewares (Seção 6)

```text
/api/v1/me, /api/v1/me/password        /api/v1/admin/*
  authenticate                           authenticate
  limite 300/min por perfil              limite 300/min por perfil
  (E05: + 5 a cada 15 min)               requirePasswordChanged
  requirePermission(E04|E05)             requirePermission(Exx)
  controlador → serviço                  controlador → serviço (escopo de req.auth)
        ↓ erros
  notFoundHandler → auditAuthorizationDenials → errorHandler
```

| Etapa                       | Arquivo                           | Resultado                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authenticate`              | `src/middlewares/authenticate.ts` | `Authorization` ausente, sem `Bearer`, malformado (não é JWT), expirado, adulterado, revogado (signOut) ou de conta inexistente → **401 UNAUTHENTICATED**. Token válido de conta **sem perfil** → 401. Perfil `is_active = false` **ou** conta bloqueada no Supabase (`user_banned`) → **403 ACCOUNT_DISABLED**, mesmo com token ainda válido. Define `Cache-Control: no-store`. |
| `requirePasswordChanged`    | `src/middlewares/authorize.ts`    | `must_change_password = true` → **403 PASSWORD_CHANGE_REQUIRED** em toda rota exceto E04 e E05.                                                                                                                                                                                                                                                                                  |
| `requirePermission(Exx)`    | `src/middlewares/authorize.ts`    | Permissão do endpoint (catálogo `ENDPOINTS`) ausente no perfil → **403 FORBIDDEN**.                                                                                                                                                                                                                                                                                              |
| Escopo                      | `src/services/scope.ts`           | `resolveSectorFilter`/`sectorWhere`: interseção filtro × escopo nas consultas; filtro com setor fora → **403 SECTOR_OUT_OF_SCOPE**. `assertResourceInScope`: recurso de outro setor → **404 NOT_FOUND** (indistinguível de inexistente).                                                                                                                                         |
| `auditAuthorizationDenials` | `src/middlewares/authorize.ts`    | Grava **um** `AUTHORIZATION_DENIED` por negativa (FORBIDDEN ou SECTOR_OUT_OF_SCOPE). Se a gravação falhar, a resposta continua 403.                                                                                                                                                                                                                                              |

`req.auth` (`AuthContext`): `profileId`, `authUserId`, `hospitalId`, `role`, `scope` (`{ all: true }` ou `{ all: false, sectorIds }`), `mustChangePassword` e `tokenIssuedAt`. O perfil é lido **a cada requisição**: alteração de perfil, escopo ou situação vale na requisição seguinte.

### Validação do token

`src/lib/supabase.ts` usa `auth.getUser(token)` do supabase-js com a chave secreta. Mapeamento verificado contra o Supabase local:

| Resposta do Supabase Auth                          | Resultado                                            |
| -------------------------------------------------- | ---------------------------------------------------- |
| usuário                                            | válido (lê `iat` do token já validado)               |
| `403 user_banned`                                  | bloqueado → perfil pelo `sub` → 403 ACCOUNT_DISABLED |
| `AuthSessionMissingError` (sessão encerrada)       | inválido → 401                                       |
| demais 4xx (`bad_jwt`, expirado, `user_not_found`) | inválido → 401                                       |
| rede, 5xx ou exceção                               | 503 SERVICE_UNAVAILABLE                              |

Tokens sem o formato JWT nem chegam ao Supabase. `createApp(deps)` recebe o verificador (`TokenVerifier`) e as operações administrativas (`AuthAdmin`) por injeção, permitindo testes de integração com PostgreSQL real e verificador falso (Seção 12).

## Perfis e matriz de permissões (Tabela 13)

Fonte única: `backend/src/modules/auth/permissions.ts` (`PERMISSIONS`, `ROLE_PERMISSIONS`, `ENDPOINTS`). O E04 devolve a lista de permissões do perfil; o frontend monta o menu a partir dela, mas **ocultar menus não é controle de acesso** — toda rota é verificada no backend.

| Recurso (endpoints)                         | SA        | AS              | GE  | OU                  | VI              |
| ------------------------------------------- | --------- | --------------- | --- | ------------------- | --------------- |
| Próprio perfil e senha (E04, E05)           | CA        | CA              | CA  | CA                  | CA              |
| Usuários e senha temporária (E06–E09)       | C I A D S | –               | –   | –                   | –               |
| Setores (E10; E11–E12)                      | CIAD      | C\*             | C\* | C\*                 | C\*             |
| Equipes (E13; E14–E15)                      | CIAD      | C\* I\* A\* D\* | C\* | C\*                 | C\*             |
| Etapas da jornada (E16)                     | C         | C               | –   | –                   | –               |
| Turnos e importação (E17–E21)               | C I D     | C\* I\* D\*     | –   | –                   | –               |
| Pesquisas e QR Code (E22–E27)               | CIAD      | C\* I\* A\* D\* | –   | –                   | –               |
| Indicadores (E28–E33)                       | C         | C\*             | C\* | C\*                 | C\* (supressão) |
| Relatórios de respostas e indicadores (E34) | X         | X\*             | X\* | –                   | –               |
| Relatório de manifestações (E34)            | –         | –               | –   | X\*                 | –               |
| Manifestações, notas, contato (E35–E40)     | –         | –               | –   | C\* I\* A\* S\* D\* | –               |
| Auditoria (E41)                             | C         | –               | –   | –                   | –               |

`*` = restrito ao escopo de setores. Nesta etapa existem as rotas E04–E10 e E41; as demais etapas usam o mesmo catálogo ao implementar suas rotas (o T14 já verifica a matriz inteira).

### Escopo (RN18)

| Perfil     | Escopo                                                     | Violação no cadastro/edição |
| ---------- | ---------------------------------------------------------- | --------------------------- |
| SA         | sempre global                                              | 400 VALIDATION_ERROR        |
| AS         | ao menos um setor; nunca global                            | 400 VALIDATION_ERROR        |
| GE, OU, VI | global (`allSectors`) **ou** ao menos um setor (não ambos) | 400 VALIDATION_ERROR        |

Novos vínculos exigem setores **existentes** (422 `INVALID_SCOPE`) e **ativos** (422 `SECTOR_INACTIVE`). Um vínculo já existente com setor desativado depois pode ser mantido (histórico, RF15). Escopo restrito vazio (situação só possível por inconsistência de dados) resulta em listas vazias e 403 em qualquer filtro.

## Contratos (prefixo `/api/v1`)

Todas as rotas abaixo exigem `Authorization: Bearer <token>`, respondem `Cache-Control: no-store`, usam esquemas Zod estritos (campo desconhecido → 400) e o envelope de erro `{ error: { code, message, details, requestId } }`.

### E04 — `GET /me` (todos os perfis)

200:

```json
{
  "data": {
    "id": "uuid",
    "fullName": "Superadministrador",
    "email": "superadmin@example.com",
    "role": "superadmin",
    "allSectors": true,
    "sectors": [{ "id": "uuid", "code": "PA", "name": "Pronto Atendimento", "isActive": true }],
    "mustChangePassword": false,
    "permissions": ["profile:read", "profile:change_password", "users:read", "..."]
  }
}
```

401 UNAUTHENTICATED; 403 ACCOUNT_DISABLED. Responde mesmo com troca de senha pendente.

### E05 — `POST /me/password` (todos os perfis)

Corpo `{ "newPassword": "..." }` — 10 a 72 caracteres, ao menos uma letra (A–Z) e um número (RN28). 204 sem corpo. 400 VALIDATION_ERROR (senha fora da política; a mensagem nunca repete a senha); 401 se a sessão é anterior à última redefinição assistida; 429 RATE_LIMITED (5 a cada 15 min por perfil). Atualiza a senha no Supabase Auth (o que revoga os tokens de renovação do usuário) e `must_change_password = false`, com auditoria `PASSWORD_CHANGED` (`{ mandatory }`). Funciona com troca pendente.

### E06 — `GET /admin/users` (SA)

Query: `role`, `isActive` (`true`/`false`), `sectorId`, `search` (nome ou e-mail, até 120), `page` (≥ 1), `pageSize` (1–100, padrão 20). 200 `{ data: User[], meta: { page, pageSize, total } }`, ordenado por nome; somente usuários do hospital do SA.

`User`: `id`, `fullName`, `email`, `role`, `allSectors`, `sectors[]`, `isActive`, `mustChangePassword`, `deactivatedAt`, `createdAt`, `updatedAt` (o id do Supabase Auth não é exposto).

### E07 — `POST /admin/users` (SA)

Corpo: `fullName` (3–120), `email` (normalizado em minúsculas), `role`, `allSectors?` (padrão: `true` para SA, `false` para os demais), `sectorIds?` (UUIDs sem repetição, até 50).

201 `{ data: { user: User, temporaryPassword: "16 caracteres" } }` com `no-store` — a senha temporária só aparece nesta resposta. 400 (validação e RN18, inclusive **AS sem setor**, RF06); 409 CONFLICT (e-mail já cadastrado na aplicação ou no Supabase Auth); 422 INVALID_SCOPE ou SECTOR_INACTIVE.

Fluxo: verifica e-mail e setores → cria a conta no Supabase Auth (e-mail confirmado, senha temporária CSPRNG) → transação: `profiles` (`must_change_password = true`, `created_by`), `profile_sectors` e auditoria `USER_CREATED`. **Compensação:** se a transação falhar (inclusive a auditoria), a conta do Auth é excluída; nenhuma conta órfã permanece.

### E08 — `PATCH /admin/users/:id` (SA)

Corpo (ao menos um campo): `fullName`, `role`, `allSectors`, `sectorIds`, `isActive`. `email` é imutável (campo desconhecido → 400).

- Conveniências: passar a SA ou `allSectors: true` sem `sectorIds` remove os vínculos; informar `sectorIds` sem `allSectors` torna o escopo restrito.
- Para si, o SA só altera o nome: perfil, escopo ou situação → **422 SELF_MODIFICATION_FORBIDDEN**.
- Desativar ou rebaixar o último SA ativo do hospital → **422 LAST_SUPERADMIN** (verificado com `SELECT … FOR UPDATE` dos SA ativos e do alvo, em ordem de id).
- `isActive: false` grava `deactivated_at`/`deactivated_by` e bloqueia a conta no Supabase (`ban_duration`); `true` libera. A chamada ao Supabase é o último passo da transação: se falhar, nada é gravado (503); se o COMMIT falhar depois, o bloqueio é revertido.
- Um registro por operação: `USER_DEACTIVATED`, `USER_REACTIVATED` ou `USER_UPDATED` (detalhes: `changedFields`, `roleFrom/roleTo`, `allSectors`, `sectorIdsAdded/Removed`). Requisição sem mudança efetiva não gera registro.
- 200 `{ data: User }`; 404 para usuário inexistente ou de outro hospital.

### E09 — `POST /admin/users/:id/reset-password` (SA)

Sem corpo. 200 `{ data: { temporaryPassword } }` (no-store). 422 SELF_MODIFICATION_FORBIDDEN (o próprio usuário) ou USER_INACTIVE (conta desativada); 404. Marca `must_change_password = true`, audita `USER_PASSWORD_RESET` (`{ changeRequired: true }`, sem a senha) e troca a senha no Supabase como último passo da transação. A senha anterior deixa de autenticar e os tokens de renovação são revogados; um access token emitido antes da redefinição não consegue concluir o E05 (comparação do `iat` com o registro de auditoria da redefinição).

### E10 — `GET /admin/sectors` (todos os perfis; escopo)

Antecipado da ET04 **somente para leitura**, pois a TL16 associa usuários a setores. Query `isActive`, `search`. 200 com os setores do escopo (inclusive inativos, para histórico) e as contagens `activeTeams` e `activeSurveys`. E11–E27, E01 e E02 foram implementados nas ET04–ET06: ver [`setores-escalas-e-pesquisas.md`](setores-escalas-e-pesquisas.md).

### E41 — `GET /admin/audit-logs` (SA)

Query: `from`, `to` (AAAA-MM-DD no fuso America/Sao_Paulo, inclusivos; padrão: últimos 30 dias; até 366 dias; `from ≤ to`), `actorProfileId`, `action`, `entityType`, `entityId`, `page`, `pageSize` (1–**100**, padrão 50). 200 `{ data: AuditLog[], meta: { page, pageSize, total, from, to } }` em ordem decrescente. `AuditLog`: `id`, `occurredAt`, `actor { id, fullName, role } | null`, `action`, `entityType`, `entityId`, `sectorId`, `details`, `requestId`. O HMAC do IP não é devolvido. Somente eventos de autores do hospital do SA.

## Senhas (RN28, RF03, RF04)

- Política: 10–72 caracteres, letra A–Z e número (backend `password-policy.ts`, interface `password-rules.ts` e Supabase `password_requirements = "letters_digits"`).
- Senha temporária: 16 caracteres de um alfabeto sem ambíguos (sem 0/O/1/l/I), sorteados com `crypto.randomInt` (CSPRNG, sem viés), sempre com letra e número. Exibida uma única vez (diálogo da TL16, que a descarta ao fechar).
- Troca obrigatória no primeiro acesso e após redefinição: o backend bloqueia tudo exceto E04/E05 (403 PASSWORD_CHANGE_REQUIRED) e a interface leva à TL02.

## Auditoria (RF10, RF11, RN16)

| Ação                   | Operação                            | Detalhes permitidos                                                                       |
| ---------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------- |
| `USER_CREATED`         | E07                                 | `role`, `allSectors`, `sectorIds`                                                         |
| `USER_UPDATED`         | E08 (nome, perfil, escopo)          | `changedFields`, `roleFrom`, `roleTo`, `allSectors`, `sectorIdsAdded`, `sectorIdsRemoved` |
| `USER_DEACTIVATED`     | E08 `isActive: false`               | idem                                                                                      |
| `USER_REACTIVATED`     | E08 `isActive: true`                | idem                                                                                      |
| `USER_PASSWORD_RESET`  | E09                                 | `changeRequired`                                                                          |
| `PASSWORD_CHANGED`     | E05                                 | `mandatory`                                                                               |
| `AUTHORIZATION_DENIED` | 403 FORBIDDEN / SECTOR_OUT_OF_SCOPE | `code`, `method`, `permission` (entidade `endpoint`, id = Exx)                            |

Cada registro traz autor e perfil, entidade, `request_id` (o mesmo `X-Request-Id` da resposta) e `ip_hash` = HMAC-SHA256 do IP com `AUDIT_IP_SECRET` (nunca o IP em claro). `recordAudit` grava **na mesma transação** da operação (falha ao auditar desfaz a operação) e recusa chaves de detalhe que lembrem senha, token, segredo, e-mail, nome, telefone, IP ou contato. `audit_logs` aceita somente inserção — `UPDATE`, `DELETE` e `TRUNCATE` são rejeitados pelos gatilhos da ET02 (verificado no T17). As próximas etapas acrescentam ao catálogo as ações de setores, equipes, turnos, importações, pesquisas, exportações e manifestações (Seção 10).

## Interface (Seção 11)

| Tela | Rota               | Perfis  | Conteúdo                                                                                                                                                                    |
| ---- | ------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TL01 | `/login`           | Público | E-mail, senha (mostrar/ocultar), mensagem genérica, aviso de ambiente acadêmico, orientação de recuperação assistida                                                        |
| TL02 | `/trocar-senha`    | Todos   | Nova senha com as regras visíveis e marcadas em tempo real, confirmação; também usada para a troca voluntária                                                               |
| TL16 | `/admin/usuarios`  | SA      | Lista com filtros e paginação, cadastro/edição em diálogo, escopo por setor, desativação/reativação com confirmação, redefinição de senha, senha temporária exibida uma vez |
| TL17 | `/admin/auditoria` | SA      | Eventos com filtros (período, autor, ação, entidade, identificador), itens por página (até 100), detalhes legíveis                                                          |
| —    | `/painel`          | Todos   | Página inicial provisória dos perfis sem TL16 (perfil e escopo); o dashboard (TL03) é da ET08                                                                               |

- **Sessão**: supabase-js com `sessionStorage` (chave `fhdod-admin-auth`), carregado **sob demanda** só na área administrativa (pacote separado; a pesquisa pública e a TV Wall não o carregam). A chave secreta nunca vai ao navegador (`env.ts` recusa `sb_secret_…` e JWT de `service_role`).
- **Tela inicial do perfil**: SA → `/admin/usuarios`; demais → `/painel`; troca pendente → `/trocar-senha`. Acesso direto sem sessão volta à tela pedida após o login; depois de **Sair**, o próximo usuário vai para a própria tela inicial.
- **Sair**: `signOut` (revoga o token de renovação), apaga o armazenamento e o cache de consultas em memória; Voltar leva ao login sem dados. Sessão expirada (evento do Supabase), 401 ou 403 ACCOUNT_DISABLED da API também encerram a sessão.
- **Acessibilidade**: link "Pular para o conteúdo", foco visível de 2 px, alvos de 44 px, diálogos com `aria-modal`, foco preso e Esc, avisos com `role="alert"`/`status`, ícone + texto (nunca só cor), tabelas com cabeçalhos e região rolável nomeada, datas `dd/mm/aaaa hh:mm` em America/Sao_Paulo.
- **Figma**: o arquivo "sistema hospital" não pôde ser consultado nesta sessão (a integração exige autenticação interativa). As telas seguem as diretrizes da Tabela 22 e o padrão visual existente da ET01; a conferência com os frames TL01, TL02, TL16 e TL17 fica para a revisão.

## Variáveis de ambiente

| Módulo   | Variável                        | Uso                                                                                        |
| -------- | ------------------------------- | ------------------------------------------------------------------------------------------ |
| backend  | `SUPABASE_URL`                  | **obrigatória**; https em produção                                                         |
| backend  | `SUPABASE_SECRET_KEY`           | **obrigatória**; chave secreta, somente no servidor                                        |
| backend  | `AUDIT_IP_SECRET`               | HMAC do IP na auditoria; opcional localmente, **obrigatória em produção** (32+ caracteres) |
| backend  | `SUPABASE_PUBLISHABLE_KEY`      | somente `npm run test:supabase` (testes com o Supabase local)                              |
| frontend | `VITE_SUPABASE_URL`             | URL do projeto Supabase                                                                    |
| frontend | `VITE_SUPABASE_PUBLISHABLE_KEY` | chave **publicável** (nunca a secreta)                                                     |

Valores locais: `npx supabase status -o env` (`API_URL`, `SECRET_KEY`, `PUBLISHABLE_KEY`).

## Testes da ET03

| Comando                            | Conteúdo                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `npm run test -w backend`          | unidade (regras, Supabase simulado, env) e integração com PostgreSQL real e verificador falso: T12–T17 e E06–E08 |
| `npm run test:supabase -w backend` | T12, T13 e T16 contra o **Supabase Auth local real** (cria e exclui contas fictícias)                            |
| `npm run test -w frontend`         | componentes e fluxos (login, sessão, logout, TL02, TL16, TL17)                                                   |
| `npm run test:e2e -w frontend`     | Playwright (Chrome instalado) em 1440 px e 360 px, backend nas portas 3334/5174 ligado ao banco de **teste**     |

Os testes de integração usam um hospital exclusivo por cenário no banco de teste (`TEST_DATABASE_URL`). Como `audit_logs` aceita só inserção, esses dados não são apagados; o banco de teste é local e descartável. As rotas-sonda do T15 (E22, E23, E28 e E34, de etapas futuras) usam a mesma cadeia de middlewares e os serviços de escopo de produção sobre as tabelas reais; as etapas que implementarem esses endpoints devem repetir os cenários contra as rotas definitivas.
