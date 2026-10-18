import { describe, expect, it } from 'vitest';

import { EnvValidationError, loadEnv } from '../../src/config/env.js';

const DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

describe('loadEnv', () => {
  it('aplica os valores padrão e separa as origens do CORS', () => {
    const env = loadEnv({
      CORS_ORIGIN: 'http://localhost:5173, http://127.0.0.1:5173',
      DATABASE_URL,
    });

    expect(env).toEqual({
      NODE_ENV: 'development',
      PORT: 3333,
      CORS_ORIGIN: ['http://localhost:5173', 'http://127.0.0.1:5173'],
      LOG_LEVEL: 'info',
      TRUST_PROXY: 0,
      DATABASE_URL,
    });
  });

  it('converte PORT e TRUST_PROXY para número', () => {
    const env = loadEnv({
      CORS_ORIGIN: 'http://localhost:5173',
      DATABASE_URL,
      PORT: '4000',
      TRUST_PROXY: '1',
    });

    expect(env.PORT).toBe(4000);
    expect(env.TRUST_PROXY).toBe(1);
  });

  it('rejeita a ausência de CORS_ORIGIN', () => {
    expect(() => loadEnv({ DATABASE_URL })).toThrow(EnvValidationError);
  });

  it('exige DATABASE_URL com protocolo postgresql (ET02)', () => {
    expect(() => loadEnv({ CORS_ORIGIN: 'http://localhost:5173' })).toThrow(/DATABASE_URL/);
    expect(() =>
      loadEnv({ CORS_ORIGIN: 'http://localhost:5173', DATABASE_URL: 'mysql://u:p@localhost/db' }),
    ).toThrow(/DATABASE_URL/);
    expect(
      loadEnv({ CORS_ORIGIN: 'http://localhost:5173', DATABASE_URL: 'postgres://u:p@db:5432/x' })
        .DATABASE_URL,
    ).toBe('postgres://u:p@db:5432/x');
  });

  it('não expõe a senha da DATABASE_URL na mensagem de erro', () => {
    try {
      loadEnv({
        CORS_ORIGIN: 'http://localhost:5173',
        DATABASE_URL: 'mysql://u:senha-secreta@h/db',
      });
      expect.unreachable('loadEnv deveria lançar EnvValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).message).not.toContain('senha-secreta');
    }
  });

  it.each([['nao-e-url'], ['ftp://exemplo.com'], ['http://localhost:5173,']])(
    'rejeita CORS_ORIGIN inválido (%s)',
    (value) => {
      expect(() => loadEnv({ CORS_ORIGIN: value, DATABASE_URL })).toThrow(EnvValidationError);
    },
  );

  it('rejeita porta, nível de log e ambiente inválidos, listando cada variável', () => {
    try {
      loadEnv({
        CORS_ORIGIN: 'http://localhost:5173',
        DATABASE_URL,
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
        return loadEnv({ CORS_ORIGIN: 'valor-secreto-qualquer', DATABASE_URL });
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(EnvValidationError);
    expect((error as EnvValidationError).message).not.toContain('valor-secreto-qualquer');
  });

  it('exige origens HTTPS em produção (RNF09)', () => {
    expect(() =>
      loadEnv({ NODE_ENV: 'production', CORS_ORIGIN: 'http://fhdod.example', DATABASE_URL }),
    ).toThrow(/https/);
    expect(
      loadEnv({ NODE_ENV: 'production', CORS_ORIGIN: 'https://fhdod.example', DATABASE_URL })
        .CORS_ORIGIN,
    ).toEqual(['https://fhdod.example']);
  });
});
