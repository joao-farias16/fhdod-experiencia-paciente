import { Printer } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useParams } from 'react-router';

import { Button } from '../../components/ui/Button';
import { ErrorState, Loading } from '../../components/ui/States';
import { useSurveyLinks } from './surveys-api';

/**
 * Cartaz A4 com o QR Code da pesquisa (RF30), para afixar no setor. Página sem o menu
 * administrativo; o botão de impressão não aparece no papel.
 */
export function SurveyPosterPage() {
  const { id = '' } = useParams();
  const links = useSurveyLinks(id);

  if (links.isPending) return <Loading label="Preparando o cartaz…" />;
  if (links.isError) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <ErrorState error={links.error} onRetry={() => void links.refetch()} />
      </div>
    );
  }
  const { qrUrl, title, sectorName } = links.data;
  return (
    <div className="mx-auto flex min-h-dvh max-w-[210mm] flex-col items-center gap-8 bg-white px-8 py-12 text-center print:min-h-0 print:p-0">
      <style>{'@page { size: A4; margin: 15mm; }'}</style>
      <Button
        className="print:hidden"
        onClick={() => {
          window.print();
        }}
      >
        <Printer aria-hidden="true" className="size-5" />
        Imprimir cartaz
      </Button>
      <p className="text-2xl font-semibold tracking-wide text-brand-700 uppercase">{sectorName}</p>
      <h1 className="text-4xl leading-tight font-bold">Conte para nós como foi o atendimento</h1>
      <p className="text-2xl text-slate-800">{title}</p>
      <QRCodeSVG value={qrUrl} size={360} marginSize={4} level="M" title={qrUrl} />
      <p className="text-2xl">Aponte a câmera do celular para o código.</p>
      <p className="text-lg text-slate-700">
        Leva menos de um minuto. Não pedimos seu nome. A resposta é anônima.
      </p>
      <p className="font-mono text-base break-all text-slate-700">{qrUrl}</p>
    </div>
  );
}
