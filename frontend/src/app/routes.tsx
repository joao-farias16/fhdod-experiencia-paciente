import type { RouteObject } from 'react-router';

import { AppLayout } from '../components/AppLayout';
import { HomePage } from '../features/home/HomePage';
import { NotFoundPage } from '../features/not-found/NotFoundPage';

/** Rotas da aplicação. As telas TL01–TL17 são adicionadas nas etapas correspondentes. */
export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
