import { ApiStatusCard } from '../health/ApiStatusCard';

/** Página inicial da base técnica (ET01): identifica o sistema e mostra a situação da API. */
export function HomePage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-10 sm:px-6">
      <section aria-labelledby="titulo-pagina" className="space-y-3">
        <p className="text-sm font-semibold tracking-wide text-brand-700 uppercase">
          Fundação Hospitalar Dr. Oswaldo Diesel
        </p>
        <h1 id="titulo-pagina" className="text-2xl font-bold tracking-tight sm:text-3xl">
          Sistema de Gestão da Experiência do Paciente
        </h1>
        <p className="max-w-3xl text-lg text-slate-700">
          Pesquisa de satisfação por setor, acompanhamento de manifestações pela Ouvidoria e
          indicadores para a gestão, com coleta mínima de dados e privacidade.
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <ApiStatusCard />

        <section
          aria-labelledby="etapa-atual-title"
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h2 id="etapa-atual-title" className="text-lg font-semibold">
            Estado do desenvolvimento
          </h2>
          <p className="mt-3 text-slate-700">
            Esta é a base técnica do sistema. Pesquisa, painel, Ouvidoria, relatórios e TV Wall
            serão disponibilizados nas próximas etapas.
          </p>
        </section>
      </div>
    </div>
  );
}
