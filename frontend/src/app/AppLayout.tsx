import { HeartPulse } from 'lucide-react';
import { Link, Outlet } from 'react-router';

/** Estrutura comum das páginas: link de salto, cabeçalho, conteúdo e aviso de dados fictícios. */
export function AppLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:shadow"
      >
        Pular para o conteúdo
      </a>

      <header className="bg-brand-700 text-white">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4 sm:px-6">
          <Link to="/" className="flex min-h-11 items-center gap-2 rounded-md text-white">
            <HeartPulse aria-hidden="true" className="size-7" />
            <span className="text-xl font-bold tracking-tight">FHDOD</span>
          </Link>
          <span className="hidden text-sm text-blue-100 sm:inline">
            Gestão da Experiência do Paciente
          </span>
        </div>
      </header>

      <main id="conteudo" tabIndex={-1} className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <p className="mx-auto max-w-5xl px-4 py-4 text-sm text-slate-700 sm:px-6">
          Ambiente acadêmico — somente dados fictícios. Projeto da ETE Monteiro Lobato (CIMOL) para
          a Fundação Hospitalar Dr. Oswaldo Diesel.
        </p>
      </footer>
    </div>
  );
}
