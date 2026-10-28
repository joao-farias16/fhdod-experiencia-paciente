import { Download } from 'lucide-react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ApiError } from '../../lib/api-client';
import { useMe } from '../auth/auth-context';
import type { DashboardFilters } from '../dashboard/dashboard-api';
import { allowedReports, REPORT_LABELS, useExport } from './reports-api';

/**
 * RF62 — exportação para Excel com os filtros atuais do painel (respostas e indicadores, para
 * SA, AS e GE). Perfis sem permissão não veem os botões; o backend continua decidindo (403).
 */
export function ExportButtons({ filters }: { filters: DashboardFilters }) {
  const me = useMe();
  const exporter = useExport();
  const types = allowedReports(me).filter((type) => type !== 'manifestations');
  if (types.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {types.map((type) => (
          <Button
            key={type}
            variant="secondary"
            disabled={exporter.isPending}
            onClick={() => {
              exporter.mutate({ type, filters });
            }}
          >
            <Download aria-hidden="true" className="size-4" />
            {exporter.isPending && exporter.variables.type === type
              ? 'Gerando arquivo…'
              : `Exportar ${REPORT_LABELS[type].toLowerCase()} (Excel)`}
          </Button>
        ))}
      </div>
      {exporter.isError ? (
        <Alert
          tone="error"
          title="Não foi possível exportar"
          requestId={exporter.error instanceof ApiError ? exporter.error.requestId : undefined}
        >
          {exporter.error instanceof ApiError ? exporter.error.message : 'Tente novamente.'}
        </Alert>
      ) : null}
      {exporter.isSuccess ? <Alert tone="success">Arquivo gerado: {exporter.data}</Alert> : null}
    </div>
  );
}
