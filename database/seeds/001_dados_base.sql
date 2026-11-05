-- =============================================================================================
-- Seed 001 — dados base de uma instalação real (hospital e etapas da jornada)
-- =============================================================================================
-- Dados de referência necessários antes do primeiro login: o hospital (fuso de referência) e as
-- quatro etapas da jornada do paciente (Seção 4.3). Idempotente: pode ser executado de novo sem
-- duplicar nem apagar nada (INSERT ... WHERE NOT EXISTS).
--
-- Ordem: create_database.sql → schema.sql (ou npm run db:migrate) → este arquivo →
-- primeiro superadministrador com `npm run db:create-admin` (ver database/README.md).
--
-- Para DESENVOLVIMENTO use o seed de demonstração (`npm run db:seed`), que cria o seu próprio
-- hospital fictício "FHDOD-DEMO" — não combine os dois no mesmo banco.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

START TRANSACTION;

INSERT INTO hospitals (id, name, short_name, timezone)
SELECT UUID(), 'Fundação Hospitalar Dr. Oswaldo Diesel', 'FHDOD', 'America/Sao_Paulo'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM hospitals WHERE short_name = 'FHDOD');

INSERT INTO journey_stages (id, hospital_id, code, name, position)
SELECT UUID(), h.id, e.code, e.name, e.position
FROM hospitals h
JOIN (
  SELECT 'RECEPCAO' AS code, 'Recepção' AS name, 1 AS position
  UNION ALL SELECT 'ATENDIMENTO', 'Atendimento', 2
  UNION ALL SELECT 'AMBIENTE', 'Ambiente', 3
  UNION ALL SELECT 'ALTA', 'Alta', 4
) e
WHERE h.short_name = 'FHDOD'
  AND NOT EXISTS (
    SELECT 1 FROM journey_stages j WHERE j.hospital_id = h.id AND j.code = e.code
  );

COMMIT;

-- Conferência
SELECT h.short_name, j.position, j.code, j.name
FROM hospitals h JOIN journey_stages j ON j.hospital_id = h.id
WHERE h.short_name = 'FHDOD'
ORDER BY j.position;
