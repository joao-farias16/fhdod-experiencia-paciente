import { describe, expect, it } from 'vitest';

import { parsePublicEnv } from './env';

describe('parsePublicEnv', () => {
  it('usa /api/v1 e development por padrão', () => {
    expect(parsePublicEnv({})).toEqual({
      apiBaseUrl: '/api/v1',
      appEnv: 'development',
      supabaseUrl: '',
      supabasePublishableKey: '',
    });
  });

  it('remove barras finais da URL da API', () => {
    expect(
      parsePublicEnv({ VITE_API_BASE_URL: 'https://api.fhdod.example/api/v1/' }),
    ).toMatchObject({
      apiBaseUrl: 'https://api.fhdod.example/api/v1',
      appEnv: 'development',
    });
  });

  it('rejeita ambiente desconhecido', () => {
    expect(() => parsePublicEnv({ VITE_APP_ENV: 'staging' })).toThrow(/VITE_APP_ENV/);
  });

  it('rejeita URL da API sem protocolo http(s)', () => {
    expect(() => parsePublicEnv({ VITE_API_BASE_URL: 'api.fhdod.example' })).toThrow(
      /VITE_API_BASE_URL/,
    );
  });

  it('exige https em produção quando a URL é absoluta (RNF09)', () => {
    expect(() =>
      parsePublicEnv({ VITE_APP_ENV: 'production', VITE_API_BASE_URL: 'http://api.example' }),
    ).toThrow(/https/);
    expect(
      parsePublicEnv({ VITE_APP_ENV: 'production', VITE_API_BASE_URL: 'https://api.example' })
        .apiBaseUrl,
    ).toBe('https://api.example');
  });

  it('lê a URL e a chave publicável do Supabase (ET03)', () => {
    expect(
      parsePublicEnv({
        VITE_SUPABASE_URL: 'http://127.0.0.1:54321/',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_ficticia',
      }),
    ).toMatchObject({
      supabaseUrl: 'http://127.0.0.1:54321',
      supabasePublishableKey: 'sb_publishable_ficticia',
    });
  });

  it('recusa a chave secreta do Supabase no navegador (Seção 10)', () => {
    expect(() => parsePublicEnv({ VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_ficticia' })).toThrow(
      /chave secreta/,
    );
    const payload = btoa(JSON.stringify({ role: 'service_role' })).replace(/=+$/, '');
    expect(() =>
      parsePublicEnv({
        VITE_SUPABASE_PUBLISHABLE_KEY: `eyJhbGciOiJIUzI1NiJ9.${payload}.assinatura`,
      }),
    ).toThrow(/chave secreta/);
    const anon = btoa(JSON.stringify({ role: 'anon' })).replace(/=+$/, '');
    expect(
      parsePublicEnv({ VITE_SUPABASE_PUBLISHABLE_KEY: `eyJhbGciOiJIUzI1NiJ9.${anon}.assinatura` })
        .supabasePublishableKey,
    ).toContain('eyJ');
  });

  it('exige URL http(s) do Supabase e https em produção', () => {
    expect(() => parsePublicEnv({ VITE_SUPABASE_URL: 'supabase.local' })).toThrow(
      /VITE_SUPABASE_URL/,
    );
    expect(() =>
      parsePublicEnv({ VITE_APP_ENV: 'production', VITE_SUPABASE_URL: 'http://x.supabase.co' }),
    ).toThrow(/https/);
  });
});
