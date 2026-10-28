import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { RouterProvider, type createBrowserRouter } from 'react-router';

import type { AuthClient } from '../features/auth/auth-client';
import { AuthClientContext } from '../features/auth/auth-context';

type AppRouter = ReturnType<typeof createBrowserRouter>;

interface AppProps {
  router: AppRouter;
  queryClient: QueryClient;
  /** Cliente de autenticação falso para testes; em produção, o Supabase Auth é carregado sob demanda. */
  authClient?: AuthClient;
}

/** Provedores globais; o roteador e o cliente de consultas são injetados para facilitar testes. */
export function App({ router, queryClient, authClient }: AppProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthClientContext.Provider value={authClient ?? null}>
        <RouterProvider router={router} />
      </AuthClientContext.Provider>
    </QueryClientProvider>
  );
}
