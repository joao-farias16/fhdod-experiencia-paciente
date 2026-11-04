import { useQuery } from '@tanstack/react-query';
import { RotateCw } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Loading } from '../../components/ui/States';
import { ApiError } from '../../lib/api-client';
import { fetchPublicSurvey, isRetryable, type ResponseOrigin } from './public-survey-api';
import { clearSurveyStorage } from './survey-storage';
import { SurveyFlow } from './SurveyFlow';

function Unavailable({ title, children }: { title: string; children: string }) {
  return (
    <section className="space-y-3 text-center">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-lg text-slate-700">{children}</p>
    </section>
  );
}

/**
 * Pesquisa pública por link ou QR Code, sem login nem cookies (RF33–RF39). A origem vem de
 * ?origem=qr (QR Code) ou ?origem=link (padrão).
 */
export function PublicSurveyPage() {
  const { slug = '' } = useParams();
  const [params] = useSearchParams();
  const origin: ResponseOrigin = params.get('origem') === 'qr' ? 'qr_code' : 'link';
  const query = useQuery({
    queryKey: ['public-survey', slug],
    queryFn: ({ signal }) => fetchPublicSurvey(slug, signal),
    retry: (count, error) => isRetryable(error) && count < 3,
    staleTime: 60_000,
  });

  let content;
  if (query.isPending) {
    content = <Loading label="Conectando ao servidor…" />;
  } else if (query.isError) {
    const error = query.error;
    if (error instanceof ApiError && error.status === 404) {
      content = (
        <Unavailable title="Pesquisa não encontrada">
          Confira o endereço ou leia o QR Code do setor de novo.
        </Unavailable>
      );
    } else if (error instanceof ApiError && error.status === 410) {
      content = (
        <Unavailable title="Pesquisa indisponível">
          Esta pesquisa não está recebendo respostas no momento. Obrigado pelo interesse.
        </Unavailable>
      );
    } else {
      content = (
        <div className="space-y-4">
          <Alert
            tone="error"
            title="Não foi possível abrir a pesquisa"
            requestId={error instanceof ApiError ? error.requestId : undefined}
          >
            {error instanceof ApiError && error.status === 429
              ? 'Muitos acessos em pouco tempo. Aguarde um minuto e tente de novo.'
              : 'Verifique a conexão com a internet e tente de novo.'}
          </Alert>
          <Button className="min-h-12" onClick={() => void query.refetch()}>
            <RotateCw aria-hidden="true" className="size-5" />
            Tentar novamente
          </Button>
        </div>
      );
    }
  } else {
    content = (
      <SurveyFlow
        key={query.data.surveyVersionId}
        survey={query.data}
        slug={slug}
        origin={origin}
        onReload={() => {
          clearSurveyStorage();
          void query.refetch();
        }}
      />
    );
  }

  return <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10">{content}</div>;
}
