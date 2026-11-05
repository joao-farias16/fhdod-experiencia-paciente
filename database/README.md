# Banco de dados MySQL do FHDOD

Desde a **Etapa 3** do novo cronograma, o FHDOD usa **MySQL 8.4 LTS** (8.0.16 ou mais recente também atende) e SQL puro: a API conecta pelo driver `mysql2` e não usa ORM. Esta pasta contém tudo o que é preciso para criar e administrar o banco pelo **MySQL Workbench** ou pela linha de comando.

```text
database/
├── create_database.sql          cria o banco `fhdod` (utf8mb4_0900_as_cs); nunca apaga nada
├── schema.sql                   esquema completo (GERADO a partir de migrations/; importe no Workbench)
├── migrations/                  histórico versionado e imutável do esquema
│   ├── 001_tabelas.sql          tabelas, colunas, tipos, valores padrão e chaves primárias
│   ├── 002_chaves_unicas_e_indices.sql   chaves únicas (inclusive as "parciais") e índices
│   ├── 003_relacionamentos.sql  chaves estrangeiras (simples e compostas) e regras de exclusão
│   ├── 004_restricoes.sql       CHECK (domínios, formatos e coerência)
│   └── 005_gatilhos.sql         gatilhos: imutabilidade, sobreposição de turnos, anonimato, protocolo
├── seeds/
│   ├── 001_dados_base.sql       hospital e etapas da jornada de uma instalação real (idempotente)
│   └── gerado/                  seed de demonstração exportado (`npm run db:seed:export`; não versionado)
└── seguranca/
    └── usuarios.sql             usuários de privilégio mínimo (API e migrations)
```

## Visão geral do modelo

21 tabelas InnoDB: as 18 da especificação (Tabela 17) — `hospitals`, `profiles`, `sectors`, `profile_sectors`, `teams`, `shifts`, `shift_imports`, `journey_stages`, `survey_configs`, `questions`, `survey_versions`, `survey_version_questions`, `responses`, `response_answers`, `manifestations`, `manifestation_contacts`, `manifestation_notes`, `audit_logs` — mais `auth_sessions` (sessões de login), `manifestation_protocol_sequence` (contador do protocolo) e `schema_migrations` (controle das migrations). Diagrama, regras e equivalências com o modelo anterior: [`docs/modelo-de-dados.md`](../docs/modelo-de-dados.md).

Convenções importantes:

- **Instantes sempre em UTC** (`DATETIME(3)`). A API abre as conexões com `time_zone = '+00:00'`. No Workbench, rode `SET time_zone = '+00:00';` antes de inserir dados à mão, para que os `DEFAULT CURRENT_TIMESTAMP(3)` também fiquem em UTC.
- **Identificadores UUID** em `CHAR(36)`, minúsculos; o `DEFAULT (UUID())` atende inserções manuais.
- **Collation `utf8mb4_0900_as_cs`**: diferencia maiúsculas e acentos (como antes). Buscas sem distinção de caixa usam `LOWER()`.
- **Senhas** só como hash bcrypt (`profiles.password_hash`, verificado por CHECK). Nunca grave senha em texto.
- Erros de regra dos gatilhos aparecem como `Error Code: 1644. [nome_da_regra] mensagem`.

## 1. Instalar o MySQL

