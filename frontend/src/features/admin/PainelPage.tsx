import { useLocation } from 'react-router';

import { Alert } from '../../components/ui/Alert';
import { noticeOf } from '../../lib/route-state';
import { useMe } from '../auth/auth-context';
import { ROLE_LABELS } from '../auth/auth-types';

/**
 * Tela inicial administrativa dos perfis sem administração de usuários. Os indicadores do
 * dashboard (TL03) são da ET08; aqui ficam apenas a identificação do perfil e o escopo (RF05).
 */
export function PainelPage() {
  const me = useMe();
  const notice = noticeOf(useLocation().state);
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      {notice === undefined ? null : <Alert tone="success">{notice}</Alert>}
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Olá, {me.fullName}</h1>
        <p className="text-slate-700">
          Perfil: <strong>{ROLE_LABELS[me.role]}</strong>
        </p>
      </div>
      <section
        aria-labelledby="escopo-titulo"
        className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <h2 id="escopo-titulo" className="text-lg font-semibold">
          Seu escopo de acesso
        </h2>
        {me.allSectors ? (
          <p className="mt-2 text-slate-700">Todos os setores do hospital.</p>
        ) : me.sectors.length === 0 ? (
          <p className="mt-2 text-slate-700">
            Nenhum setor associado. Procure o superadministrador.
          </p>
        ) : (
          <ul className="mt-2 list-inside list-disc text-slate-700">
            {me.sectors.map((sector) => (
              <li key={sector.id}>
                {sector.name}
                {sector.isActive ? '' : ' (setor desativado)'}
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-slate-700">
        Os indicadores do painel serão disponibilizados em uma próxima etapa do projeto.
      </p>
    </div>
  );
}
