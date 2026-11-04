import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-bold">Página não encontrada</h1>
      <p className="text-slate-700">O endereço acessado não existe. Confira o link recebido.</p>
      <Link
        to="/"
        className="inline-flex min-h-11 items-center rounded-lg bg-brand-700 px-4 font-medium text-white hover:bg-brand-800"
      >
        Voltar ao início
      </Link>
    </div>
  );
}
