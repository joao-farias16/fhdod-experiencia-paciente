import { useMutation } from '@tanstack/react-query';

import { saveFile } from '../../lib/api-client';
import { toQueryString } from '../../lib/format';
import { useAuth } from '../auth/auth-context';
import type { Me } from '../auth/auth-types';
import type { DashboardFilters } from '../dashboard/dashboard-api';

export type ReportType = 'responses' | 'indicators' | 'manifestations';

export const REPORT_LABELS: Record<ReportType, string> = {
  responses: 'Respostas',
  indicators: 'Indicadores',
  manifestations: 'Manifestações',
};

/** Permissão de cada tipo (Tabela 13): o backend decide; o menu só reflete. */
const REPORT_PERMISSIONS: Record<ReportType, string> = {
  responses: 'reports:export_responses',
  indicators: 'reports:export_indicators',
  manifestations: 'reports:export_manifestations',
};

export function allowedReports(me: Me): ReportType[] {
  return (Object.keys(REPORT_PERMISSIONS) as ReportType[]).filter((type) =>
    me.permissions.includes(REPORT_PERMISSIONS[type]),
  );
}

export interface ExportParams {
  type: ReportType;
  filters: DashboardFilters;
  status?: string;
  manifestationType?: string;
  includeText?: boolean;
}

/** E34 — gera o .xlsx com os filtros atuais e entrega o arquivo ao navegador (RF62–RF66). */
export function useExport() {
  const { download } = useAuth();
  return useMutation({
    mutationFn: async ({ type, filters, status, manifestationType, includeText }: ExportParams) => {
      const query = toQueryString({
        type,
        ...filters,
        status,
        manifestationType,
        includeText: includeText === true ? 'true' : undefined,
      });
      const file = await download(`/reports/export${query}`, `fhdod_${type}.xlsx`);
      saveFile(file);
      return file.fileName;
    },
  });
}
