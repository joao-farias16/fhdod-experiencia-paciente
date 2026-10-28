import { Download, Printer } from 'lucide-react';
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react';
import { useRef } from 'react';
import { Link } from 'react-router';

import { Button } from '../../components/ui/Button';

function download(href: string, fileName: string) {
  const link = document.createElement('a');
  link.href = href;
  link.download = fileName;
  link.click();
}

/**
 * Link e QR Code da versão vigente (RF30): URLs com ?origem=qr e ?origem=link, QR Code em PNG e SVG
 * e cartaz A4. O QR Code codifica exatamente a URL devolvida por E27.
 */
export function SurveyQrPanel({
  surveyId,
  slug,
  qrUrl,
  linkUrl,
}: {
  surveyId: string;
  slug: string;
  qrUrl: string;
  linkUrl: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const downloadSvg = () => {
    if (svgRef.current === null) return;
    const svg = new XMLSerializer().serializeToString(svgRef.current);
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    download(url, `qrcode-${slug}.svg`);
    URL.revokeObjectURL(url);
  };
  const downloadPng = () => {
    if (canvasRef.current === null) return;
    download(canvasRef.current.toDataURL('image/png'), `qrcode-${slug}.png`);
  };

  return (
    <div className="grid gap-6 md:grid-cols-[auto_1fr]">
      <div className="mx-auto rounded-xl border border-slate-200 bg-white p-3">
        <QRCodeSVG
          ref={svgRef}
          value={qrUrl}
          size={192}
          marginSize={4}
          level="M"
          title={`QR Code da pesquisa: ${qrUrl}`}
          data-testid="qrcode-svg"
        />
        {/* Versão em alta resolução usada somente para o PNG. */}
        <QRCodeCanvas ref={canvasRef} value={qrUrl} size={1024} marginSize={4} level="M" hidden />
      </div>
      <div className="space-y-4">
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="font-medium">Endereço do QR Code (origem QR Code)</dt>
            <dd className="font-mono break-all text-slate-800">{qrUrl}</dd>
          </div>
          <div>
            <dt className="font-medium">Link para compartilhar (origem link)</dt>
            <dd className="font-mono break-all text-slate-800">{linkUrl}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={downloadPng}>
            <Download aria-hidden="true" className="size-4" />
            Baixar PNG
          </Button>
          <Button variant="secondary" onClick={downloadSvg}>
            <Download aria-hidden="true" className="size-4" />
            Baixar SVG
          </Button>
          <Link
            to={`/admin/pesquisas/${surveyId}/cartaz`}
            target="_blank"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-neutral-border bg-white px-4 font-medium hover:bg-slate-100"
          >
            <Printer aria-hidden="true" className="size-4" />
            Cartaz A4
          </Link>
        </div>
      </div>
    </div>
  );
}
