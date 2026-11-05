# Autenticação, permissões e auditoria — ET03

Referência técnica da ET03 (Tabela 27: **E04–E09, E41, TL01, TL02, TL16, TL17; T12–T17**). Requisitos: RF01–RF11, RN10, RN11, RN16, RN18, RN24, RN25 e RN28; Seções 6, 9 e 10 da especificação.

> **Etapa 3 (MySQL):** o Supabase Auth foi substituído por **autenticação própria** na API: senhas com hash bcrypt em `profiles.password_hash`, token de acesso JWT HS256 e sessões em `auth_sessions`. Foram acrescentados E44 (login), E45 (renovação) e E46 (logout); as regras de perfis, escopo e permissões **não mudaram** (a revisão delas é da Etapa 4). Até a Etapa 2, o login era feito pelo frontend direto no Supabase Auth — esse histórico está em [`evidencias/ET03/`](evidencias/ET03/).

## Visão geral

```text
Navegador ── POST /api/v1/auth/login {email, senha} ──► API ──► MySQL (profiles.password_hash, bcrypt)
    │                ◄── accessToken (JWT HS256, 1 h) + refreshToken (uso único, 7 dias)
    ├── Authorization: Bearer <accessToken> ──► API /api/v1 ──► sessão válida? perfil ativo? ──► serviços
    ├── POST /api/v1/auth/refresh {refreshToken} ──► novo par de tokens (o anterior deixa de valer)
    └── POST /api/v1/auth/logout (Bearer) ──► sessão revogada (token e renovação recusados)
```

- **Senhas** ficam somente como hash bcrypt (custo `BCRYPT_ROUNDS`, padrão 12) em `profiles.password_hash`; um CHECK do banco recusa qualquer valor que não seja hash bcrypt. A senha nunca é registrada em log, auditoria ou resposta (exceto a senha temporária, uma única vez, para o SA).
- **Tokens:** o token de acesso é um JWT HS256 assinado com `JWT_SECRET` (somente no backend), com `sub` (perfil), `sid` (sessão), `iat`, `exp` e `typ: "access"`; algoritmo fixo e assinatura conferida em tempo constante. O token de renovação tem 256 bits aleatórios; no banco fica apenas o seu SHA-256.
- **Sessões** (`auth_sessions`): criadas no login; a validade é deslizante (cada renovação estende por `REFRESH_TOKEN_TTL_DAYS`). Revogação por logout, troca da própria senha (outras sessões), redefinição assistida (todas) ou reutilização de token de renovação.
- **Cadastro público inexistente:** contas são criadas somente pelo SA (E07) ou, na instalação, por `npm run db:create-admin`.
- **Recuperação de acesso** é a redefinição assistida pelo SA (RF03). Não há recuperação por e-mail (RF73, fora do MVP).

## Cadeia de middlewares (Seção 6)

```text
/api/v1/me, /me/password, /auth/logout  /api/v1/admin/*
  authenticate                           authenticate
  limite 300/min por perfil              limite 300/min por perfil
  (E05: + 5 a cada 15 min)               requirePasswordChanged
  requirePermission(E04|E05|E46)         requirePermission(Exx)
  controlador → serviço                  controlador → serviço (escopo de req.auth)
        ↓ erros
  notFoundHandler → auditAuthorizationDenials → errorHandler
```

