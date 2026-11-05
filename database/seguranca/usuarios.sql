-- =============================================================================================
-- FHDOD — usuários do MySQL com privilégio mínimo (recomendado em produção e homologação)
-- =============================================================================================
-- Substitui o modelo de RLS/privilégios do Supabase (que não existe no MySQL): a API conecta com
-- um usuário que só lê e grava dados; as migrations rodam com outro usuário.
--
-- Por que dois usuários:
-- * fhdod_app (variáveis DB_USER/DB_PASSWORD da API): SELECT, INSERT, UPDATE e DELETE. Sem DROP,
--   ele não consegue executar TRUNCATE — o MySQL não tem gatilho de TRUNCATE, e é assim que
--   audit_logs continua "somente inserção" (os gatilhos bloqueiam UPDATE e DELETE).
-- * fhdod_migracao (usado só em `npm run db:migrate` ou no MySQL Workbench): cria e altera tabelas,
--   índices, chaves e gatilhos. Ele é o DEFINER dos gatilhos: não o exclua depois.
--
-- ANTES DE EXECUTAR: troque as duas senhas abaixo (nunca versione senhas reais), ajuste o nome do
-- banco (fhdod) e, se quiser restringir a origem, troque '%' pelo host da API.
-- Execute com um administrador (root) no MySQL Workbench.
--
-- Se a criação de gatilhos falhar com o erro 1419 (binary logging), habilite no servidor:
--   SET GLOBAL log_bin_trust_function_creators = 1;   (ou o parâmetro equivalente do provedor)

CREATE USER IF NOT EXISTS 'fhdod_app'@'%' IDENTIFIED BY 'TROQUE-ESTA-SENHA-DA-API';
GRANT SELECT, INSERT, UPDATE, DELETE ON fhdod.* TO 'fhdod_app'@'%';

CREATE USER IF NOT EXISTS 'fhdod_migracao'@'%' IDENTIFIED BY 'TROQUE-ESTA-SENHA-DAS-MIGRATIONS';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES, TRIGGER,
      CREATE VIEW, SHOW VIEW
  ON fhdod.* TO 'fhdod_migracao'@'%';

-- Conferência
SHOW GRANTS FOR 'fhdod_app'@'%';
SHOW GRANTS FOR 'fhdod_migracao'@'%';
