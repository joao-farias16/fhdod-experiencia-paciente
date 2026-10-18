import { describe, expect, it } from 'vitest';

import { parsePublicEnv } from './env';

describe('parsePublicEnv', () => {
  it('usa /api/v1 e development por padrão', () => {
    expect(parsePublicEnv({})).toEqual({ apiBaseUrl: '/api/v1', appEnv: 'development' });
  });

  it('remove barras finais da URL da API', () => {
    expect(parsePublicEnv({ VITE_API_BASE_URL: 'https://api.fhdod.example/api/v1/' })).toEqual({
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
});