| Etapa                       | Arquivo                               | Resultado                                                                                                                                                                                                                                                                                                                               |
| --------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authenticate`              | `src/modules/auth/auth.middleware.ts` | `Authorization` ausente, sem `Bearer`, malformado (não é JWT), expirado, adulterado, de outro segredo, de sessão revogada/expirada ou de perfil inexistente → **401 UNAUTHENTICATED**. Perfil `is_active = false` → **403 ACCOUNT_DISABLED**, mesmo com token ainda válido. MySQL indisponível → 503. Define `Cache-Control: no-store`. |
| `requirePasswordChanged`    | `src/modules/auth/auth.middleware.ts` | `must_change_password = true` → **403 PASSWORD_CHANGE_REQUIRED** em toda rota exceto E04, E05 e E46.                                                                                                                                                                                                                                    |
| `requirePermission(Exx)`    | `src/modules/auth/auth.middleware.ts` | Permissão do endpoint (catálogo `ENDPOINTS`) ausente no perfil → **403 FORBIDDEN**.                                                                                                                                                                                                                                                     |
| Escopo                      | `src/modules/auth/scope.ts`           | `resolveSectorFilter`: interseção filtro × escopo nas consultas; filtro com setor fora → **403 SECTOR_OUT_OF_SCOPE**. `assertResourceInScope`: recurso de outro setor → **404 NOT_FOUND** (indistinguível de inexistente).                                                                                                              |
| `auditAuthorizationDenials` | `src/modules/auth/auth.middleware.ts` | Grava **um** `AUTHORIZATION_DENIED` por negativa (FORBIDDEN ou SECTOR_OUT_OF_SCOPE). Se a gravação falhar, a resposta continua 403.                                                                                                                                                                                                     |

`req.auth` (`AuthContext`): `profileId`, `sessionId`, `hospitalId`, `role`, `scope` (`{ all: true }` ou `{ all: false, sectorIds }`) e `mustChangePassword`. O perfil é lido **a cada requisição**: alteração de perfil, escopo ou situação vale na requisição seguinte.

### Validação do token

`authenticateAccessToken` (`src/modules/auth/auth.service.ts`) verifica o JWT (`tokens.ts`: formato, cabeçalho HS256, assinatura, `typ`, UUIDs e expiração) e, numa única consulta, a sessão (`auth_sessions`: não revogada e não expirada) e o perfil com o escopo:

| Situação                                                | Resultado               |
| ------------------------------------------------------- | ----------------------- |
| token íntegro, sessão ativa, perfil ativo               | válido                  |
| perfil desativado (`is_active = false`)                 | 403 ACCOUNT_DISABLED    |
| malformado, adulterado, expirado, outro segredo         | 401                     |
| sessão revogada (logout, troca/redefinição) ou expirada | 401                     |
| perfil inexistente                                      | 401                     |
| MySQL indisponível                                      | 503 SERVICE_UNAVAILABLE |

`createApp(deps)` recebe a configuração da autenticação (`AuthConfig`: `jwtSecret`, validades e custo do bcrypt). Os testes usam o próprio serviço para abrir sessões (`createSession`) com MySQL real.

## Perfis e matriz de permissões (Tabela 13)

Fonte única: `src/modules/auth/permissions.ts` (API) (`PERMISSIONS`, `ROLE_PERMISSIONS`, `ENDPOINTS`). O E04 devolve a lista de permissões do perfil; o frontend monta o menu a partir dela, mas **ocultar menus não é controle de acesso** — toda rota é verificada no backend.

| Recurso (endpoints)                             | SA        | AS              | GE      | OU                  | VI              |
| ----------------------------------------------- | --------- | --------------- | ------- | ------------------- | --------------- |
| Próprio perfil e senha (E04, E05); logout (E46) | CA        | CA              | CA      | CA                  | CA              |
| Login e renovação (E44, E45)                    | público   | público         | público | público             | público         |
| Usuários e senha temporária (E06–E09)           | C I A D S | –               | –       | –                   | –               |
| Setores (E10; E11–E12)                          | CIAD      | C\*             | C\*     | C\*                 | C\*             |
| Equipes (E13; E14–E15)                          | CIAD      | C\* I\* A\* D\* | C\*     | C\*                 | C\*             |
| Etapas da jornada (E16)                         | C         | C               | –       | –                   | –               |
| Turnos e importação (E17–E21)                   | C I D     | C\* I\* D\*     | –       | –                   | –               |
| Pesquisas e QR Code (E22–E27)                   | CIAD      | C\* I\* A\* D\* | –       | –                   | –               |
| Indicadores (E28–E33)                           | C         | C\*             | C\*     | C\*                 | C\* (supressão) |
| Relatórios de respostas e indicadores (E34)     | X         | X\*             | X\*     | –                   | –               |
| Relatório de manifestações (E34)                | –         | –               | –       | X\*                 | –               |
| Manifestações, notas, contato (E35–E40)         | –         | –               | –       | C\* I\* A\* S\* D\* | –               |
| Auditoria (E41)                                 | C         | –               | –       | –                   | –               |

`*` = restrito ao escopo de setores. O catálogo `ENDPOINTS` cobre E01–E46 e o T14 verifica a matriz inteira. E44–E46 (Etapa 3) não alteram a matriz de perfis.

### Escopo (RN18)

| Perfil     | Escopo                                                     | Violação no cadastro/edição |
| ---------- | ---------------------------------------------------------- | --------------------------- |
| SA         | sempre global                                              | 400 VALIDATION_ERROR        |
| AS         | ao menos um setor; nunca global                            | 400 VALIDATION_ERROR        |
| GE, OU, VI | global (`allSectors`) **ou** ao menos um setor (não ambos) | 400 VALIDATION_ERROR        |

Novos vínculos exigem setores **existentes** (422 `INVALID_SCOPE`) e **ativos** (422 `SECTOR_INACTIVE`). Um vínculo já existente com setor desativado depois pode ser mantido (histórico, RF15). Escopo restrito vazio (situação só possível por inconsistência de dados) resulta em listas vazias e 403 em qualquer filtro.

## Contratos (prefixo `/api/v1`)

### E44 — `POST /auth/login` (público; 30 por 15 min por IP)

Corpo `{ "email": "...", "password": "..." }` (e-mail sem distinção de maiúsculas). 200 com `Cache-Control: no-store`:

```json
{
  "data": {
    "accessToken": "eyJ...",
    "tokenType": "Bearer",
    "expiresIn": 3600,
    "expiresAt": "2026-11-05T13:00:00.000Z",
    "refreshToken": "43 caracteres base64url",
    "refreshTokenExpiresAt": "2026-11-12T12:00:00.000Z",
    "user": {
      "id": "uuid",
      "fullName": "...",
      "email": "...",
      "role": "superadmin",
      "allSectors": true,
      "sectors": [],
      "mustChangePassword": false,
      "permissions": ["..."]
    }
  }
}
```

`user` tem o mesmo formato do E04. 400 VALIDATION_ERROR (corpo inválido; nunca ecoa a senha); **401 INVALID_CREDENTIALS** ("E-mail ou senha incorretos.") para e-mail inexistente ou senha errada — mesma resposta e mesmo custo de tempo (hash fictício), sem revelar quais contas existem; **403 ACCOUNT_DISABLED** com a senha correta de conta desativada; 429 RATE_LIMITED. Com troca pendente o login é aceito (`mustChangePassword: true`) e as demais rotas respondem 403 PASSWORD_CHANGE_REQUIRED até o E05. Grava a sessão (com HMAC do IP) e `profiles.last_login_at`.

### E45 — `POST /auth/refresh` (público; 60 por minuto por IP)

Corpo `{ "refreshToken": "..." }`. 200 com um novo par de tokens (mesmo formato do E44, sem `user`); o token de renovação apresentado deixa de valer (uso único, rotação). 401 UNAUTHENTICATED para token desconhecido, malformado, de sessão revogada ou expirada. Reapresentar um token **já trocado**: até 10 s depois da renovação (duas abas) → 401 sem revogar; depois disso → a sessão inteira é revogada (`refresh_reuse`), pois indica vazamento. Conta desativada → 403 ACCOUNT_DISABLED.

### E46 — `POST /auth/logout` (todos os perfis, inclusive com troca pendente)

`Authorization: Bearer`. 204 sem corpo. Revoga a sessão do token: o mesmo token de acesso e o de renovação passam a receber 401; outras sessões do usuário continuam válidas.

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

Corpo `{ "newPassword": "..." }` — 10 a 72 caracteres, ao menos uma letra (A–Z) e um número (RN28). 204 sem corpo. 400 VALIDATION_ERROR (senha fora da política; a mensagem nunca repete a senha); 400 também quando a nova senha é igual à atual ou passa de 72 bytes (limite do bcrypt; letras acentuadas ocupam 2 bytes); 429 RATE_LIMITED (5 a cada 15 min por perfil). Grava o novo hash bcrypt, `must_change_password = false` e `password_changed_at`, **revoga as outras sessões** do usuário (a atual continua) e audita `PASSWORD_CHANGED` (`{ mandatory }`), tudo numa transação. Funciona com troca pendente. Sessões anteriores a uma redefinição assistida já foram revogadas pelo E09 (401).

### E06 — `GET /admin/users` (SA)

Query: `role`, `isActive` (`true`/`false`), `sectorId`, `search` (nome ou e-mail, até 120), `page` (≥ 1), `pageSize` (1–100, padrão 20). 200 `{ data: User[], meta: { page, pageSize, total } }`, ordenado por nome; somente usuários do hospital do SA.

`User`: `id`, `fullName`, `email`, `role`, `allSectors`, `sectors[]`, `isActive`, `mustChangePassword`, `deactivatedAt`, `createdAt`, `updatedAt` (o hash da senha nunca é exposto).

### E07 — `POST /admin/users` (SA)

Corpo: `fullName` (3–120), `email` (normalizado em minúsculas), `role`, `allSectors?` (padrão: `true` para SA, `false` para os demais), `sectorIds?` (UUIDs sem repetição, até 50).

201 `{ data: { user: User, temporaryPassword: "16 caracteres" } }` com `no-store` — a senha temporária só aparece nesta resposta. 400 (validação e RN18, inclusive **AS sem setor**, RF06); 409 CONFLICT (e-mail já cadastrado); 422 INVALID_SCOPE ou SECTOR_INACTIVE.

Fluxo: verifica e-mail e setores → gera a senha temporária (CSPRNG) e o hash bcrypt → **uma única transação**: `profiles` (`password_hash`, `must_change_password = true`, `created_by`), `profile_sectors` e auditoria `USER_CREATED`. Se qualquer passo falhar (inclusive a auditoria), nada é gravado; não há mais conta externa a compensar. A chave única `profiles_email_key` resolve cadastros simultâneos (409).

### E08 — `PATCH /admin/users/:id` (SA)

Corpo (ao menos um campo): `fullName`, `role`, `allSectors`, `sectorIds`, `isActive`. `email` é imutável (campo desconhecido → 400).

- Conveniências: passar a SA ou `allSectors: true` sem `sectorIds` remove os vínculos; informar `sectorIds` sem `allSectors` torna o escopo restrito.
- Para si, o SA só altera o nome: perfil, escopo ou situação → **422 SELF_MODIFICATION_FORBIDDEN**.
- Desativar ou rebaixar o último SA ativo do hospital → **422 LAST_SUPERADMIN** (verificado com `SELECT … FOR UPDATE` dos SA ativos e do alvo, em ordem de id).
- `isActive: false` grava `deactivated_at`/`deactivated_by`; a partir da requisição seguinte, o token ainda válido recebe 403 ACCOUNT_DISABLED e o login e a renovação também são recusados (403). `isActive: true` libera de novo (as sessões não revogadas voltam a valer).
- Um registro por operação: `USER_DEACTIVATED`, `USER_REACTIVATED` ou `USER_UPDATED` (detalhes: `changedFields`, `roleFrom/roleTo`, `allSectors`, `sectorIdsAdded/Removed`). Requisição sem mudança efetiva não gera registro.
- 200 `{ data: User }`; 404 para usuário inexistente ou de outro hospital.

### E09 — `POST /admin/users/:id/reset-password` (SA)

Sem corpo. 200 `{ data: { temporaryPassword } }` (no-store). 422 SELF_MODIFICATION_FORBIDDEN (o próprio usuário) ou USER_INACTIVE (conta desativada); 404. Numa transação: grava o hash da senha temporária, marca `must_change_password = true`, **revoga todas as sessões** do usuário (`password_reset`) e audita `USER_PASSWORD_RESET` (`{ changeRequired: true }`, sem a senha). A senha anterior deixa de autenticar e os tokens emitidos antes da redefinição recebem 401.

### E10 — `GET /admin/sectors` (todos os perfis; escopo)

Antecipado da ET04 **somente para leitura**, pois a TL16 associa usuários a setores. Query `isActive`, `search`. 200 com os setores do escopo (inclusive inativos, para histórico) e as contagens `activeTeams` e `activeSurveys`. E11–E27, E01 e E02 foram implementados nas ET04–ET06: ver [`setores-escalas-e-pesquisas.md`](setores-escalas-e-pesquisas.md).

### E41 — `GET /admin/audit-logs` (SA)

Query: `from`, `to` (AAAA-MM-DD no fuso America/Sao_Paulo, inclusivos; padrão: últimos 30 dias; até 366 dias; `from ≤ to`), `actorProfileId`, `action`, `entityType`, `entityId`, `page`, `pageSize` (1–**100**, padrão 50). 200 `{ data: AuditLog[], meta: { page, pageSize, total, from, to } }` em ordem decrescente. `AuditLog`: `id`, `occurredAt`, `actor { id, fullName, role } | null`, `action`, `entityType`, `entityId`, `sectorId`, `details`, `requestId`. O HMAC do IP não é devolvido. Somente eventos de autores do hospital do SA.

## Senhas (RN28, RF03, RF04)

- Política: 10–72 caracteres (até 72 bytes), letra A–Z e número (backend `password-policy.ts`; interface `ChangePasswordPage.tsx` no repositório do frontend).
- Hash: bcrypt (`bcryptjs`), custo `BCRYPT_ROUNDS` (12; mínimo 10 em produção; 4 nos testes).
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

Cada registro traz autor e perfil, entidade, `request_id` (o mesmo `X-Request-Id` da resposta) e `ip_hash` = HMAC-SHA256 do IP com `AUDIT_IP_SECRET` (nunca o IP em claro). `recordAudit` grava **na mesma transação** da operação (falha ao auditar desfaz a operação) e recusa chaves de detalhe que lembrem senha, token, segredo, e-mail, nome, telefone, IP ou contato. `audit_logs` aceita somente inserção — `UPDATE` e `DELETE` são rejeitados por gatilhos do MySQL (verificado no T17); `TRUNCATE` (que não dispara gatilhos no MySQL) é impedido pela falta do privilégio `DROP` no usuário da API (`database/seguranca/usuarios.sql`, verificado em `modelo-de-dados.test.ts`). As próximas etapas acrescentam ao catálogo as ações de setores, equipes, turnos, importações, pesquisas, exportações e manifestações (Seção 10).

## Interface (Seção 11)

| Tela | Rota               | Perfis  | Conteúdo                                                                                                                                                                    |
| ---- | ------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TL01 | `/login`           | Público | E-mail, senha (mostrar/ocultar), mensagem genérica, aviso de ambiente acadêmico, orientação de recuperação assistida                                                        |
| TL02 | `/trocar-senha`    | Todos   | Nova senha com as regras visíveis e marcadas em tempo real, confirmação; também usada para a troca voluntária                                                               |
| TL16 | `/admin/usuarios`  | SA      | Lista com filtros e paginação, cadastro/edição em diálogo, escopo por setor, desativação/reativação com confirmação, redefinição de senha, senha temporária exibida uma vez |
| TL17 | `/admin/auditoria` | SA      | Eventos com filtros (período, autor, ação, entidade, identificador), itens por página (até 100), detalhes legíveis                                                          |
| —    | `/painel`          | Todos   | Página inicial provisória dos perfis sem TL16 (perfil e escopo); o dashboard (TL03) é da ET08                                                                               |

- **Sessão**: até a Etapa 2, o frontend usava o supabase-js com `sessionStorage`. Após a Etapa 3, o frontend (repositório próprio) deve guardar os tokens do E44, renovar com o E45 antes de `expiresAt` e chamar o E46 ao sair — **ajuste pendente no repositório do frontend**.
- **Tela inicial do perfil**: SA → `/admin/usuarios`; demais → `/painel`; troca pendente → `/trocar-senha`. Acesso direto sem sessão volta à tela pedida após o login; depois de **Sair**, o próximo usuário vai para a própria tela inicial.
- **Sair**: E46 (revoga a sessão), apaga o armazenamento e o cache de consultas em memória; Voltar leva ao login sem dados. 401 ou 403 ACCOUNT_DISABLED da API também encerram a sessão.
- **Acessibilidade**: link "Pular para o conteúdo", foco visível de 2 px, alvos de 44 px, diálogos com `aria-modal`, foco preso e Esc, avisos com `role="alert"`/`status`, ícone + texto (nunca só cor), tabelas com cabeçalhos e região rolável nomeada, datas `dd/mm/aaaa hh:mm` em America/Sao_Paulo.
- **Figma**: na ET03 o arquivo "sistema hospital" não pôde ser consultado (a integração exigia autenticação interativa). Em 28/10/2026 as telas TL01, TL02, TL16 e TL17 foram reproduzidas no arquivo a partir da interface implementada (seção "Acesso, usuários e auditoria (ET03)" da Page 1); ver [`manifestacoes-dashboard-relatorios.md`](manifestacoes-dashboard-relatorios.md#supabase-e-figma).

## Variáveis de ambiente

| Variável                       | Uso                                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| `JWT_SECRET`                   | **obrigatória**; assinatura HS256 dos tokens, 32+ caracteres, somente no servidor             |
| `JWT_ACCESS_TOKEN_TTL_SECONDS` | validade do token de acesso (padrão 3600)                                                     |
| `REFRESH_TOKEN_TTL_DAYS`       | validade da sessão sem renovação (padrão 7)                                                   |
| `BCRYPT_ROUNDS`                | custo do bcrypt (padrão 12; mínimo 10 em produção)                                            |
| `AUDIT_IP_SECRET`              | HMAC do IP na auditoria e nas sessões; opcional localmente, **obrigatória em produção** (32+) |

As antigas `SUPABASE_URL`, `SUPABASE_SECRET_KEY` e `SUPABASE_PUBLISHABLE_KEY` não são mais usadas. Trocar o `JWT_SECRET` invalida todos os tokens de acesso emitidos (os usuários renovam ou entram de novo).

## Testes da ET03 (atualizados na Etapa 3)

| Comando                        | Conteúdo                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `npm test` (raiz)              | unidade (regras, tokens JWT, bcrypt, env) e integração com MySQL real: T12 (inclusive E44–E46), T13–T17 e E06–E08 |
| frontend (repositório próprio) | componentes e E2E — dependem do ajuste do frontend para E44–E46                                                   |

Os testes de integração usam um hospital exclusivo por cenário no banco de teste (`TEST_DB_NAME`, padrão `fhdod_test`), que é recriado e migrado a cada `npm test` (somente servidor local). As rotas-sonda do T15 (E22, E23, E28 e E34, de etapas futuras) usam a mesma cadeia de middlewares e os serviços de escopo de produção sobre as tabelas reais; as etapas que implementarem esses endpoints devem repetir os cenários contra as rotas definitivas.