- **Windows/macOS:** instale o **MySQL Server 8.4 LTS** e o **MySQL Workbench** pelo MySQL Installer (https://dev.mysql.com/downloads/). Durante a instalação, defina a senha do `root` e mantenha a porta `3306`.
- **Docker (alternativa):** `docker run -d --name fhdod-mysql -p 127.0.0.1:3306:3306 -e MYSQL_ROOT_PASSWORD=<sua-senha> mysql:8.4`.
- Confira a versão: no Workbench, `SELECT VERSION();` (deve ser 8.4.x; 8.0.16+ também funciona).

## 2. Criar o banco pelo MySQL Workbench (banco novo)

1. Abra o Workbench e conecte-se ao servidor (por exemplo, `Local instance MySQL84`, usuário `root`).
2. **File → Open SQL Script…** → `database/create_database.sql` → **Query → Execute (All or Selection)** (`Ctrl+Shift+Enter`). O banco `fhdod` aparece em _Schemas_ (clique em ↻ se preciso).
3. **File → Open SQL Script…** → `database/schema.sql` → confira a linha `USE fhdod;` no início → execute tudo. Ele cria as 21 tabelas, chaves, índices, restrições e gatilhos e registra as migrations em `schema_migrations`.
4. (Instalação real) Abra e execute `database/seeds/001_dados_base.sql` (hospital e etapas da jornada).
5. Crie o primeiro superadministrador pela linha de comando (a senha é gravada como hash e deve ser trocada no primeiro acesso):

   ```bash
   ADMIN_EMAIL=nome@dominio ADMIN_NAME="Nome Completo" ADMIN_PASSWORD='<senha-inicial>' npm run db:create-admin
   ```

   (No PowerShell: `$env:ADMIN_EMAIL='nome@dominio'; $env:ADMIN_NAME='Nome'; $env:ADMIN_PASSWORD='<senha-inicial>'; npm run db:create-admin`.)

   Troque `<senha-inicial>` por uma senha de 10 a 72 caracteres com letras e números (RN28); ela não deve ser registrada em arquivos versionados.

6. (Recomendado em produção) Edite as senhas em `database/seguranca/usuarios.sql` e execute-o: a API passa a usar `fhdod_app` (sem `DROP`, portanto sem `TRUNCATE`) e as migrations, `fhdod_migracao`.

Para **ver** a estrutura: em _Schemas → fhdod → Tables_, clique com o botão direito numa tabela → _Table Inspector_ (colunas, índices, chaves estrangeiras e gatilhos). Diagrama: **Database → Reverse Engineer…** → escolha `fhdod` → o Workbench desenha o diagrama ER com todos os relacionamentos.

> Se a execução do `schema.sql` parar no erro 1419 (criação de gatilhos com log binário ativo), execute `SET GLOBAL log_bin_trust_function_creators = 1;` como administrador e repita num banco vazio.

## 3. Pela linha de comando (alternativa ao Workbench)

Com o `.env` preenchido (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`):

```bash
npm run db:create          # cria DB_NAME se não existir (nunca apaga)
npm run db:migrate         # aplica as migrations pendentes
npm run db:migrate:status  # lista aplicadas/pendentes e confere os checksums
```

## 4. Dados iniciais

| Situação                     | Como                                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Instalação real              | `seeds/001_dados_base.sql` (hospital FHDOD e 4 etapas) + `npm run db:create-admin`                                                                                                   |
| Desenvolvimento (fictício)   | `npm run db:seed` — hospital FHDOD-DEMO, 6 setores, 18 equipes, 6 pesquisas, ~2.765 turnos, 2.400 respostas, 180 manifestações, 6 contas `@example.com` (senha `SEED_DEMO_PASSWORD`) |
| Desenvolvimento no Workbench | `npm run db:seed:export` gera `seeds/gerado/002_demonstracao.sql`; importe-o num banco recém-criado pelo `schema.sql`                                                                |
| Conferir o seed              | `npm run db:seed:verify` (contagens, distribuições e impressão digital md5 por tabela)                                                                                               |
| Recomeçar do zero (só local) | `npm run db:reset` — **apaga** `DB_NAME`, recria, migra e roda o seed; recusa servidor remoto                                                                                        |

Não combine o seed base e o de demonstração no mesmo banco: cada um cria o seu hospital. O seed de demonstração recusa gravar em banco que já tenha outro hospital e recusa servidor remoto (salvo `SEED_ALLOW_REMOTE=true`).

## 5. Criar e aplicar uma nova migration

1. `npm run db:migration:new -- descricao_curta` cria `migrations/NNN_descricao_curta.sql` com o próximo número.
2. Escreva o SQL (use `DELIMITER $$ … $$ DELIMITER ;` para gatilhos, como em `005_gatilhos.sql`). Prefira mudanças aditivas; **não** apague colunas ou tabelas com dados sem um plano de migração de dados.
3. `npm run db:migrate` aplica no seu banco local; `npm test` recria o banco de testes com todas as migrations.
4. `npm run db:schema` regenera `schema.sql` (a CI falha se ele estiver desatualizado: `npm run db:schema:check`).
5. Versione a migration **e** o `schema.sql` juntos. Nunca edite uma migration já aplicada: o checksum diverge e `db:migrate` recusa continuar — crie outra migration.

No MySQL, comandos DDL confirmam a transação implicitamente: se uma migration falhar no meio, corrija o banco e o arquivo antes de tentar de novo (a migration só é registrada em `schema_migrations` depois de executada por inteiro). Faça backup antes de migrar um banco com dados reais: `mysqldump --single-transaction --routines --triggers fhdod > backup.sql` (ou **Server → Data Export** no Workbench).

## 6. Migração de dados de um banco PostgreSQL antigo

Até a Etapa 2 os dados ficavam no PostgreSQL (Supabase). Situação verificada: o projeto Supabase remoto tinha **0 tabelas** em 28/10/2026 e, em 05/11/2026, estava **pausado** (não foi reativado sem autorização); o PostgreSQL local só continha o seed fictício, que o MySQL recria com `npm run db:seed`. Portanto, **nenhum dado real precisou ser migrado**. O banco antigo não foi apagado.

Se for preciso migrar dados reais no futuro:

1. **Não apague o banco antigo.** Faça backup (`pg_dump`).
2. Crie o banco MySQL vazio pelo `schema.sql`.
3. Exporte cada tabela do PostgreSQL em CSV, na ordem das chaves estrangeiras (`hospitals`, `journey_stages`, `sectors`, `profiles`, `profile_sectors`, `teams`, `survey_configs` com `current_version_id` vazio, `questions`, `survey_versions`, `survey_version_questions`, `shift_imports`, `shifts`, `responses`, `response_answers`, `manifestations`, `manifestation_contacts`, `manifestation_notes`, `audit_logs`), com instantes em UTC: `\copy (SELECT ..., to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS') AS created_at, ...) TO 'tabela.csv' CSV HEADER`.
4. Diferenças de colunas:
   - `profiles.auth_user_id` não existe mais; `profiles.password_hash` é obrigatório. O hash bcrypt do Supabase Auth está em `auth.users.encrypted_password` (formato `$2a$…`, aceito pela API): `SELECT p.*, u.encrypted_password AS password_hash FROM public.profiles p JOIN auth.users u ON u.id = p.auth_user_id`. Sem acesso ao `auth.users`, grave um hash temporário e use a redefinição assistida (E09).
   - `audit_logs.id` continua numérico (autoincremento); `details`, `errors` e `staged_rows` são JSON.
   - Booleanos `t`/`f` → `1`/`0`; UUIDs em minúsculas.
5. Importe no Workbench (**Table Data Import Wizard**) ou com `LOAD DATA LOCAL INFILE`, em transação, com `SET time_zone = '+00:00'`. Os gatilhos validam as regras durante a importação (por exemplo, turno sobreposto ou resposta incoerente com o turno são recusados).
6. Atualize o contador do protocolo: `UPDATE manifestation_protocol_sequence SET current_value = (SELECT COALESCE(MAX(CAST(RIGHT(protocol, 6) AS UNSIGNED)), 0) FROM manifestations) WHERE id = 1;`
7. Depois de importar `survey_versions`, preencha `survey_configs.current_version_id`.
8. Confira contagens tabela a tabela antes de desligar o banco antigo.

Limitações conhecidas da troca (sem perda de dados do modelo): a sequência do protocolo agora é transacional (não há "furos" quando uma transação é desfeita, mas os registros simultâneos de manifestação aguardam um ao outro); o ano do protocolo usa o deslocamento fixo UTC−3 de America/Sao_Paulo (sem horário de verão desde 2019); `TRUNCATE` não tem gatilho no MySQL e é bloqueado pela falta do privilégio `DROP` no usuário da API.
