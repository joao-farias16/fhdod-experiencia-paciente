import { describe, expect, it } from 'vitest';

import { EnvValidationError, loadEnv } from '../../src/config/env.js';

describe('loadEnv', () => {
  it('aplica os valores padrão e separa as origens do CORS', () => {
    const env = loadEnv({ CORS_ORIGIN: 'http://localhost:5173, http://127.0.0.1:5173' });

    expect(env).toEqual({
      NODE_ENV: 'development',
      PORT: 3333,
      CORS_ORIGIN: ['http://localhost:5173', 'http://127.0.0.1:5173'],
      LOG_LEVEL: 'info',
      TRUST_PROXY: 0,
    });
  });

  it('converte PORT e TRUST_PROXY para número', () => {
    const env = loadEnv({ CORS_ORIGIN: 'http://localhost:5173', PORT: '4000', TRUST_PROXY: '1' });

    expect(env.PORT).toBe(4000);
    expect(env.TRUST_PROXY).toBe(1);
  });

  it('rejeita a ausência de CORS_ORIGIN', () => {
    expect(() => loadEnv({})).toThrow(EnvValidationError);
  });

  it.each([['nao-e-url'], ['ftp://exemplo.com'], ['http://localhost:5173,']])(
    'rejeita CORS_ORIGIN inválido (%s)',
    (value) => {
      expect(() => loadEnv({ CORS_ORIGIN: value })).toThrow(EnvValidationError);
    },
  );

  it('rejeita porta, nível de log e ambiente inválidos, listando cada variável', () => {
    try {
      loadEnv({
        CORS_ORIGIN: 'http://localhost:5173',
        PORT: '70000',
        LOG_LEVEL: 'verbose',
        NODE_ENV: 'staging',
      });
      expect.unreachable('loadEnv deveria lançar EnvValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const fields = (error as EnvValidationError).issues.map((issue) => issue.split(':')[0]);
      expect(fields).toEqual(expect.arrayContaining(['PORT', 'LOG_LEVEL', 'NODE_ENV']));
    }
  });

  it('não expõe o valor recebido na mensagem de erro', () => {
    const error: unknown = (() => {
      try {
        return loadEnv({ CORS_ORIGIN: 'valor-secreto-qualquer' });
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(EnvValidationError);
    expect((error as EnvValidationError).message).not.toContain('valor-secreto-qualquer');
  });

  it('exige origens HTTPS em produção (RNF09)', () => {
    expect(() => loadEnv({ NODE_ENV: 'production', CORS_ORIGIN: 'http://fhdod.example' })).toThrow(
      /https/,
    );
    expect(
      loadEnv({ NODE_ENV: 'production', CORS_ORIGIN: 'https://fhdod.example' }).CORS_ORIGIN,
    ).toEqual(['https://fhdod.example']);
  });
});
