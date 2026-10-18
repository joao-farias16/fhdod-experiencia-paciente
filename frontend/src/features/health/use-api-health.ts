import { useQuery } from '@tanstack/react-query';

import { apiGet } from '../../lib/api-client';

/** Conteúdo de GET /api/v1/health (E43). */
export interface ApiHealth {
  status: 'ok';
  service: string;
  timestamp: string;
  uptimeSeconds: number;
}

export const apiHealthQueryKey = ['api-health'] as const;

export function useApiHealth() {
  return useQuery({
    queryKey: apiHealthQueryKey,
    queryFn: ({ signal }) => apiGet<ApiHealth>('/health', { signal }),
    staleTime: 30_000,
  });
}
