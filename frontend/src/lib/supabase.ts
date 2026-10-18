import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { env } from './env';

/** Chave da sessão no sessionStorage (apagada ao fechar a aba e no logout). */
export const AUTH_STORAGE_KEY = 'fhdod-admin-auth';

let client: SupabaseClient | undefined;

/**
 * Cliente supabase-js criado somente quando uma rota administrativa precisa dele (Seção 7: a
 * sessão existe só nas rotas administrativas; a TV Wall e a pesquisa pública não o carregam).
 * Usa a chave PUBLICÁVEL; a chave secreta existe apenas no backend.
 */
export function getSupabase(): SupabaseClient {
  if (client === undefined) {
    if (env.supabaseUrl === '' || env.supabasePublishableKey === '') {
      throw new Error('Configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY.');
    }
    client = createClient(env.supabaseUrl, env.supabasePublishableKey, {
      auth: {
        storage: window.sessionStorage,
        storageKey: AUTH_STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}
