import './styles/index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';

import { App } from './app/App';
import { createQueryClient } from './app/query-client';
import { routes } from './app/routes';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Elemento #root não encontrado em index.html.');
}

createRoot(container).render(
  <StrictMode>
    <App router={createBrowserRouter(routes)} queryClient={createQueryClient()} />
  </StrictMode>,
);
