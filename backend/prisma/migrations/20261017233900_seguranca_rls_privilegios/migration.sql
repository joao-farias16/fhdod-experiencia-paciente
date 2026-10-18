-- ET02 — Migration customizada 5/5: RLS e privilégios (Tabela 16 e Seção 10).
-- SQL manual (o Prisma não representa RLS nem GRANT/REVOKE). Não edite depois de aplicada.
--
-- O banco é acessado somente pelo backend (dono das tabelas, que não passa pelo RLS). Por isso:
-- 1. RLS habilitado em todas as tabelas de public, SEM nenhuma política (nega tudo a outros papéis);
-- 2. privilégios revogados de anon e authenticated (papéis do Supabase), com verificação de
--    existência dos papéis para rodar também num PostgreSQL comum (CI);
-- 3. EXECUTE das funções revogado de PUBLIC.
-- A Data API do Supabase fica desligada (supabase/config.toml no ambiente local; painel na nuvem).

ALTER TABLE public.hospitals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_sectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journey_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_version_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.response_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manifestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manifestation_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manifestation_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Tabela de controle do Prisma Migrate, também em public.
ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY;

-- Funções do FHDOD em public: EXECUTE só para o dono (backend), sem PUBLIC, anon ou authenticated. Funções de extensões (por exemplo,
-- btree_gist instalada em public num PostgreSQL comum) não são alteradas.
DO $$
DECLARE
  f regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f);
    END IF;
  END LOOP;
END
$$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      -- Objetos criados depois pelo mesmo papel (migrations futuras) também nascem sem acesso.
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    ELSE
      RAISE NOTICE 'Papel % inexistente neste servidor: nada a revogar.', r;
    END IF;
  END LOOP;
END
$$;
