-- ET02 — Migration customizada 1/5: pré-requisitos do esquema.
-- Criada manualmente (SQL que o Prisma não gera). Não edite depois de aplicada.
--
-- 1. btree_gist: permite a igualdade de uuid na restrição de exclusão de turnos
--    (EXCLUDE USING gist (team_id WITH =, tstzrange(...) WITH &&)).
--    No Supabase as extensões ficam no esquema "extensions"; num PostgreSQL comum (CI), em public.
-- 2. Sequência e função do protocolo FHD-AAAA-NNNNNN (Seção 4.3), usadas como DEFAULT de
--    manifestations.protocol; por isso precisam existir antes das tabelas.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
  ELSE
    CREATE EXTENSION IF NOT EXISTS btree_gist;
  END IF;
END
$$;

CREATE SEQUENCE public.manifestation_protocol_seq
  AS integer
  START WITH 1
  MINVALUE 1
  MAXVALUE 999999
  NO CYCLE;

COMMENT ON SEQUENCE public.manifestation_protocol_seq IS
  'Número sequencial (NNNNNN) do protocolo FHD-AAAA-NNNNNN das manifestações.';

-- O ano é o do instante informado no fuso do hospital (America/Sao_Paulo, Seção 2, b).
CREATE FUNCTION public.next_manifestation_protocol(p_at timestamptz DEFAULT now())
RETURNS varchar
LANGUAGE sql
VOLATILE
SET search_path = ''
AS $$
  SELECT 'FHD-'
    || to_char(p_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY')
    || '-'
    || lpad(nextval('public.manifestation_protocol_seq')::text, 6, '0');
$$;

COMMENT ON FUNCTION public.next_manifestation_protocol(timestamptz) IS
  'Gera o próximo protocolo FHD-AAAA-NNNNNN (ano local de p_at; padrão: agora).';
