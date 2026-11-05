-- =============================================================================================
-- FHDOD — criação do banco de dados (MySQL 8.4 LTS)
-- =============================================================================================
-- Execute este arquivo uma única vez, com um usuário administrador (por exemplo, root), antes
-- das migrations. No MySQL Workbench: File > Open SQL Script, depois Query > Execute (Ctrl+Shift+Enter).
--
-- O nome padrão é `fhdod` (variável DB_NAME do .env). Para outro nome, troque-o abaixo e no .env.
-- O banco dos testes automatizados (`fhdod_test`, variável TEST_DB_NAME) é criado pelos próprios
-- testes; não o crie manualmente com dados reais.
--
-- Collation utf8mb4_0900_as_cs: diferencia maiúsculas, minúsculas e acentos (como o PostgreSQL
-- usado até a Etapa 2). Buscas sem distinção de caixa são feitas explicitamente com LOWER().
-- Este script NÃO apaga nada: se o banco já existir, ele é mantido como está.

CREATE DATABASE IF NOT EXISTS fhdod
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_as_cs;
